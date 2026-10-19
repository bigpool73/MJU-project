'use strict';
/**
 * 화면 전체 흐름 시험: node test/e2e.js  (종료 코드 0 = 전부 통과)
 * 하위 경로(/MJU-project/)로 서빙해 GitHub Pages 와 같은 조건에서 시험한다.
 * 환경: PLAYWRIGHT_DIR, CHROMIUM_PATH 로 바꿀 수 있다. 스크린샷은 SHOT_DIR(기본: 아래 경로)에 ui-*.png 로 저장.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'pdf-fixtures');
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-mju-project/7e238b33-e2a6-5f87-a0b0-3b0cd2586e3e/scratchpad';
const REFUSAL = '해당 대화는 과제와 연관도가 높아, 삭제가 불가합니다.';
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8'));

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'].filter(Boolean);
  for (const d of dirs) { try { return require(require.resolve('playwright', { paths: [d] })); } catch (e) { /* 다음 후보 */ } }
  throw new Error('playwright 를 찾지 못했습니다: ' + dirs.join(', '));
}
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// ---- 서버: 임시 폴더 안의 MJU-project -> ROOT 심볼릭 링크를 서빙 (하위 경로 시험)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain' };
function startServer(base, extra) {
  return new Promise((resolve) => {
    const srv = http.createServer((q, r) => {
      const u = decodeURIComponent(q.url.split('?')[0]);
      if (extra && extra[u]) { r.writeHead(200, { 'content-type': TYPES['.html'] }); r.end(extra[u]); return; }
      const f = path.join(base, u === '/' ? '/index.html' : u);
      if (!f.startsWith(base)) { r.writeHead(403); r.end(); return; }
      fs.stat(f, (e, st) => {
        if (e) { r.writeHead(404); r.end('not found'); return; }
        const file = st.isDirectory() ? path.join(f, 'index.html') : f;
        fs.readFile(file, (e2, buf) => {
          if (e2) { r.writeHead(404); r.end('not found'); return; }
          r.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); r.end(buf);
        });
      });
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const results = [];
const failures = [];
async function item(id, name, fn) {
  try { await fn(); results.push({ id, name, ok: true }); console.log(`  ok   ${id} ${name}`); }
  catch (e) { results.push({ id, name, ok: false }); failures.push(`${id} ${name}: ${e.message}`); console.log(`  FAIL ${id} ${name}\n       ${e.message.split('\n')[0]}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg || '조건 불일치'); }

const fixture = (n) => path.join(FIX, n);
const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, `ui-${name}.png`), fullPage: true });

async function fillMeta(page) {
  await page.fill('#f-student', '시험학생(예시)');
  await page.fill('#f-studentId', '60250001');
  await page.fill('#f-course', '시험 과목');
  await page.fill('#f-professor', '시험 교수');
  await page.fill('#f-assignment', '동아리 축제 부스 운영 계획');
}
const stepNo = (page) => page.evaluate(() => document.querySelector('#stepper li.current .num').textContent.trim());
const cardRels = (page) => page.$$eval('#turnCards .turn-card', (els) => els.map((e) => Number(e.dataset.rel)));

(async () => {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mju-e2e-'));
  fs.symlinkSync(ROOT, path.join(tmp, 'MJU-project'));

  const bundlePath = path.join(tmp, 'bundle.html');
  execFileSync('node', [path.join(ROOT, 'scripts/bundle.js'), bundlePath], { stdio: 'pipe' });
  const wrapper = '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><iframe id="f" sandbox="allow-scripts allow-downloads" src="/bundle.html" style="width:1000px;height:900px"></iframe>';
  const srv = await startServer(tmp, { '/wrap.html': wrapper });
  const port = srv.address().port;
  const BASE = `http://127.0.0.1:${port}/MJU-project/`;

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const consoleErrors = [];
  const badResponses = [];
  const newPage = async (ctxOpts) => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, acceptDownloads: true, ...(ctxOpts || {}) });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${m.text()} @${page.url()}`); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });
    return page;
  };

  const assignText = manifest.fixtures.find((f) => f.file === 'a-ko-labels.pdf').expect.turns[0].response
    + ' 나는 이 부스를 동아리원 열 명과 함께 운영하고 싶다. 첫 해에는 규모를 작게 시작하는 편이 안전하다고 본다.';

  console.log(`서빙: ${BASE}`);
  const page = await newPage();
  await page.goto(BASE);

  // (A) 로고
  await item('A', '로고가 페이지 맨 위 좌측에 보이고 naturalWidth>0', async () => {
    const r = await page.evaluate(() => {
      const img = document.querySelector('.app-header .brand-logo');
      const b = img.getBoundingClientRect();
      const first = document.body.firstElementChild;
      const others = [...document.querySelectorAll('h1, #stepper, .tabs')].map((e) => e.getBoundingClientRect().top);
      return { w: img.naturalWidth, h: img.naturalHeight, alt: img.alt, left: b.left, top: b.top, bw: b.width, h1top: Math.min(...others), inHeader: first.contains(img), vis: getComputedStyle(img).visibility };
    });
    assert(r.w > 0 && r.h > 0, `naturalWidth ${r.w}`);
    assert(r.alt === '명지대학교', `alt ${r.alt}`);
    assert(r.bw > 100, `폭 ${r.bw}`);
    assert(r.top < 60 && r.left < 200 && r.top < r.h1top, `위치 ${r.left},${r.top}`);
    assert(r.inHeader && r.vis === 'visible', '머리글 첫 요소가 아님');
  });

  // (B) 하위 경로
  await item('B', '하위 경로(/MJU-project/)에서 로고·pdf.js·파비콘 200', async () => {
    const r = await page.evaluate(async () => {
      const hrefs = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute('href'));
      const st = {};
      for (const hrf of [...hrefs, 'assets/mju-logo.png', 'assets/icon-192.png', 'assets/vendor/pdfjs/pdf.worker.min.js']) st[hrf] = (await fetch(hrf)).status;
      return { hrefs, st, lib: typeof pdfjsLib, pdf: typeof Pdf, slash: hrefs.concat([...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))).some((x) => x && x.startsWith('/')) };
    });
    assert(page.url().includes('/MJU-project/'), page.url());
    assert(r.hrefs.length === 3, `파비콘 링크 ${r.hrefs.length}개`);
    assert(Object.values(r.st).every((s) => s === 200), JSON.stringify(r.st));
    assert(r.lib === 'object' && r.pdf === 'object', `pdfjsLib ${r.lib}, Pdf ${r.pdf}`);
    assert(!r.slash, '절대 경로(/로 시작) 사용');
    const sizes = await page.evaluate(() => [document.querySelector('.brand-logo').height]);
    assert(sizes[0] === 48, `로고 높이 ${sizes[0]}`);
  });

  // (D) 단계 이동
  await item('D', '필수 입력이 비면 다음 단계로 못 가고 이유가 보임, 채우면 통과', async () => {
    await shot(page, 'step1-desktop');
    await page.click('#btnNext');
    assert((await stepNo(page)) === '1', '1단계를 벗어남');
    const msg = await page.textContent('#stage .val-msg');
    assert(/이름/.test(msg) && /학번/.test(msg) && /과목명/.test(msg) && /과제명/.test(msg), msg);
    await fillMeta(page);
    await page.click('#btnNext');
    assert((await stepNo(page)) === '2', '2단계로 못 감');
    await page.click('#btnNext');
    assert((await stepNo(page)) === '2', '빈 2단계를 통과함');
    const m2 = await page.textContent('#stage .val-msg');
    assert(/과제 결과물/.test(m2) && /AI 대화/.test(m2), m2);
    // 단계 표시를 눌러 건너뛰기도 막힘
    await page.click('#stepper li:nth-child(4) button');
    assert((await stepNo(page)) === '2', '단계 표시로 건너뜀');
  });

  await item('Gd', 'Claude PDF 만들기 안내: 확장 프로그램 링크·사진 2장·PDF (via print) 안내', async () => {
    const det = page.locator('details.claude-guide');
    assert((await det.count()) === 1, '안내 없음');
    await det.locator('summary').click();
    const txt = await det.innerText();
    assert(/Claude Exporter/.test(txt) && /PDF \(via print\)/.test(txt) && /Chrome에 추가/.test(txt), txt.slice(0, 120));
    const a = det.locator('a');
    assert((await a.getAttribute('href')).startsWith('https://chromewebstore.google.com/'), '스토어 링크');
    assert((await a.getAttribute('rel')).includes('noopener'), 'rel');
    await page.waitForFunction(() => [...document.querySelectorAll('details.claude-guide img')].every((i) => i.complete && i.naturalWidth > 0));
    assert((await det.locator('img').count()) === 2, '사진 수');
    for (const i of await det.locator('img').all()) assert(((await i.getAttribute('alt')) || '').length > 5, 'alt 없음');
    await shot(page, 'step2-claude-guide');
    await det.locator('summary').click();
  });

  // (E) 업로드·분석 (역할 표지 있는 PDF만)
  await item('E1', '과제 PDF 업로드 시 본문 추출', async () => {
    await page.setInputFiles('#assignFile', fixture('h-report.pdf'));
    await page.waitForFunction(() => document.querySelector('#submissionText').value.length > 100, null, { timeout: 15000 });
    const v = await page.inputValue('#submissionText');
    assert(/도서관/.test(v), v.slice(0, 80));
  });
  await item('E1b', '과제 워드(.docx)·한글(.hwpx, .hwp) 업로드 시 본문 추출, 표 칸 포함', async () => {
    const DOCFX = path.join(__dirname, 'doc-fixtures');
    const cases = [['basic.docx', /도서관 야간 개방/, '오후 10시까지'], ['basic.hwpx', /학내 공용 자전거/, '칸B'], ['basic.hwp', /졸업작품 전시/, '표 안의 칸 하나']];
    for (const [f, re, cell] of cases) {
      await page.setInputFiles('#assignFile', path.join(DOCFX, f));
      await page.waitForFunction((r) => new RegExp(r).test(document.querySelector('#submissionText').value), re.source, { timeout: 15000 });
      const v = await page.inputValue('#submissionText');
      assert(v.includes(cell), `${f}: '${cell}' 없음`);
      assert(!/[捤獥]/.test(v), `${f}: 제어 정보가 글자로 읽힘`);
      const info = await page.textContent('#assignBox');
      assert(/자를 읽었습니다/.test(info) && /빠진 부분/.test(info), `${f}: 확인 안내 없음`);
    }
    // 읽을 수 없는 파일은 이유가 보이고 본문은 그대로
    const before = await page.inputValue('#submissionText');
    for (const [f, re] of [['encrypted.hwp', /암호/], ['distribution.hwp', /배포용/], ['truncated.docx', /읽지 못했습니다/]]) {
      await page.setInputFiles('#assignFile', path.join(DOCFX, f));
      await page.waitForFunction((r) => new RegExp(r).test(document.querySelector('#assignBox .job.err')?.textContent || ''), re.source, { timeout: 10000 });
    }
    assert((await page.inputValue('#submissionText')) === before, '실패한 파일이 본문을 바꿈');
  });
  await item('E2', '과제 .txt 업로드와 AI 대화 PDF(표지 있음) 추출·표시', async () => {
    await page.setInputFiles('#assignFile', { name: '과제.txt', mimeType: 'text/plain', buffer: Buffer.from(assignText, 'utf8') });
    await page.waitForFunction((t) => document.querySelector('#submissionText').value.startsWith(t), assignText.slice(0, 20));
    await page.setInputFiles('#convFile', [fixture('a-ko-labels.pdf'), fixture('a-en-labels.pdf')]);
    await page.waitForFunction(() => document.querySelectorAll('.conv-item').length === 2, null, { timeout: 15000 });
    const t = await page.textContent('#convList');
    assert(/a-ko-labels\.pdf/.test(t) && /질문\/답변 구분됨/.test(t), t.slice(0, 200));
    assert(/턴 3개/.test(t) && /\d+쪽/.test(t) && /추정/.test(t), t.slice(0, 300));
    assert(!/구분하지 못했습니다/.test(t), '표지 있는 PDF에 경고가 뜸');
    await shot(page, 'step2-desktop');
    await page.click('#btnNext');
    assert((await stepNo(page)) === '3', '3단계로 못 감');
    const dep = await page.textContent('[data-role=dependency]');
    const aut = await page.textContent('[data-role=autonomy]');
    assert(/^\d+%$/.test(dep) && /^\d+%$/.test(aut), `${dep} ${aut}`);
    assert(/구간: (낮음|중간|높음)/.test(await page.textContent('[data-role=band]')), '구간 표시 없음');
    assert((await page.$$('[data-role=upper]')).length === 0, '표지 있는 PDF만 있는데 상한 추정 배지가 뜸');
    assert(/표절·부정행위를 판정하는 것이 아닙니다/.test(await page.textContent('#notJudge')), '판정 아님 문구 없음');
  });
  await item('E3', '역할 표지 없는 PDF는 상한 추정 경고 배지', async () => {
    await page.click('#btnPrev');
    await page.setInputFiles('#convFile', fixture('b-bubbles.pdf'));
    await page.waitForFunction(() => document.querySelectorAll('.conv-item').length === 3, null, { timeout: 15000 });
    const t = await page.textContent('.conv-item[data-conv] >> nth=2');
    assert(/구분하지 못했습니다/.test(t) && /상한 추정/.test(t), t.slice(0, 200));
    await page.click('#btnNext');
    await page.waitForSelector('[data-role=upper]');
    const badge = await page.textContent('[data-role=upper]');
    assert(/상한 추정/.test(badge), badge);
    assert(/구분하지 못했습니다/.test(await page.textContent('#stage')), '3단계에 경고 문장 없음');
    await shot(page, 'step3-desktop');
  });

  // (F) 정렬
  await item('F', '대화 카드가 연관도 내림차순', async () => {
    const rels = await cardRels(page);
    assert(rels.length >= 5, `카드 ${rels.length}개`);
    for (let i = 1; i < rels.length; i++) assert(rels[i - 1] >= rels[i], `정렬 깨짐 ${rels.join(',')}`);
    assert(rels[0] > 0.15 && rels[rels.length - 1] < 0.15, `연관도 범위 ${rels.join(',')}`);
  });

  // (G) 거부
  await item('G', '관련 대화 삭제 시도: 거부 문장 + 개수 불변', async () => {
    const before = (await cardRels(page)).length;
    const card = page.locator('#turnCards .turn-card').first();
    assert((await card.locator('[data-role=deletable]').count()) === 0, '첫 카드가 삭제 가능 표시');
    assert((await card.locator('.btn-del').count()) === 1, '삭제 버튼이 보이지 않음');
    await card.locator('.btn-del').click();
    const txt = await card.locator('.refusal').textContent();
    assert(txt.trim() === REFUSAL, txt);
    assert((await cardRels(page)).length === before, '개수가 변함');
  });

  // (I) 토글 (삭제 전에)
  await item('I', '토글 켜면 구분 표시, 문장 클릭 시 출처', async () => {
    assert((await page.$$('#stage .body-text.mark-on')).length === 0, '켜기 전에 표시됨');
    await page.check('#stage .ai-toggle');
    await page.waitForSelector('#stage .body-text.mark-on');
    const kinds = await page.$$eval('#stage .sent', (els) => [...new Set(els.map((e) => e.dataset.kind))]);
    assert(kinds.length >= 2, `구분 종류 ${kinds}`);
    const tag = await page.$eval('#stage .sent.k-verbatim', (e) => ({ t: getComputedStyle(e, '::after').content, u: getComputedStyle(e).textDecorationLine }));
    assert(/그대로/.test(tag.t) && /underline/.test(tag.u), JSON.stringify(tag));
    assert(await page.isVisible('#stage .legend'), '범례 없음');
    await page.click('#stage .sent.k-verbatim >> nth=0');
    const p = await page.textContent('#stage .source-panel');
    assert(/\d+번 대화/.test(p) && /\d+번째 턴/.test(p) && /겹침 근거 문장/.test(p), p);
    await shot(page, 'step3-toggle');
    // 키보드로도 가능
    await page.focus('#stage .sent.k-verbatim >> nth=0');
    await page.keyboard.press('Enter');
    assert(/번째 턴/.test(await page.textContent('#stage .source-panel')), '키보드 조작 실패');
  });

  // (H) 삭제
  await item('H', '무관 대화 삭제: 확인 단계, 개수 감소, 삭제 기록 반영', async () => {
    const before = (await cardRels(page)).length;
    const card = page.locator('#turnCards .turn-card:has([data-role=deletable])').first();
    assert((await card.count()) === 1, '삭제 가능 카드 없음');
    await card.locator('.btn-del').click();
    assert((await cardRels(page)).length === before, '확인 전에 삭제됨');
    await card.locator('.btn-confirm-del').click();
    await page.waitForFunction((n) => document.querySelectorAll('#turnCards .turn-card').length === n - 1, before);
    await page.click('#btnNext');
    const d = await page.textContent('#delSummary');
    assert(/1건/.test(d), d);
    assert((await page.$$('#report table.del-table tbody tr')).length === 1, '삭제 표 행 수');
  });

  // (J) 스캔·손상
  await item('J', '스캔본/손상/암호 PDF 업로드 시 안내', async () => {
    await page.click('#stepper li:nth-child(2) button');
    for (const [f, re] of [['f-scan.pdf', /스캔|글자/], ['g-garbage.pdf', /손상|PDF/], ['g-encrypted.pdf', /암호/], ['g-notpdf.pdf', /PDF/]]) {
      const before = await page.$$eval('.job.err', (e) => e.length);
      await page.setInputFiles('#convFile', fixture(f));
      await page.waitForFunction((n) => document.querySelectorAll('.job.err').length > n, before, { timeout: 15000 });
      const t = await page.$$eval('.job.err', (e) => e[e.length - 1].textContent);
      assert(re.test(t) && t.includes(f), `${f}: ${t.slice(0, 120)}`);
    }
    assert((await page.$$('.conv-item')).length === 3, '실패한 파일이 목록에 추가됨');
    // 같은 파일 다시 올리기는 막혀 삭제 규칙을 우회하지 못함
    await page.setInputFiles('#convFile', fixture('a-ko-labels.pdf'));
    await page.waitForFunction(() => /이미 올린 파일/.test(document.querySelector('#convBox').textContent));
    assert((await page.$$('.conv-item')).length === 3, '중복 추가됨');
    await shot(page, 'step2-errors');
  });

  // (C)(K) 내역서와 교수용
  let savedJson = null;
  await item('C', '내역서 안에도 로고(<img>)가 있고 print 미디어에서도 보임', async () => {
    await page.click('#stepper li:nth-child(4) button');
    await page.waitForSelector('#report .report-logo');
    const r = await page.evaluate(() => { const i = document.querySelector('#report .report-logo'); return { w: i.naturalWidth, alt: i.alt, tag: i.tagName }; });
    assert(r.tag === 'IMG' && r.w > 0 && r.alt === '명지대학교', JSON.stringify(r));
    await page.emulateMedia({ media: 'print' });
    const pr = await page.evaluate(() => {
      const i = document.querySelector('#report .report-logo'); const b = i.getBoundingClientRect();
      return { w: b.width, h: b.height, disp: getComputedStyle(i).display, vis: getComputedStyle(i).visibility, hdr: getComputedStyle(document.querySelector('.app-header')).display, marks: getComputedStyle(document.querySelector('#report .sent.k-verbatim'), '::after').content, deco: getComputedStyle(document.querySelector('#report .sent.k-verbatim')).textDecorationLine };
    });
    assert(pr.w > 100 && pr.h > 20 && pr.disp !== 'none' && pr.vis === 'visible', JSON.stringify(pr));
    assert(pr.hdr === 'none', '인쇄에서 앱 머리글이 보임');
    assert(/그대로/.test(pr.marks) && /underline/.test(pr.deco), `인쇄 구분 표시 ${pr.marks} ${pr.deco}`);
    await page.emulateMedia({ media: 'screen' });
    await shot(page, 'step4-desktop');
  });
  await item('K', '제출 파일 저장 후 교수용 탭에서 일치, 한 글자 바꾸면 불일치', async () => {
    await page.fill('#reflection', '성찰 내용입니다.');
    await page.waitForTimeout(500);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    savedJson = fs.readFileSync(await dl.path(), 'utf8');
    const doc = JSON.parse(savedJson);
    assert(doc.code && doc.claimed && doc.version === 2, '봉인 안 됨');
    const printed = await page.textContent('#reportCode');
    assert(printed === doc.code, `내역서 코드 ${printed} != 파일 코드 ${doc.code}`);
    await page.click('#tabbtn-prof');
    await page.setInputFiles('#profFile', { name: 'a.json', mimeType: 'application/json', buffer: Buffer.from(savedJson) });
    await page.waitForSelector('#verdict');
    assert(/일치합니다/.test(await page.textContent('#verdict .big')), await page.textContent('#verdict'));
    assert((await page.$$('#profReport .report-logo')).length === 1, '교수용 내역서에 로고 없음');
    assert((await page.$$('#view-prof .btn-del, #view-prof .btn-confirm-del')).length === 0, '교수용에 삭제 버튼');
    const rels = await page.$$eval('#profReport .turn-card', (els) => els.map((e) => Number(e.dataset.rel)));
    for (let i = 1; i < rels.length; i++) assert(rels[i - 1] >= rels[i], '교수용 정렬');
    assert((await page.$$('#profReport .ai-toggle')).length === 1, '교수용 토글 없음');
    await shot(page, 'prof-ok');
    const tampered = savedJson.replace('시험학생(예시)', '시험학생(예시)X');
    assert(tampered !== savedJson, '치환 실패');
    await page.setInputFiles('#profFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(tampered) });
    await page.waitForFunction(() => /불일치/.test((document.querySelector('#verdict .big') || { textContent: '' }).textContent));
    assert(/확인 코드/.test(await page.textContent('#verdict')), '이유 없음');
    await shot(page, 'prof-bad');
    await page.setInputFiles('#profFile', { name: 'c.json', mimeType: 'application/json', buffer: Buffer.from('{"x":1}') });
    await page.waitForFunction(() => /불일치/.test((document.querySelector('#verdict .big') || { textContent: '' }).textContent));
    await page.click('#tabbtn-student');
  });

  // (L) 예시 데이터 (새 컨텍스트: 저장소 비어 있음)
  const page2 = await newPage();
  await page2.goto(BASE);
  await item('L', '예시 데이터 버튼: 3단계, 대화 7개, 규칙 동작', async () => {
    await page2.click('#btnDemo');
    await page2.waitForSelector('#turnCards .turn-card');
    assert((await stepNo(page2)) === '3', '3단계로 안 감');
    const rels = await cardRels(page2);
    assert(rels.length === 7, `카드 ${rels.length}개`);
    assert((await page2.$$('[data-role=deletable]')).length === 4, '삭제 가능 표시 수');
    await page2.click('#stepper li:nth-child(1) button');
    assert(/\(예시\)/.test(await page2.inputValue('#f-student')), '이름에 (예시) 표기 없음');
    await page2.click('#stepper li:nth-child(3) button');
    await page2.check('#stage .ai-toggle');
    const kinds = await page2.$$eval('#stage .sent', (els) => [...new Set(els.map((e) => e.dataset.kind))].sort());
    assert(kinds.length === 4, `예시 문장 종류 ${kinds}`);
    await shot(page2, 'demo-step3-toggle');
    await page2.locator('#turnCards .turn-card').first().locator('.btn-del').click();
    assert((await page2.locator('#turnCards .refusal').first().textContent()).trim() === REFUSAL, '예시에서 거부 문장');
    // 새로고침해도 저장돼 있음
    await page2.reload();
    assert((await stepNo(page2)) === '3' && (await cardRels(page2)).length === 7, '저장 복원 실패');
  });
  await item('L2', '"처음부터 다시"는 확인 후 초기화', async () => {
    await page2.click('#btnReset');
    assert((await page2.$$('#confirmBar [role=alertdialog]')).length === 1, '확인 막대 없음');
    await page2.click('#confirmBar .primary');
    assert((await stepNo(page2)) === '1' && (await page2.inputValue('#f-student')) === '', '초기화 안 됨');
  });

  // (N) 모바일
  await item('N', '모바일 390px 가로 스크롤 없음 (1~4단계, 교수용)', async () => {
    const m = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await m.goto(BASE);
    const over = async (label) => {
      const r = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert(r.sw <= r.cw, `${label}: scrollWidth ${r.sw} > ${r.cw}`);
    };
    await over('1단계'); await shot(m, 'step1-mobile');
    await m.click('#btnDemo');
    await m.waitForSelector('#turnCards .turn-card');
    await over('3단계'); await shot(m, 'step3-mobile');
    await m.check('#stage .ai-toggle'); await over('3단계 토글');
    await m.click('#stepper li:nth-child(2) button'); await over('2단계'); await shot(m, 'step2-mobile');
    await m.click('#stepper li:nth-child(4) button'); await m.waitForSelector('#report .report-logo'); await over('4단계'); await shot(m, 'step4-mobile');
    await m.click('#tabbtn-prof'); await over('교수용');
    await m.close();
  });

  // 다크 모드
  await item('P', '인쇄·PDF 저장: 토글을 꺼 둬도 표시·범례·펼친 원문·출처 표가 PDF에 들어가고, 인쇄 뒤 원상 복구', async () => {
    const { execFileSync } = require('child_process');
    const pg = await newPage();
    await pg.goto(BASE);
    await pg.click('#btnDemo'); await pg.waitForSelector('#turnCards .turn-card');
    await pg.click('#btnNext'); await pg.waitForSelector('#report .body-text');
    await pg.locator('#report .ai-toggle').uncheck();
    const st = () => pg.evaluate(() => ({ on: document.querySelector('#report .body-text').classList.contains('mark-on'), open: document.querySelectorAll('#report details[open]').length, total: document.querySelectorAll('#report details').length, checked: document.querySelector('#report .ai-toggle').checked }));
    const before = await st();
    assert(!before.on && before.open === 0 && before.total > 0, JSON.stringify(before));
    await pg.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const during = await st();
    assert(during.on && during.open === during.total, '인쇄 중 상태 ' + JSON.stringify(during));
    await pg.emulateMedia({ media: 'print' });
    // Chrome 자동 머리글·바닥글(날짜, 문서 제목, 주소, 쪽번호)은 @page 여백이 0이어야 붙지 않는다. 화면용 제목 '4. 제출'도 인쇄에서 빠져야 한다.
    const pageMargin = await pg.evaluate(() => { for (const sh of document.styleSheets) for (const r of sh.cssRules) { const inner = r.cssRules ? [...r.cssRules] : []; for (const x of [r, ...inner]) if (x.type === CSSRule.PAGE_RULE) return x.style.margin; } return null; });
    assert(pageMargin === '0px' || pageMargin === '0', '@page 여백 ' + pageMargin);
    assert(await pg.evaluate(() => { const h = [...document.querySelectorAll('#stage h2')].find((x) => x.textContent.includes('4. 제출')); return !h || getComputedStyle(h).display === 'none'; }), "'4. 제출' 제목이 인쇄에 남음");
    assert(await pg.evaluate(() => !!document.querySelector('#report')?.closest('table.pf')), '쪽 여백 표로 감싸지지 않음');
    // 쪽 여백용 표의 좌우 여백이 내역서 안의 표 칸으로 번지면 글자가 칸 밖으로 밀린다 (실제로 한 번 그랬다).
    const innerPad = await pg.evaluate(() => { const td = document.querySelector('#report table:not(.pf) td'); return td ? parseFloat(getComputedStyle(td).paddingLeft) : 0; });
    assert(innerPad < 20, '내역서 안 표 칸의 왼쪽 여백 ' + innerPad + 'px');
    const tmp = path.join(require('os').tmpdir(), `e2e-print-${process.pid}.pdf`);
    await pg.pdf({ path: tmp, format: 'A4', printBackground: true });
    await pg.emulateMedia({ media: 'screen' });
    await pg.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    const after = await st();
    assert(!after.on && after.open === 0 && !after.checked, '인쇄 뒤 복구 ' + JSON.stringify(after));
    let txt = '';
    try { txt = execFileSync('pdftotext', ['-layout', tmp, '-'], { encoding: 'utf8' }); } catch { txt = null; }
    fs.rmSync(tmp, { force: true });
    if (txt !== null) {
      const flat = txt.replace(/\s+/g, ' ');
      for (const k of ['그대로 반영', '수정 반영', '학생 원문 교정', '직접 작성', 'AI 반영으로 표시된 문장과 출처', '학생의 프롬프트', 'AI 응답']) assert(flat.includes(k), `PDF에 '${k}' 없음`);
    }
    await pg.close();
  });
  await item('Dark', '다크 모드 화면 확인(로고 흰 알약)', async () => {
    const dk = await newPage({ colorScheme: 'dark' });
    await dk.goto(BASE);
    await dk.click('#btnDemo');
    await dk.waitForSelector('#turnCards .turn-card');
    await dk.check('#stage .ai-toggle');
    const r = await dk.evaluate(() => ({ bg: getComputedStyle(document.querySelector('.brand')).backgroundColor, rad: getComputedStyle(document.querySelector('.brand')).borderRadius, body: getComputedStyle(document.body).backgroundColor }));
    assert(r.bg === 'rgb(255, 255, 255)' && parseFloat(r.rad) >= 20, JSON.stringify(r));
    assert(r.body === 'rgb(10, 18, 38)', r.body);
    await shot(dk, 'dark-step3');
    await dk.close();
  });

  // file:// 과 샌드박스 iframe 번들
  await item('File', 'file:// 로 열어도 PDF·워드·한글 추출 동작 (fake worker 폴백)', async () => {
    const f = await newPage();
    await f.goto('file://' + path.join(ROOT, 'index.html'));
    await fillMeta(f);
    await f.click('#btnNext');
    await f.setInputFiles('#convFile', fixture('a-ko-labels.pdf'));
    await f.waitForFunction(() => document.querySelectorAll('.conv-item').length === 1, null, { timeout: 20000 });
    // 압축 해제는 Blob 스트림이 file:// 에서 막히고, Chrome은 압축 뒤 여분 바이트를 오류로 본다. 둘 다 여기서 걸러진다.
    for (const [fn, cell] of [['basic.docx', '오후 10시까지'], ['trailing-junk.hwp', '표 안의 칸 하나'], ['basic.hwpx', '칸B']]) {
      await f.setInputFiles('#assignFile', path.join(__dirname, 'doc-fixtures', fn));
      await f.waitForFunction((c) => document.querySelector('#submissionText').value.includes(c), cell, { timeout: 15000 });
    }
    assert(await f.evaluate(() => document.querySelector('.brand-logo').naturalWidth > 0), 'file:// 로고');
    await f.close();
  });
  await item('Bundle', '단일 HTML(샌드박스 iframe)에서 로고·PDF 추출 동작', async () => {
    const b = await newPage();
    await b.goto(`http://127.0.0.1:${port}/wrap.html`);
    const fr = b.frameLocator('#f');
    await fr.locator('#btnDemo').click();
    await fr.locator('#turnCards .turn-card').first().waitFor();
    const nat = await fr.locator('.brand-logo').evaluate((i) => i.naturalWidth);
    assert(nat > 0, '번들 로고');
    await fr.locator('#stepper li:nth-child(2) button').click();
    await fr.locator('#convFile').setInputFiles(fixture('a-en-labels.pdf'));
    await fr.locator('.conv-item').nth(4).waitFor({ timeout: 20000 });
    assert((await fr.locator('.job.err').count()) === 0, '번들 PDF 오류');
    await b.close();
  });

  await item('M', '콘솔 오류 0건, 실패한 자원 요청 없음', async () => {
    const real = badResponses;
    const msgs = consoleErrors;
    assert(msgs.length === 0 && real.length === 0, `console ${msgs.length}건 ${msgs.slice(0, 3).join(' | ')} / http ${real.slice(0, 3).join(' | ')}`);
  });

  await browser.close();
  srv.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n통과 ${passed} / 전체 ${results.length}`);
  if (failures.length) { console.log('실패 항목:\n  ' + failures.join('\n  ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
