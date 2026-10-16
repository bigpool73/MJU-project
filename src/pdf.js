'use strict';
/**
 * pdf.js — PDF 텍스트 추출과 대화 변환 (브라우저/Node 공용)
 * 계약은 docs/spec-v2.md 의 `Pdf` 절. 라이브러리(pdfjs-dist 3.11.174 클래식 빌드)는 전역 `pdfjsLib` 로 쓴다.
 * buildText 는 DOM·pdf.js 없이 도는 순수 함수라 Node 에서 시험한다. extract 만 브라우저(또는 pdfjsLib 을 주입한 환경)가 필요하다.
 *
 * 설계 근거가 되는 관찰 (2026-10-16, 한국어 화면에서 Chrome 154 로 Ctrl+P 저장한 실제 PDF: Gemini 1건, ChatGPT 1건):
 *  - 머리글은 "YY. M. D. 오전/오후 H:MM" + 문서 제목, 바닥글은 URL + "n/m". 모든 쪽에 반복된다.
 *  - 한국어 줄바꿈이 단어 중간에서도 일어나고, 단어 사이에서 끊긴 것과 겉모습이 같다. 그래서 줄은 항상 공백 한 칸으로 잇는다(추측 규칙 없음).
 *  - ChatGPT 는 목록 항목 사이 간격이 줄바꿈 간격과 같은 곳이 있고 마침표 없는 항목도 있다. 간격·마침표만으로는 문단을 못 나눈다.
 *    그래서 "앞 줄이 오른쪽 한계에 거의 닿았고 다음 줄 첫 낱말이 남은 공간에 들어가지 않는다"는 줄바꿈 원리로 이어진 줄을 판별한다.
 *  - 글머리 기호는 글자가 아니라 도형이라 추출되지 않는다. 항목은 들여쓰기·간격·줄 끝 위치로 구분한다.
 * 이 두 건 밖의 서비스·화면(영어 화면, Claude 등)은 확인하지 못했다.
 */
(function (root) {
  const LIMITS = { maxBytes: 30 * 1024 * 1024, maxPages: 300 };

  /* ───────────────────────── 의존 모듈 ───────────────────────── */

  function dep(name, file) {
    if (root[name]) return root[name];
    if (typeof require === 'function') {
      try { return require(file); } catch (e) { /* 아래에서 null */ }
    }
    return null;
  }
  const getParse = () => dep('Parse', './parse.js');
  const getCore = () => dep('Core', './core.js');

  /* ───────────────────────── buildText ───────────────────────── */

  const CELL_GAP = 1.0;      // 이 이상 벌어지면(글자 크기 배수) 별도 칸. 표 칸·머리글 좌우 칸
  const SPACE_GAP = 0.2;     // 공백 글자 없이 이만큼 벌어지면 낱말 사이로 본다
  const PARA_GAP = 1.4;      // 기준 줄 간격의 이 배수를 넘으면 문단 경계. 명세의 약 1.6배보다 낮춘 이유는 calibration 참고
  const EDGE_ZONE = 0.15;    // 머리글·바닥글 후보: 쪽 위·아래 이 비율 안의 위쪽 2줄·아래쪽 2줄
  const HEADING_RATIO = 1.1;

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const percentile = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

  const TERMINAL_RE = /[.!?。！？…][)"'”’」』\]）]*$/;
  const PAGE_NO_RES = [
    /^[-–—]?\s*\d{1,4}\s*[-–—]?$/,
    /^\d{1,4}\s*\/\s*\d{1,4}$/,
    /^(?:page|p\.?)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
    /^\d{1,4}\s*(?:쪽|페이지)(?:\s*\/\s*\d{1,4}\s*(?:쪽|페이지))?$/,
  ];
  const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
  // Chrome 머리글의 날짜. 시각까지 있는 형식만 단독으로 인정한다(본문 첫 줄의 날짜와 구별하려고).
  const DATE_TIME_RES = [
    /^\d{2,4}\.\s?\d{1,2}\.\s?\d{1,2}\.?\s*(?:오전|오후)\s*\d{1,2}:\d{2}(?::\d{2})?$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}[:\s-]{0,2}\d{2}(?::\d{2})?\s*(?:AM|PM)?$/i, // 일부 환경은 콜론이 사설 영역 문자로 추출된다
    /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?$/,
    /^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/,
  ];
  const DATE_ONLY_RES = [
    /^\d{2,4}\.\s?\d{1,2}\.\s?\d{1,2}\.?$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^\d{4}-\d{2}-\d{2}$/,
  ];
  // 글자 하나짜리 기호·번호만. '가.' 'a.' 같은 글자 번호는 줄바꿈으로 남은 '다.'와 구별할 수 없어 넣지 않는다.
  const LIST_RE = /^(?:[•◦▪▫■□●○◆◇‣⁃·*\-–—]|\d{1,3}[.)]|\(\d{1,3}\)|[①-⑳⑴-⒇])\s+\S/u;
  const BARE_MARKER_RE = /^(?:[•◦▪▫■□●○◆◇‣⁃·*\-–—]|\d{1,3}[.)]|\(\d{1,3}\)|[①-⑳⑴-⒇])$/u;

  const isWide = (ch) => /[ᄀ-ᇿ　-鿿가-힯豈-﫿＀-￯]/.test(ch);
  // 글자 폭 추정 가중치(em). 항목 폭에 맞춰 보정해서 쓰므로 비율만 의미 있다.
  function weight(ch) {
    if (ch === ' ') return 0.3;
    if (isWide(ch)) return 1;
    if (/[.,:;'"!|il]/.test(ch)) return 0.3;
    if (/[mwMW@]/.test(ch)) return 0.85;
    return 0.55;
  }
  const weightOf = (s) => { let t = 0; for (const ch of s) t += weight(ch); return t; };
  function prefixWidth(it, nChars) {
    const total = weightOf(it.str) || 1;
    return it.w * (weightOf(Array.from(it.str).slice(0, nChars).join('')) / total);
  }

  function normPage(page) {
    const raw = page && Array.isArray(page.items) ? page.items : [];
    const items = [];
    for (const it of raw) {
      if (!it || typeof it.str !== 'string') continue;
      const str = it.str.replace(/­/g, '');
      if (str === '') continue;
      const h = Math.max(1, num(it.h, 10));
      const x = num(it.x, NaN), y = num(it.y, NaN);
      if (!isFinite(x) || !isFinite(y)) continue;
      const font = typeof it.font === 'string' ? it.font : '';
      items.push({
        str, x, y, h,
        w: Math.max(0, num(it.w, weightOf(str) * h)),
        mono: font === 'monospace' || /mono|courier|consolas|menlo|fixed/i.test(font),
      });
    }
    return { items, height: num(page && page.height, 0), width: num(page && page.width, 0) };
  }

  /** 같은 기준선의 항목을 한 줄로 묶고, 낱말 사이 공백과 칸(cell)을 정한다. */
  function toLines(page, pageIndex) {
    const sorted = page.items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const clusters = [];
    let cur = null;
    for (const it of sorted) {
      if (cur && Math.abs(it.y - cur.ref) <= Math.max(0.5, 0.45 * Math.max(it.h, cur.h))) {
        cur.items.push(it);
        if (it.h > cur.h) { cur.h = it.h; cur.ref = it.y; }
      } else {
        cur = { ref: it.y, h: it.h, items: [it] };
        clusters.push(cur);
      }
    }
    const lines = [];
    for (const c of clusters) {
      const line = makeLine(c, pageIndex);
      if (line) lines.push(line);
    }
    return lines;
  }

  /** 정렬된 항목 → 칸 배열. 고정폭 줄은 칸을 나누지 않고 간격만큼 공백으로 채워 들여쓰기·정렬을 보존한다. */
  function compose(its, mono, charW) {
    const cells = [];
    let cell = null, prev = null, sawSpace = false;
    for (const it of its) {
      if (it.str.trim() === '') { sawSpace = true; continue; }
      const em = prev ? Math.max(prev.h, it.h) : it.h;
      const gap = prev ? it.x - (prev.x + prev.w) : 0;
      if (!cell || (!mono && gap >= CELL_GAP * em)) {
        cell = { text: it.str, x0: it.x, x1: it.x + it.w };
        cells.push(cell);
      } else {
        let pad = '';
        if (mono) pad = ' '.repeat(Math.max(0, Math.round(gap / charW)));
        else if (!/\s$/.test(prev.str) && !/^\s/.test(it.str) && (sawSpace || gap > SPACE_GAP * em)) pad = ' ';
        cell.text += pad + it.str;
        cell.x1 = it.x + it.w;
      }
      prev = it;
      sawSpace = false;
    }
    for (const c of cells) c.text = mono ? c.text.replace(/\s+$/, '') : c.text.replace(/[ \t\u00a0]+/g, ' ').trim();
    // 목록 번호·기호만 따로 떨어진 칸이면 뒤 칸과 합친다(표 칸으로 오인하지 않도록)
    while (cells.length >= 2 && BARE_MARKER_RE.test(cells[0].text)) {
      cells.splice(0, 2, { text: cells[0].text + ' ' + cells[1].text, x0: cells[0].x0, x1: cells[1].x1 });
    }
    return cells;
  }

  function makeLine(cluster, pageIndex) {
    const its = cluster.items.slice().sort((a, b) => a.x - b.x);
    const vis = its.filter((i) => i.str.trim() !== '');
    if (!vis.length) return null;
    // 글자 수 가중 중앙값: 큰 이모지 하나가 줄 전체를 제목으로 만들지 않게
    const hs = [];
    for (const i of vis) for (let k = 0; k < i.str.trim().length; k++) hs.push(i.h);
    const h = median(hs);
    // 코드 줄: 전부 고정폭인 줄. 고정폭으로 시작하지만 한글 주석·문자열(대체 글꼴로 그려진다)이 섞인 줄은 weakMono 로 두고,
    // annotate 에서 이웃 줄이 코드일 때만 코드로 본다. 본문 속 인라인 코드 줄을 코드 블록으로 오인하지 않으려는 것이다.
    const monoItems = vis.filter((i) => i.mono);
    const mono = monoItems.length > 0 && monoItems.length === vis.length;
    const weakMono = !mono && monoItems.length > 0 && vis[0].mono;
    const charW = monoItems.length ? Math.max(0.1, median(monoItems.map((i) => i.w / Math.max(1, i.str.length)))) : 0;

    const cells = compose(its, mono, charW);
    const allMinX = its.reduce((m, i) => Math.min(m, i.x), Infinity);
    return {
      page: pageIndex, y: cluster.ref, h, mono, weakMono, charW, cells,
      x0: cells[0].x0, x1: cells[cells.length - 1].x1, minX: allMinX,
      text: cells.map((c) => c.text).join(' '),
      items: its,
    };
  }

  /* ── 머리글·바닥글 ── */

  // 쪽 번호·총 쪽수와 같은 숫자만, 짧은 칸(40자 이하)에서만 가린다. 숫자를 전부 가리면 숫자만 다른 본문 줄이 머리글로 오인된다.
  const maskPageNo = (s, pi, nPages) => s.length > 40 ? s : s.replace(/\d+/g, (d) => (d === String(pi + 1) || d === String(nPages) ? '#' : d));

  function removeHeadersFooters(pages, allLines, bodyH, removed) {
    const heightOf = (p) => p.height || 0;
    // 쪽 높이를 모르면 모든 쪽의 가장 아래 글자 위치로 대신한다
    let fallbackH = 0;
    for (const lines of allLines) for (const l of lines) fallbackH = Math.max(fallbackH, l.y);
    fallbackH *= 1.03;

    // 후보: 쪽 위쪽 2줄, 아래쪽 2줄
    const cands = []; // { pageIdx, line, side }
    allLines.forEach((lines, pi) => {
      const H = heightOf(pages[pi]) || fallbackH;
      lines.forEach((l, li) => {
        const fromTop = li, fromBottom = lines.length - 1 - li;
        if (fromTop < 2 && l.y < H * EDGE_ZONE) cands.push({ pi, l, side: 'top' });
        else if (fromBottom < 2 && l.y > H * (1 - EDGE_ZONE)) cands.push({ pi, l, side: 'bottom' });
      });
    });

    // 반복: 같은 자리(기준선)에 같은 글(숫자만 다름)이 여러 쪽에 있는가
    const nPages = pages.length;
    const need = nPages >= 2 ? Math.max(2, Math.ceil(nPages * 0.6)) : Infinity;
    const groups = new Map(); // key -> { pages:Set, y:[] }
    const keyOf = (cd, cellText) => cd.side + '|' + maskPageNo(cellText, cd.pi, nPages);
    for (const cd of cands) {
      for (const c of cd.l.cells) {
        const k = keyOf(cd, c.text);
        let g = groups.get(k);
        if (!g) { g = []; groups.set(k, g); }
        g.push({ pi: cd.pi, y: cd.l.y, h: cd.l.h });
      }
    }
    const repeated = (cd, cell) => {
      const g = groups.get(keyOf(cd, cell.text));
      if (!g) return false;
      const tol = Math.max(2, 0.5 * cd.l.h);
      const near = new Set(g.filter((m) => Math.abs(m.y - cd.l.y) <= tol).map((m) => m.pi));
      return near.size >= need;
    };
    const smallFont = (l) => bodyH > 0 && l.h < bodyH * 0.95;
    // 머리글·바닥글은 여백에 있어 이웃 본문 줄과 줄 간격보다 많이 떨어져 있다. 패턴만으로 지울 때는 이 조건도 본다.
    const isolated = (cd) => {
      const lines = allLines[cd.pi];
      const nb = lines[lines.indexOf(cd.l) + (cd.side === 'top' ? 1 : -1)];
      return !nb || Math.abs(nb.y - cd.l.y) >= 1.5 * bodyH;
    };

    const dropLines = new Set();
    for (const cd of cands) {
      const { l } = cd;
      const keep = [];
      let wholeLine = false;
      for (const c of l.cells) {
        const t = c.text;
        const rep = repeated(cd, c);
        const pageNo = PAGE_NO_RES.some((re) => re.test(t));
        const dateTime = DATE_TIME_RES.some((re) => re.test(t));
        const dateOnly = DATE_ONLY_RES.some((re) => re.test(t));
        const url = URL_RE.test(t);
        let drop = rep || pageNo || ((url || dateTime || dateOnly) && smallFont(l) && isolated(cd)) || (dateTime && cd.side === 'top' && l.cells.length > 1 && isolated(cd));
        if (!drop) { keep.push(c); continue; }
        // 날짜가 앞에 오는 머리글은 같은 줄의 제목 칸까지 한 묶음이다
        if (cd.side === 'top' && (dateTime || (dateOnly && smallFont(l))) && l.cells[0] === c) wholeLine = true;
        removed.push({ text: t, side: cd.side, page: cd.pi + 1 });
      }
      if (wholeLine) {
        for (const c of keep) removed.push({ text: c.text, side: cd.side, page: cd.pi + 1 });
        dropLines.add(l);
      } else if (!keep.length) {
        dropLines.add(l);
      } else if (keep.length !== l.cells.length) {
        l.cells = keep;
        l.text = keep.map((c) => c.text).join(' ');
        l.x0 = keep[0].x0; l.x1 = keep[keep.length - 1].x1;
      }
    }
    return allLines.map((lines) => lines.filter((l) => !dropLines.has(l)));
  }

  /* ── 문단 복원 ── */

  function roleInfo(text) {
    const Parse = getParse();
    if (!Parse || !text) return { start: false, labelOnly: false };
    let r;
    try { r = Parse.parseTranscript(text); } catch (e) { return { start: false, labelOnly: false }; }
    if (r.ok) return { start: true, labelOnly: false };
    if (!r.turns.length) return { start: true, labelOnly: true }; // 표지는 있는데 뒤에 내용이 없다
    return { start: false, labelOnly: false };
  }

  /** 오른쪽 끝에서 tol 안에 줄 둘 이상이 모인 가장 오른쪽 무리. 줄이 꽉 찼을 때의 x1(오른쪽 한계) 추정에 쓴다. */
  function topCluster(values, tol) {
    const v = values.slice().sort((a, b) => b - a);
    for (let i = 0; i + 1 < v.length; i++) {
      if (v[i] - v[i + 1] <= tol) {
        let count = 2;
        while (i + count < v.length && v[i] - v[i + count] <= tol) count++;
        return { value: v[i], count };
      }
    }
    return null;
  }

  const flatten = (allLines) => allLines.reduce((acc, lines) => acc.concat(lines), []);

  function promote(l) {
    l.mono = true;
    l.cells = compose(l.items, true, l.charW);
    l.text = l.cells.map((c) => c.text).join(' ');
    l.x0 = l.cells[0].x0; l.x1 = l.cells[l.cells.length - 1].x1;
  }

  function annotate(flat, allLines, pages) {
    // 이웃이 코드 줄이면 weakMono 도 코드. 앞뒤로 두 번 훑어 연속한 주석 줄도 잇는다.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < flat.length; i++) if (flat[i].weakMono && !flat[i].mono && (flat[i - 1] && flat[i - 1].mono || flat[i + 1] && flat[i + 1].mono)) promote(flat[i]);
      for (let i = flat.length - 1; i >= 0; i--) if (flat[i].weakMono && !flat[i].mono && (flat[i - 1] && flat[i - 1].mono || flat[i + 1] && flat[i + 1].mono)) promote(flat[i]);
    }
    // 본문 글자 크기: 글자 수 가중 중앙값(고정폭·표 제외)
    const hs = [];
    for (const l of flat) if (!l.mono) for (let k = 0; k < l.text.length; k++) hs.push(l.h);
    const bodyH = median(hs) || 10;

    // 표: 한 줄에 칸이 여럿이고 이웃 줄의 칸 시작 위치와 맞는 줄
    allLines.forEach((lines) => {
      lines.forEach((l, i) => {
        l.tabular = false;
        if (l.mono || l.cells.length < 2) return;
        if (l.cells.length >= 3) { l.tabular = true; return; }
        const starts = l.cells.slice(1).map((c) => c.x0);
        const aligned = (o) => o && !o.mono && o.cells.length >= 2 && o.cells.slice(1).some((c) => starts.some((s) => Math.abs(s - c.x0) <= 0.6 * l.h));
        l.tabular = aligned(lines[i - 1]) || aligned(lines[i + 1]);
      });
    });
    for (const l of flat) {
      if (l.tabular) l.text = l.cells.map((c) => c.text).join(' | ');
      l.heading = !l.mono && l.h >= bodyH * HEADING_RATIO;
      l.listStart = !l.mono && !l.tabular && LIST_RE.test(l.text);
      const role = roleInfo(l.mono || l.tabular ? '' : l.text);
      l.roleStart = role.start; l.labelOnly = role.labelOnly;
      l.terminal = TERMINAL_RE.test(l.text);
      if (l.listStart) {
        const m = /^(\S+)\s+/.exec(l.text);
        l.contentX = l.x0 + weightOf(m[0]) * l.h;
      } else l.contentX = l.x0;
    }

    // 기준 줄 간격: 같은 쪽의 이웃 줄 간격 중 작은 쪽(하위 10%). 문단 간격만 있는 문서에서도 줄 간격 쪽이 잡히게 한다.
    const pitches = [];
    allLines.forEach((lines) => {
      for (let i = 1; i < lines.length; i++) {
        const a = lines[i - 1], b = lines[i];
        if (a.mono || b.mono || a.heading || b.heading) continue;
        const p = b.y - a.y;
        if (p >= 0.8 * bodyH && p <= 3.5 * bodyH) pitches.push(p);
      }
    });
    const L = pitches.length ? percentile(pitches, 0.1) : 1.35 * bodyH;

    // 오른쪽 한계(줄이 꽉 찼을 때의 x1). 쪽 폭과 왼쪽 여백(대칭이라고 보고)이 기본값이다.
    // 줄바꿈된 줄이 적은 문서에서는 길이가 우연히 비슷한 짧은 줄들이 "꽉 찬 줄"처럼 모이므로, 데이터로 잡은 한계는 줄 4개 이상이거나
    // 기하학적 값과 가까울 때만 쓴다. 쪽 폭을 모르면(시험 입력) 데이터로만 정한다.
    const tol = 1.0 * bodyH;
    const textual = flat.filter((l) => !l.mono && !l.tabular && !l.heading);
    const leftByWidth = new Map();
    for (const l of textual) {
      const w = Math.round(pages[l.page].width || 0);
      leftByWidth.set(w, Math.min(leftByWidth.has(w) ? leftByWidth.get(w) : Infinity, l.x0));
    }
    const geomOf = (w) => (w > 0 && leftByWidth.has(w) ? w - leftByWidth.get(w) : null);
    const pageLimit = new Map();
    const globalCluster = topCluster(textual.map((l) => l.x1), tol);
    const maxX1 = textual.reduce((m, l) => Math.max(m, l.x1), 0);
    const limitFor = (w) => {
      if (pageLimit.has(w)) return pageLimit.get(w);
      const geom = geomOf(w);
      const same = textual.filter((l) => Math.round(pages[l.page].width || 0) === w).map((l) => l.x1);
      const c = topCluster(same, tol);
      let r;
      if (geom == null) r = c ? c.value : (globalCluster ? globalCluster.value : maxX1);
      else if (!c) r = geom;
      else if (c.count >= 4 || Math.abs(c.value - geom) <= 3 * bodyH) r = c.value;
      else r = geom;
      pageLimit.set(w, r);
      return r;
    };
    // 말풍선처럼 폭이 다른 블록: x0 가 비슷한 줄끼리 모아 3줄 이상 모인 무리가 쪽 한계보다 약간 왼쪽에 있을 때만 그 무리의 한계를 쓴다
    const bucket = (l) => Math.round(l.x0 / (0.5 * bodyH)) + '@' + Math.round(pages[l.page].width || 0);
    const byBucket = new Map();
    for (const l of textual) {
      const k = bucket(l);
      if (!byBucket.has(k)) byBucket.set(k, []);
      byBucket.get(k).push(l.x1);
    }
    const bucketLimit = new Map();
    for (const [k, v] of byBucket) {
      const w = +k.split('@')[1];
      const base = limitFor(w);
      const c = topCluster(v, tol);
      bucketLimit.set(k, c && c.count >= 3 && c.value >= base - 8 * bodyH && c.value <= base + tol ? c.value : base);
    }
    for (const l of flat) l.limit = bucketLimit.has(bucket(l)) ? bucketLimit.get(bucket(l)) : limitFor(Math.round(pages[l.page].width || 0));
    return { bodyH, L };
  }

  /** 다음 줄 첫 낱말의 폭. 줄바꿈은 그 낱말이 남은 칸에 안 들어갈 때 일어난다. */
  function firstTokenWidth(l) {
    let w = 0;
    for (const it of l.items) {
      const s = it.str;
      if (s.trim() === '') { if (w > 0) break; continue; }
      const lead = /^\s*/.exec(s)[0].length;
      const body = s.slice(lead);
      const idx = body.search(/\s/);
      if (idx === -1) { w += prefixWidth({ str: body, w: it.w * (body.length / s.length) }, body.length); continue; }
      w += prefixWidth({ str: body, w: it.w * (body.length / s.length) }, idx);
      break;
    }
    return w || l.h;
  }

  const wrapsInto = (a, b) => {
    if (a.limit == null) return false;
    const slack = a.limit - a.x1;
    return slack < firstTokenWidth(b) + 0.3 * a.h;
  };

  /** a 다음 줄 b 와의 관계: 'sp' 같은 문단 이음 / 'nl' 줄 유지 / 'par' 문단 경계 */
  function relation(a, b, ctx, samePage) {
    if (b.roleStart || a.labelOnly) return 'par';
    if (a.heading !== b.heading || (a.heading && Math.abs(a.h - b.h) > 0.08 * a.h)) return 'par';
    if (a.mono || b.mono) {
      if (!(a.mono && b.mono)) return 'par';
      return samePage && b.y - a.y > 2.2 * a.h ? 'par' : 'nl';
    }
    if (a.tabular || b.tabular) return a.tabular && b.tabular ? 'nl' : 'par';
    if (b.listStart) {
      return a.listPart && samePage && b.y - a.y <= PARA_GAP * ctx.L ? 'nl' : 'par';
    }
    if (samePage && b.y - a.y > PARA_GAP * ctx.L) return 'par';
    if (b.x0 - a.contentX > 0.9 * ctx.bodyH) return 'par';
    if (!samePage && a.terminal) return 'par';
    // 마침표로 끝났는데 오른쪽이 한 글자 넘게 비면 문단 끝으로 본다. 틀려도 문장 경계에서만 끊기므로 문장은 쪼개지지 않는다.
    if (a.terminal && a.limit - a.x1 > 1.3 * a.h) return 'par';
    if (!wrapsInto(a, b)) return 'par';
    return 'sp';
  }

  function assemble(flat, ctx) {
    if (!flat.length) return '';
    // 영어 줄 끝 하이픈: 붙인 낱말이 문서 어딘가에 온전히 있으면 쪼갠 것으로 보고 하이픈을 뺀다. 증거가 없으면 합성어일 수 있어 하이픈을 남긴다.
    const words = new Set();
    for (const l of flat) for (const m of l.text.toLowerCase().matchAll(/[a-z]{3,}/g)) words.add(m[0]);

    let out = '';
    let blockHasList = false;
    flat.forEach((l, i) => {
      let text = l.text;
      if (l.mono) text = ' '.repeat(Math.max(0, Math.round((l.x0 - ctx.codeLeftFor(i)) / (l.charW || l.h * 0.6)))) + text;
      if (i === 0) { l.listPart = l.listStart; out = text; return; }
      const a = flat[i - 1];
      const rel = relation(a, l, ctx, a.page === l.page);
      a.rel = rel;
      l.listPart = l.listStart || (rel === 'sp' && a.listPart) || (rel === 'nl' && a.listPart);
      if (rel === 'sp') {
        const m = /([A-Za-z]{2,})-$/.exec(out);
        if (/[A-Za-z\uac00-\ud7af]-$/.test(out) && /^[\uac00-\ud7af]/.test(text)) out += text; // 하이픈 뒤에서 끊긴 한글 합성어: 하이픈이 끊김 자리였으므로 공백 없이
        else if (m && /^[a-z]/.test(text)) {
          const nxt = /^[a-z]+/.exec(text)[0];
          out = words.has((m[1] + nxt).toLowerCase()) ? out.slice(0, -1) + text : out + text;
        } else out += ' ' + text;
      } else out += (rel === 'nl' ? '\n' : '\n\n') + text;
    });
    return out;
  }

  function finalize(s) {
    return s
      .normalize('NFC')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​⁠﻿]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 머리글·바닥글 판별 전의 본문 글자 크기. 쪽 위·아래 2줄(후보)을 빼고 글자 수 가중 중앙값을 쓰고, 남은 줄이 너무 적으면 가장 큰 글자 크기로 대신한다. */
  function estimateBodyH(allLines) {
    const inner = [];
    allLines.forEach((lines) => lines.forEach((l, i) => { if (!l.mono && i >= 2 && i < lines.length - 2) inner.push(l); }));
    if (inner.length >= 3) {
      const hs = [];
      for (const l of inner) for (let k = 0; k < Math.min(l.text.length, 200); k++) hs.push(l.h);
      return median(hs) || 10;
    }
    // 아주 작은 문서: 머리글·바닥글은 본문보다 작은 글씨이므로 가장 큰 글자 크기를 본문으로 본다
    return flatten(allLines).filter((l) => !l.mono).reduce((m, l) => Math.max(m, l.h), 0) || 10;
  }

  function build(pages) {
    const removed = [];
    if (!Array.isArray(pages) || !pages.length) return { text: '', removed, pageTexts: 0 };
    const norm = pages.map(normPage);
    let allLines = norm.map((p, i) => toLines(p, i));
    // 머리글 판별에 쓰는 임시 본문 크기(최종 값은 머리글을 걷어 낸 뒤 annotate 에서 다시 정한다)
    const bodyH0 = estimateBodyH(allLines);
    allLines = removeHeadersFooters(norm, allLines, bodyH0, removed);
    const flat = flatten(allLines);
    if (!flat.length) return { text: '', removed, flat, ctx: { bodyH: 0, L: 0 } };
    const ctx = annotate(flat, allLines, norm);
    // 고정폭 블록의 왼쪽 끝: 연속한 고정폭 줄 중 가장 왼쪽
    const left = new Array(flat.length);
    for (let i = 0; i < flat.length;) {
      if (!flat[i].mono) { i++; continue; }
      let j = i, m = Infinity;
      while (j < flat.length && flat[j].mono) { m = Math.min(m, flat[j].minX); j++; }
      for (let k = i; k < j; k++) left[k] = m;
      i = j;
    }
    ctx.codeLeftFor = (i) => left[i];
    flat.forEach((l) => { l.listPart = false; });
    return { text: finalize(assemble(flat, ctx)), removed, flat, ctx };
  }

  function buildText(pages) {
    try { return build(pages).text; } catch (e) { return ''; }
  }

  /* ───────────────────────── 대화 변환 ───────────────────────── */

  const PROVIDER_PATTERNS = {
    chatgpt: [/chatgpt/gi, /chat\.openai\.com/gi, /chatgpt\.com/gi],
    claude: [/claude/gi, /claude\.ai/gi],
    gemini: [/gemini/gi, /gemini\.google\.com/gi],
  };

  /** 본문 앞 2000자·뒤 1000자의 서비스 이름 등장 횟수로 추정한다. 추정일 뿐이다. */
  function guessProvider(text) {
    if (typeof text !== 'string' || !text) return 'other';
    const sample = text.length <= 3000 ? text : text.slice(0, 2000) + '\n' + text.slice(-1000);
    const score = {};
    for (const [name, res] of Object.entries(PROVIDER_PATTERNS)) {
      score[name] = res.reduce((n, re) => n + (sample.match(re) || []).length, 0);
    }
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    if (ranked[0][1] === 0 || ranked[0][1] === ranked[1][1]) return 'other';
    return ranked[0][0];
  }

  const CHUNK_SOFT = 800, CHUNK_MAX = 1200;

  /** 한 문단이 CHUNK_MAX 보다 길면 문장 끝 → 공백 → 강제 순으로 잘라 글자를 잃지 않고 나눈다. */
  function splitLong(p) {
    const out = [];
    let s = p;
    while (s.length > CHUNK_MAX) {
      const win = s.slice(0, CHUNK_MAX);
      let cut = -1;
      const re = /[.!?。！？…]["'”’)」』\]）]*\s|\n/g;
      let m;
      while ((m = re.exec(win)) !== null) if (m.index + m[0].length > CHUNK_MAX / 2) cut = m.index + m[0].length;
      if (cut < 0) { const sp = win.lastIndexOf(' '); if (sp > CHUNK_MAX / 2) cut = sp + 1; }
      if (cut < 0) {
        cut = CHUNK_MAX;
        const c = s.charCodeAt(cut - 1);
        if (c >= 0xd800 && c <= 0xdbff) cut--;
      }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).replace(/^\s+/, '');
    }
    if (s.trim()) out.push(s.trim());
    return out.filter(Boolean);
  }

  function pseudoTurns(text, newId) {
    const paras = [];
    for (const p of text.split(/\n[ \t]*\n/)) {
      const t = p.trim();
      if (!t) continue;
      if (t.length > CHUNK_MAX) paras.push(...splitLong(t)); else paras.push(t);
    }
    const chunks = [];
    let cur = '';
    for (const p of paras) {
      if (cur && cur.length + 2 + p.length > CHUNK_MAX) { chunks.push(cur); cur = ''; }
      cur = cur ? cur + '\n\n' + p : p;
      if (cur.length >= CHUNK_SOFT) { chunks.push(cur); cur = ''; }
    }
    if (cur) {
      const last = chunks[chunks.length - 1];
      if (cur.length < 400 && last && last.length + 2 + cur.length <= CHUNK_MAX) chunks[chunks.length - 1] = last + '\n\n' + cur;
      else chunks.push(cur);
    }
    return chunks.map((c) => ({ id: newId(), prompt: '', response: c }));
  }

  function toConversation(text, opts) {
    const o = opts || {};
    const Core = getCore();
    const Parse = getParse();
    const newId = Core && Core.newId ? Core.newId : () => Math.random().toString(36).slice(2, 10);
    const t = typeof text === 'string' ? text : '';
    const provider = o.provider || guessProvider(t);
    const base = { id: newId(), provider, source: o.fileName || '' };
    const parsed = Parse ? Parse.parseTranscript(t) : { ok: false, turns: [] };
    if (parsed.ok) {
      return { ...base, parsed: 'ok', turns: parsed.turns.map((x) => ({ id: newId(), prompt: x.prompt, response: x.response })) };
    }
    return { ...base, parsed: 'unparsed', turns: pseudoTurns(t, newId) };
  }

  /* ───────────────────────── extract ───────────────────────── */

  const state = { workerSrc: null };

  function configure(cfg) {
    if (cfg && typeof cfg.workerSrc === 'string') state.workerSrc = cfg.workerSrc;
    const lib = root.pdfjsLib;
    if (lib && lib.GlobalWorkerOptions && state.workerSrc) lib.GlobalWorkerOptions.workerSrc = state.workerSrc;
  }

  const MSG = {
    notBytes: '파일 내용을 읽지 못했습니다. 파일을 다시 선택해 주세요.',
    empty: '빈 파일(0바이트)입니다. 파일이 제대로 저장됐는지 확인하고 다시 올려 주세요.',
    notPdf: 'PDF 파일이 아닙니다(PDF 머리 표시가 없습니다). 대화 화면에서 Ctrl+P → "PDF로 저장"으로 만든 .pdf 파일을 올려 주세요.',
    corrupt: 'PDF가 손상되었거나 읽을 수 없는 형식입니다. 원본에서 다시 "PDF로 저장"해서 올려 주시고, 계속 안 되면 내용을 복사해 붙여넣기로 넣어 주세요.',
    password: '암호가 걸린 PDF라서 읽을 수 없습니다. 암호를 풀고 다시 저장한 PDF를 올리거나, 내용을 복사해 붙여넣기로 넣어 주세요.',
    noLib: 'PDF를 읽는 도구(pdf.js)를 불러오지 못했습니다. 페이지를 새로 고침한 뒤 다시 시도해 주세요. 계속 안 되면 내용을 복사해 붙여넣기로 넣어 주세요.',
    unknown: 'PDF를 읽는 중 알 수 없는 오류가 났습니다. 다른 방법(원본에서 다시 PDF 저장, 또는 내용 붙여넣기)으로 시도해 주세요.',
  };
  const tooBig = (bytes) => `파일이 ${(bytes / 1048576).toFixed(1)}MB로 너무 큽니다(최대 30MB). 대화를 나누어 여러 PDF로 저장하거나, 이미지가 많다면 이미지를 줄여 다시 저장해 주세요.`;
  const tooManyPages = (n) => `${n}쪽이라 너무 깁니다(최대 ${LIMITS.maxPages}쪽). 대화를 나누어 여러 PDF로 저장해서 올려 주세요.`;
  const scanNote = '읽을 수 있는 글자가 거의 없습니다. 사진이나 스캔본 PDF로 보입니다. 이 앱은 글자 인식(OCR)을 지원하지 않습니다. 대화 화면에서 Ctrl+P → "PDF로 저장"으로 만든 PDF(글자를 드래그해 복사할 수 있는 PDF)를 올리거나, 내용을 복사해 붙여넣기로 넣어 주세요.';

  function toBytes(input) {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }

  const hasPdfHeader = (u8) => {
    const n = Math.min(u8.length, 1024);
    for (let i = 0; i + 4 < n; i++) if (u8[i] === 0x25 && u8[i + 1] === 0x50 && u8[i + 2] === 0x44 && u8[i + 3] === 0x46 && u8[i + 4] === 0x2d) return true;
    return false;
  };

  const tick = () => new Promise((r) => setTimeout(r, 0));

  /**
   * opts.onProgress(done, total) 은 선택이다. file:// 에서는 pdf.js 가 메인 스레드에서 도는 fake worker 로 폴백해
   * 화면이 멈춘 듯 보일 수 있어, 몇 쪽마다 한 번 이벤트 루프를 양보하고 진행을 알린다.
   */
  async function extract(input, opts) {
    const o = opts || {};
    let pageCount = 0;
    const fail = (...notes) => ({ ok: false, text: '', pageCount, notes });
    let task = null, doc = null;
    try {
      const u8 = toBytes(input);
      if (!u8) return fail(MSG.notBytes);
      if (u8.length === 0) return fail(MSG.empty);
      if (u8.length > LIMITS.maxBytes) return fail(tooBig(u8.length));
      if (!hasPdfHeader(u8)) return fail(MSG.notPdf);
      const lib = root.pdfjsLib;
      if (!lib || typeof lib.getDocument !== 'function') return fail(MSG.noLib);
      configure();

      // pdf.js 가 버퍼를 워커로 넘기며 분리(detach)할 수 있어 사본을 준다
      task = lib.getDocument({
        data: new Uint8Array(u8),
        isEvalSupported: false,
        enableXfa: false,
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0,
      });
      try {
        doc = await task.promise;
      } catch (e) {
        const name = e && e.name;
        if (name === 'PasswordException') return fail(MSG.password);
        if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'MissingPDFException') return fail(MSG.corrupt);
        return fail(MSG.corrupt);
      }
      pageCount = doc.numPages;
      if (pageCount > LIMITS.maxPages) return fail(tooManyPages(pageCount));

      const pages = [];
      const notes = [];
      let unreadable = 0, blank = 0;
      for (let n = 1; n <= pageCount; n++) {
        try {
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent({ disableNormalization: true });
          const items = [];
          for (const it of tc.items) {
            if (typeof it.str !== 'string') continue;
            const t = lib.Util.transform(vp.transform, it.transform);
            const st = tc.styles && tc.styles[it.fontName];
            items.push({
              str: it.str.replace(/[ﬀ-ﬆ]/g, (c) => c.normalize('NFKC')),
              x: t[4], y: t[5], w: it.width,
              h: Math.hypot(t[2], t[3]) || Math.abs(it.height) || 10,
              font: st && st.fontFamily ? st.fontFamily : '',
            });
          }
          if (!items.some((i) => i.str.trim())) blank++;
          pages.push({ items, width: vp.width, height: vp.height });
          if (page.cleanup) page.cleanup();
        } catch (e) {
          unreadable++;
          pages.push({ items: [] });
        }
        if (n % 5 === 0 || n === pageCount) {
          if (typeof o.onProgress === 'function') { try { o.onProgress(n, pageCount); } catch (e) { /* 진행 표시 오류는 무시 */ } }
          await tick();
        }
      }
      if (unreadable === pageCount) return fail(MSG.corrupt);

      const built = build(pages);
      const letters = built.text.replace(/\s+/g, '').length;
      if (letters < Math.max(20, pageCount * 8)) return fail(scanNote);

      if (unreadable) notes.push(`${unreadable}쪽은 읽지 못해 건너뛰었습니다.`);
      if (blank - unreadable > 0) notes.push(`${blank - unreadable}쪽에는 읽을 수 있는 글자가 없어(그림만 있는 쪽으로 보임) 분석에서 빠졌습니다. 그림 속 글자는 읽지 못합니다.`);
      const hf = new Set(built.removed.map((r) => r.text));
      if (hf.size) notes.push(`쪽마다 반복되는 머리글·바닥글(${hf.size}종)은 본문에서 제외했습니다.`);
      return { ok: true, text: built.text, pageCount, notes };
    } catch (e) {
      return fail(MSG.unknown);
    } finally {
      try { if (doc && doc.destroy) await doc.destroy(); else if (task && task.destroy) await task.destroy(); } catch (e) { /* 정리 실패는 무시 */ }
    }
  }

  const api = { extract, buildText, toConversation, guessProvider, configure, LIMITS, _build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pdf = api;
})(typeof self !== 'undefined' ? self : globalThis);
