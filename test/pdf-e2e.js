'use strict';
/**
 * Pdf 브라우저 시험: node test/pdf-e2e.js  (종료 코드 0 = 전부 통과)
 * headless Chromium 으로 test/pdf-fixtures/harness.html 을 file:// 와 http:// 두 방식으로 열어 Pdf.extract 를 실제 PDF에 돌린다.
 * PDF는 test/pdf-fixtures/build.js 가 만든 것이며, 실제 서비스가 만든 PDF가 아니라 실제 구조를 본뜬 합성본이다(build.js 주석 참고).
 * 환경: PLAYWRIGHT_DIR(playwright 가 있는 node_modules), CHROMIUM_PATH 로 바꿀 수 있다.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'pdf-fixtures');
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8'));

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, '/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node-tools/node_modules'].filter(Boolean);
  for (const d of dirs) { try { return require(require.resolve('playwright', { paths: [d] })); } catch (e) { /* 다음 후보 */ } }
  throw new Error('playwright 를 찾지 못했습니다: ' + dirs.join(', '));
}
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const ws = (s) => String(s).replace(/\s+/g, '');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const hasKo = (notes) => notes.length > 0 && notes.every((n) => /[가-힣]/.test(n));

function startServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf' };
  return new Promise((resolve) => {
    const srv = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(ROOT)) { r.statusCode = 403; return r.end(); }
      fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; r.end(); } else { r.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); r.end(d); } });
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/** 한 방식(file:// 또는 http://)에서 모든 픽스처를 검사하고 실패 목록을 돌려준다 */
async function runMode(browser, label, url, report) {
  const fails = [];
  const check = (name, cond, detail) => { if (!cond) fails.push(`[${label}] ${name}: ${detail === undefined ? '' : String(detail).slice(0, 300)}`); };
  const page = await browser.newPage();
  const external = [];
  page.on('request', (rq) => { const u = rq.url(); if (!/^(file:|blob:|data:|about:)/.test(u) && !/^http:\/\/127\.0\.0\.1:/.test(u)) external.push(u); });
  page.on('pageerror', (e) => fails.push(`[${label}] pageerror: ${e.message}`));
  await page.goto(url);
  const meta = await page.evaluate(() => ({ version: window.harness.version, loc: window.harness.location }));
  report.pdfjsVersion = meta.version;

  const timings = {};
  let firstB64 = null;
  for (const f of manifest.fixtures) {
    const b64 = fs.readFileSync(path.join(FIX, f.file)).toString('base64');
    if (!firstB64 && f.file === 'a-ko-labels.pdf') firstB64 = b64;
    const { r, ms, conv } = await page.evaluate(([b, n]) => window.harness.run(b, n), [b64, f.file]);
    timings[f.file] = ms;
    const N = f.file;
    const e = f.expect || {};
    if (f.kind === 'scan' || f.kind === 'bad') {
      check(`${N} ok:false`, r.ok === false, JSON.stringify(r.ok));
      check(`${N} 한국어 안내`, hasKo(r.notes), r.notes.join('|'));
      if (e.password) check(`${N} 암호 안내`, /암호/.test(r.notes.join()), r.notes.join());
      if (f.kind === 'scan') check(`${N} OCR 안내`, /OCR/.test(r.notes.join()), r.notes.join());
      continue;
    }
    check(`${N} ok`, r.ok === true, r.notes.join('|'));
    if (!r.ok) continue;
    const text = r.text;
    const has = (s) => (f.exactSpaces ? text.includes(s) : ws(text).includes(ws(s)));
    // 머리글·바닥글
    if (f.headerFooter) {
      for (const k of ['date', 'title', 'url']) check(`${N} 머리글/바닥글 ${k} 제거`, !text.includes(f.headerFooter[k]), f.headerFooter[k]);
      check(`${N} 쪽번호 n/m 제거`, !/(^|\s)\d{1,3}\/\d{1,3}(\s|$)/.test(text), (text.match(/\S*\d+\/\d+\S*/) || [])[0]);
    }
    for (const s of e.noHeaderFooterText || []) check(`${N} 기본 머리글 제거`, !text.includes(s), s);
    // 한글 깨짐: 대체 문자나 빈 글자가 없어야 한다
    check(`${N} 깨진 글자 없음`, !/[�\u0000]/.test(text));
    for (const p of [...(e.allParagraphs || []), ...(e.responseParagraphs || []), ...(e.allText || [])]) check(`${N} 문장이 쪼개지지 않음`, has(p), p.slice(0, 40));
    for (const p of e.textHas || []) check(`${N} 텍스트에 질문 보존`, has(p), p);
    for (const p of e.listItems || []) check(`${N} 목록 항목`, has(p), p);
    for (const p of e.headings || []) check(`${N} 제목`, has(p), p);
    for (const p of e.refs || []) check(`${N} 참고문헌`, has(p), p);
    for (const p of e.keepLiteral || []) check(`${N} 별표 보존`, text.includes(p), p);
    const lines = text.split('\n');
    for (const l of e.codeLines || []) check(`${N} 코드 줄(들여쓰기 포함)`, lines.includes(l), JSON.stringify(l));
    for (const l of e.tableRows || []) check(`${N} 표 행`, lines.includes(l), l);
    for (const [a, b] of e.separate || []) check(`${N} 별개 문단 유지`, text.includes(a + '\n\n' + b), a.slice(0, 20));
    if (e.minPages) check(`${N} 쪽 수`, r.pageCount >= e.minPages, r.pageCount);
    // 대화 변환
    if (e.parsed) check(`${N} parsed`, conv.parsed === e.parsed, conv.parsed);
    if (e.turns && e.parsed === 'ok' && e.turns.length) {
      check(`${N} 턴 수`, conv.turns.length === e.turns.length, `${conv.turns.length} vs ${e.turns.length}`);
      e.turns.forEach((t, i) => {
        const g = conv.turns[i] || { prompt: '', response: '' };
        check(`${N} 턴${i + 1} 질문`, ws(g.prompt) === ws(t.prompt), g.prompt.slice(0, 60));
        if (t.response != null) check(`${N} 턴${i + 1} 응답`, ws(g.response) === ws(t.response), g.response.slice(0, 60));
      });
    }
    if (e.turnsMin) check(`${N} 턴 수 이상`, conv.turns.length >= e.turnsMin, conv.turns.length);
    if (e.userTextsPresent) { const pr = ws(conv.turns.map((t) => t.prompt).join('')); for (const q of e.userTextsPresent) check(`${N} 사용자 질문 보존`, pr.includes(ws(q)), q); }
    if (f.name === 'gemini-real-style') check(`${N} provider`, conv.provider === 'other' || conv.provider === 'gemini', conv.provider);
    if (f.name === 'b-bubbles') {
      check(`${N} 의사 턴`, conv.parsed === 'unparsed' && conv.turns.length >= 1 && conv.turns.every((t) => t.prompt === ''), conv.parsed);
      check(`${N} 글자 보존`, ws(conv.turns.map((t) => t.response).join('')) === ws(text), 'mismatch');
    }
    if (f.name === 'i-100pages') {
      check(`${N} 100쪽`, r.pageCount === 100, r.pageCount);
      for (const n of e.markers) check(`${N} ${n}번째 쪽 문장`, text.includes(`이 문서의 ${n}번째 쪽 첫 문단입니다.`));
      check(`${N} 글자 보존`, ws(conv.turns.map((t) => t.response).join('')) === ws(text), 'mismatch');
    }
  }
  // 워커 종류: file:// 는 fake worker, http:// 는 진짜 Worker 여야 정상
  const real = await page.evaluate((b) => window.harness.workerKind(b), firstB64);
  report.workerReal[label] = real;
  check('외부 요청 없음', external.length === 0, external.join(','));
  report.timing[label] = timings['i-100pages.pdf'];
  report.loc[label] = meta.loc;
  await page.close();
  return fails;
}

(async () => {
  const pw = loadPlaywright();
  const srv = await startServer();
  const port = srv.address().port;
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--disable-background-networking'] });
  const report = { workerReal: {}, timing: {}, loc: {} };
  let fails = [];
  try {
    fails = fails.concat(await runMode(browser, 'file://', 'file://' + path.join(FIX, 'harness.html'), report));
    fails = fails.concat(await runMode(browser, 'http://', `http://127.0.0.1:${port}/test/pdf-fixtures/harness.html`, report));
  } finally { await browser.close(); srv.close(); }
  console.log('pdf.js', report.pdfjsVersion, '| 실제 Worker 사용:', JSON.stringify(report.workerReal));
  console.log('100쪽 추출 시간(ms):', JSON.stringify(report.timing), '(목표 10000 이내)');
  for (const k of Object.keys(report.timing)) if (!(report.timing[k] < 10000)) fails.push(`[${k}] 100쪽 추출이 10초를 넘음: ${report.timing[k]}ms`);
  if (report.workerReal['http://'] !== true) fails.push('http:// 에서 진짜 Worker 가 쓰이지 않음');
  if (fails.length) { console.log(`\n실패 ${fails.length}건`); fails.forEach((f) => console.log(' - ' + f)); process.exit(1); }
  console.log(`\n통과: 픽스처 ${manifest.fixtures.length}개 × 2방식(file://, http://)`);
})().catch((e) => { console.error(e); process.exit(2); });
