'use strict';
/**
 * docs.js — 문서 파일(.docx, .hwpx, .hwp)에서 글자를 꺼낸다 (브라우저/Node 공용, 외부 라이브러리 없음)
 *
 *   Docs.extract(arrayBuffer, fileName) → Promise<{ ok, text, format, notes: string[] }>   예외를 던지지 않는다
 *
 * 형식
 *  - .docx : ZIP 안의 word/document.xml
 *  - .hwpx : ZIP 안의 Contents/section*.xml
 *  - .hwp  : 한글 5.x 이진 파일. OLE(CFB) 컨테이너 → BodyText/Section* → 압축 해제 → 레코드에서 PARA_TEXT(67)
 * 압축 해제는 브라우저·Node에 내장된 DecompressionStream('deflate-raw')를 쓴다.
 * 지원하지 않는 것: 암호가 걸린 파일, 배포용(복사 방지) 한글 문서, 구형 .doc, 한글 3.0 이전 형식.
 */
(function (root) {
  const LIMITS = { fileBytes: 30 * 1024 * 1024, entryBytes: 100 * 1024 * 1024 };

  const fail = (...notes) => ({ ok: false, text: '', format: '', notes });
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  /**
   * Blob(...).stream() 을 거치지 않고 DecompressionStream에 직접 쓴다. file:// 로 연 페이지에서는 Blob 스트림 읽기가
   * "Failed to fetch"로 실패했다(학생이 index.html을 더블클릭해서 여는 경우).
   */
  async function inflateRaw(bytes, maxBytes) {
    if (typeof root.DecompressionStream === 'undefined') throw new Error('NO_DECOMPRESSION');
    const ds = new root.DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    // 쓰기를 기다리지 않고 동시에 읽어야 큰 입력에서 멈추지 않는다. 손상 입력의 쓰기 오류는 읽는 쪽에서 드러난다.
    const writing = writer.write(bytes).then(() => writer.close()).catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = []; let total = 0;
    try {
      for (;;) {
        let r;
        try { r = await reader.read(); } catch (e) {
          // 실제 한글 파일은 압축 본문 뒤에 압축과 무관한 바이트가 붙어 있다. Chrome은 이를 오류로 처리하므로(Node는 무시),
          // 이미 풀린 내용이 있으면 그 앞까지를 정상 결과로 본다. 풀린 것이 없으면 진짜 손상이다.
          if (total > 0 && /junk|trailing/i.test(String(e && e.message))) break;
          throw e;
        }
        if (r.done) break;
        total += r.value.length;
        if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('TOO_BIG'); }
        chunks.push(r.value);
      }
    } finally { await writing; }
    const out = new Uint8Array(total); let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  const decodeUtf8 = (b) => new root.TextDecoder('utf-8').decode(b);

  /* ───────────────────────── ZIP ───────────────────────── */

  function readZipDirectory(b) {
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('NOT_ZIP');
    const count = u16(b, eocd + 10); let p = u32(b, eocd + 16);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (u32(b, p) !== 0x02014b50) throw new Error('BAD_ZIP');
      const flags = u16(b, p + 8), method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24);
      const nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), off = u32(b, p + 42);
      const name = decodeUtf8(b.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { name, flags, method, csize, usize, off });
      p += 46 + nlen + elen + clen;
    }
    return entries;
  }

  async function readZipEntry(b, e) {
    if (e.flags & 1) throw new Error('ENCRYPTED');
    if (u32(b, e.off) !== 0x04034b50) throw new Error('BAD_ZIP');
    const start = e.off + 30 + u16(b, e.off + 26) + u16(b, e.off + 28);
    const data = b.subarray(start, start + e.csize);
    if (e.usize > LIMITS.entryBytes) throw new Error('TOO_BIG');
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRaw(data, LIMITS.entryBytes);
    throw new Error('BAD_METHOD');
  }

  /* ───────────────────────── XML 글자 ───────────────────────── */

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') { const n = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[g.toLowerCase()] ?? m;
  });

  /** w:p 하나의 XML 조각 → 글자. w:delText(추적 변경의 삭제분)는 태그가 달라 자연히 빠진다. */
  function docxParagraph(x) {
    let out = '';
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>|<w:noBreakHyphen\s*\/>/g;
    let m;
    while ((m = re.exec(x))) {
      if (m[1] !== undefined) out += unescapeXml(m[1]);
      else if (m[0].startsWith('<w:tab')) out += '\t';
      else if (m[0].startsWith('<w:noBreakHyphen')) out += '-';
      else out += '\n';
    }
    return out;
  }

  function docxText(xml) {
    // 같은 글상자가 Choice와 Fallback에 두 번 들어 있어서 Fallback은 버린다.
    xml = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
    return xml.split('</w:p>').map(docxParagraph).join('\n');
  }

  function hwpxParagraph(x) {
    let out = '';
    const re = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>|<hp:t\s*\/>/g;
    let m;
    while ((m = re.exec(x))) {
      if (m[1] === undefined) continue;
      out += unescapeXml(m[1].replace(/<hp:tab\b[^>]*\/>/g, '\t').replace(/<hp:(?:lineBreak|br)\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''));
    }
    return out;
  }

  const hwpxText = (xml) => xml.split('</hp:p>').map(hwpxParagraph).join('\n');

  /* ───────────────────────── CFB (OLE) ───────────────────────── */

  function readCfb(b) {
    const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (b.length < 512 || sig.some((v, i) => b[i] !== v)) throw new Error('NOT_CFB');
    const ss = 1 << u16(b, 30), mss = 1 << u16(b, 32);
    const nFat = u32(b, 44), dirStart = u32(b, 48), cutoff = u32(b, 56), miniStart = u32(b, 60), nDifat = u32(b, 72);
    const END = 0xfffffffe, FREE = 0xffffffff;
    const secOff = (s) => 512 + s * ss;
    const sector = (s) => { if (secOff(s) + ss > b.length + ss) throw new Error('BAD_CFB'); return b.subarray(secOff(s), Math.min(secOff(s) + ss, b.length)); };

    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) { const s = u32(b, 76 + 4 * i); if (s !== FREE) fatSectors.push(s); }
    let dif = u32(b, 68);
    for (let k = 0; k < nDifat && dif < END; k++) {
      const sec = sector(dif);
      for (let i = 0; i < ss / 4 - 1 && fatSectors.length < nFat; i++) { const s = u32(sec, 4 * i); if (s !== FREE) fatSectors.push(s); }
      dif = u32(sec, ss - 4);
    }
    const fat = [];
    for (const s of fatSectors) { const sec = sector(s); for (let i = 0; i < ss / 4; i++) fat.push(u32(sec, 4 * i)); }

    const chain = (start, table, guard) => { const out = []; let s = start; while (s < END && out.length <= guard) { out.push(s); s = table[s]; if (s === undefined) throw new Error('BAD_CFB'); } return out; };
    const maxSectors = Math.ceil(b.length / ss) + 2;
    const readBig = (start, size) => {
      const ids = chain(start, fat, maxSectors); const out = new Uint8Array(ids.length * ss);
      ids.forEach((s, i) => out.set(sector(s), i * ss));
      return out.subarray(0, size);
    };

    const dirBytes = readBig(dirStart, maxSectors * ss);
    const entries = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
      const nl = u16(dirBytes, o + 64); const type = dirBytes[o + 66];
      if (type === 0) { entries.push(null); continue; }
      let name = ''; for (let i = 0; i < Math.max(0, nl - 2); i += 2) name += String.fromCharCode(u16(dirBytes, o + i));
      entries.push({ name, type, left: u32(dirBytes, o + 68), right: u32(dirBytes, o + 72), child: u32(dirBytes, o + 76), start: u32(dirBytes, o + 116), size: u32(dirBytes, o + 120) });
    }
    if (!entries[0]) throw new Error('BAD_CFB');

    // 디렉터리 트리 → "BodyText/Section0" 같은 경로
    const paths = new Map();
    const walk = (id, prefix, seen) => {
      if (id === FREE || id >= entries.length || seen.has(id)) return; seen.add(id);
      const e = entries[id]; if (!e) return;
      walk(e.left, prefix, seen); walk(e.right, prefix, seen);
      const path = prefix ? `${prefix}/${e.name}` : e.name; paths.set(path, e);
      if (e.type === 1) walk(e.child, path, seen);
    };
    walk(entries[0].child, '', new Set());

    let miniFat = null, miniData = null;
    const loadMini = () => {
      if (miniFat) return;
      const ids = chain(miniStart, fat, maxSectors); miniFat = [];
      for (const s of ids) { const sec = sector(s); for (let i = 0; i < ss / 4; i++) miniFat.push(u32(sec, 4 * i)); }
      miniData = readBig(entries[0].start, entries[0].size);
    };
    const read = (path) => {
      const e = paths.get(path); if (!e) return null;
      if (e.size >= cutoff) return readBig(e.start, e.size);
      loadMini();
      const ids = chain(e.start, miniFat, Math.ceil(miniData.length / mss) + 2); const out = new Uint8Array(ids.length * mss);
      ids.forEach((s, i) => out.set(miniData.subarray(s * mss, s * mss + mss), i * mss));
      return out.subarray(0, e.size);
    };
    return { paths, read };
  }

  /* ───────────────────────── HWP 5.x ───────────────────────── */

  /**
   * PARA_TEXT 한 개를 글자로. 한글의 제어 문자는 종류에 따라 크기가 다르다.
   *  - 문자형(0, 10, 13, 24~31): 1글자
   *  - 인라인형(4~9, 19, 20)과 확장형(1~3, 11, 12, 14~18, 21~23): 본문에 8글자(16바이트)를 차지하고
   *    뒤 7글자는 제어 정보(구역·표·그림 등)라서 글자로 읽으면 깨진 한자가 나온다.
   */
  function hwpParaText(body) {
    let out = '';
    for (let i = 0; i + 1 < body.length;) {
      const c = u16(body, i); i += 2;
      if (c >= 32) { out += String.fromCharCode(c); continue; }
      if (c === 10) out += '\n';
      else if (c === 24) out += '-';
      else if (c === 30 || c === 31) out += ' ';
      if (c === 0 || c === 10 || c === 13 || (c >= 24 && c <= 31)) continue;
      if (c === 9) out += '\t';
      i += 14;
    }
    return out;
  }

  function hwpRecords(data) {
    const paras = [];
    for (let i = 0; i + 4 <= data.length;) {
      const h = u32(data, i); i += 4;
      const tag = h & 0x3ff; let size = h >>> 20;
      if (size === 0xfff) { size = u32(data, i); i += 4; }
      if (i + size > data.length) break;
      if (tag === 66) paras.push('');                                   // PARA_HEADER: 새 문단
      else if (tag === 67) {                                            // PARA_TEXT
        if (!paras.length) paras.push('');
        paras[paras.length - 1] += hwpParaText(data.subarray(i, i + size));
      }
      i += size;
    }
    return paras;
  }

  async function hwpText(b) {
    const cfb = readCfb(b);
    const fh = cfb.read('FileHeader');
    if (!fh || fh.length < 40 || decodeUtf8(fh.subarray(0, 17)) !== 'HWP Document File') return fail('한글 문서로 읽을 수 없는 파일입니다.');
    const flags = u32(fh, 36);
    if (flags & 2) return fail('암호가 걸린 한글 파일은 읽을 수 없습니다. 암호를 해제하고 저장하거나, .docx·PDF로 저장해서 올려 주세요.');
    if (flags & 4) return fail('배포용(복사 방지) 한글 문서는 읽을 수 없습니다. 한글에서 “다른 이름으로 저장”으로 일반 문서(.hwp)나 .docx·PDF로 저장해서 올려 주세요.');
    const compressed = !!(flags & 1);
    const sections = [...cfb.paths.keys()].filter((p) => /^BodyText\/Section\d+$/.test(p)).sort((a, c) => Number(a.slice(16)) - Number(c.slice(16)));
    if (!sections.length) return fail('한글 문서의 본문을 찾지 못했습니다. 한글에서 다시 저장하거나 .docx·PDF로 저장해서 올려 주세요.');
    const parts = [];
    for (const s of sections) {
      let d = cfb.read(s);
      if (compressed) d = await inflateRaw(d, LIMITS.entryBytes);
      parts.push(...hwpRecords(d));
    }
    return { ok: true, text: parts.join('\n'), format: 'hwp', notes: [] };
  }

  /* ───────────────────────── 공통 ───────────────────────── */

  function tidy(text) {
    return text.replace(/\r\n?/g, '\n').replace(/[ 　]/g, ' ').replace(/[​-‍﻿]/g, '')
      .replace(/[^\S\n]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function extract(arrayBuffer, fileName) {
    try {
      if (!arrayBuffer || typeof arrayBuffer.byteLength !== 'number') return fail('파일을 읽지 못했습니다.');
      if (arrayBuffer.byteLength > LIMITS.fileBytes) return fail(`파일이 너무 큽니다(${Math.round(LIMITS.fileBytes / 1048576)}MB 이하만 읽습니다). 본문만 붙여넣거나 용량을 줄여 올려 주세요.`);
      const b = new Uint8Array(arrayBuffer);
      const name = String(fileName || '').toLowerCase();
      let res;
      if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b) {
        const zip = readZipDirectory(b);
        if (zip.has('word/document.xml')) {
          const x = decodeUtf8(await readZipEntry(b, zip.get('word/document.xml')));
          res = { ok: true, text: docxText(x), format: 'docx', notes: [] };
        } else if ([...zip.keys()].some((k) => /^Contents\/section\d+\.xml$/.test(k))) {
          const names = [...zip.keys()].filter((k) => /^Contents\/section\d+\.xml$/.test(k)).sort((a, c) => parseInt(a.match(/\d+/)[0], 10) - parseInt(c.match(/\d+/)[0], 10));
          const parts = [];
          for (const n of names) parts.push(hwpxText(decodeUtf8(await readZipEntry(b, zip.get(n)))));
          res = { ok: true, text: parts.join('\n'), format: 'hwpx', notes: [] };
        } else if (zip.has('META-INF/manifest.xml') && [...zip.keys()].some((k) => /encrypt/i.test(k))) {
          return fail('암호가 걸린 파일은 읽을 수 없습니다. 암호를 해제하고 저장해서 올려 주세요.');
        } else {
          return fail('지원하지 않는 형식입니다. 한글(.hwp, .hwpx), 워드(.docx), PDF, .txt 파일을 올려 주세요.');
        }
      } else if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
        const cfb = readCfb(b);
        if (cfb.paths.has('FileHeader') && cfb.paths.has('BodyText/Section0')) res = await hwpText(b);
        else if (cfb.paths.has('WordDocument')) return fail('구형 워드(.doc)는 읽을 수 없습니다. 워드에서 “다른 이름으로 저장”으로 .docx나 PDF로 저장해서 올려 주세요.');
        else if (cfb.paths.has('EncryptedPackage')) return fail('암호가 걸린 파일은 읽을 수 없습니다. 암호를 해제하고 저장해서 올려 주세요.');
        else return fail('지원하지 않는 형식입니다. 한글(.hwp, .hwpx), 워드(.docx), PDF, .txt 파일을 올려 주세요.');
      } else if (/\.(hwp|docx|hwpx)$/.test(name)) {
        return fail('파일이 손상되었거나 해당 형식이 아닙니다. 원본에서 다시 저장해서 올려 주세요.');
      } else {
        return fail('지원하지 않는 형식입니다. 한글(.hwp, .hwpx), 워드(.docx), PDF, .txt 파일을 올려 주세요.');
      }
      if (!res.ok) return res;
      res.text = tidy(res.text);
      if (res.text.length < 5) return fail('파일에서 읽을 수 있는 글자를 찾지 못했습니다. 이미지로만 된 문서일 수 있습니다. 본문을 붙여넣거나 글자가 있는 파일로 저장해서 올려 주세요.');
      return res;
    } catch (e) {
      const m = e && e.message;
      if (m === 'NO_DECOMPRESSION') return fail('이 브라우저는 파일 압축을 풀 수 없습니다. 최신 Chrome·Edge·Firefox·Safari에서 열거나 PDF로 저장해 올려 주세요.');
      if (m === 'ENCRYPTED') return fail('암호가 걸린 파일은 읽을 수 없습니다. 암호를 해제하고 저장해서 올려 주세요.');
      if (m === 'TOO_BIG') return fail('파일 안의 내용이 너무 커서 읽지 않았습니다. 본문만 붙여넣어 주세요.');
      return fail('파일을 읽지 못했습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다. 원본에서 다시 저장하거나 PDF로 저장해서 올려 주세요.');
    }
  }

  const api = { extract, LIMITS, _internal: { inflateRaw, hwpParaText, hwpRecords, docxText, hwpxText, readCfb, readZipDirectory, tidy } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Docs = api;
})(typeof self !== 'undefined' ? self : globalThis);
