'use strict';
/**
 * Pdf 모듈 단위 시험 (Node). 실행: node --test test/pdf.test.js
 * buildText 는 합성 입력으로 시험한다. 실제 PDF → 텍스트는 test/pdf-e2e.js 가 브라우저에서 시험한다.
 *
 * 한계: 아래 입력은 2026-10-16 에 확인한 실제 Chrome 154 인쇄 PDF 두 건(Gemini 1, ChatGPT 1; 한국어 화면)의 구조와
 * "있을 법한 모양"을 본뜬 것이다. 영어 화면·Claude 등의 실제 PDF는 확인하지 못했다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Pdf = require('../src/pdf.js');
const Parse = require('../src/parse.js');
const Core = require('../src/core.js');
const Analyze = require('../src/analyze.js');

/* ── 합성 쪽 만들기 ── 쪽 폭 600, 좌우 여백 50 → 오른쪽 한계 550. 글자 폭: 한글 1em, 공백 0.3em, 그 밖 0.55em. */
const PW = 600, PH = 800, LEFT = 50, RIGHT = 550;
const tw = (s, h = 10) => [...s].reduce((n, c) => n + (/[\uac00-\ud7af]/.test(c) ? 1 : c === ' ' ? 0.3 : 0.55) * h, 0);
const item = (str, x, y, o = {}) => ({ str, x, y, w: o.w != null ? o.w : tw(str, o.h || 10), h: o.h || 10, font: o.font });
/** 보통 줄 */
const ln = (y, text, o = {}) => [item(text, o.x != null ? o.x : LEFT, y, o)];
/** 오른쪽 한계까지 꽉 찬 줄(줄바꿈된 줄) */
const full = (y, text, o = {}) => { const x = o.x != null ? o.x : LEFT; return [item(text, x, y, { ...o, w: (o.right || RIGHT) - x })]; };
const page = (...lines) => ({ width: PW, height: PH, items: lines.flat() });
const hdr = (y, left, right, h = 8) => [item(left, 24, y, { h }), item(right, 330, y, { h })];
const out = (...pages) => Pdf.buildText(pages);

/* ───────────────────────── buildText ───────────────────────── */

test('줄바꿈으로 갈라진 문단은 공백 한 칸으로 이어 붙인다', () => {
  const t = out(page(full(100, '이 문단은 두 번 줄이 바뀌어서 세 줄로'), full(116, '나뉘어 있지만 원래는 하나의 문장이므로'), ln(132, '한 줄로 이어져야 합니다.')));
  assert.equal(t, '이 문단은 두 번 줄이 바뀌어서 세 줄로 나뉘어 있지만 원래는 하나의 문장이므로 한 줄로 이어져야 합니다.');
});

test('세로 간격이 기준 줄 간격의 약 1.4배를 넘으면 문단 경계(빈 줄 하나)', () => {
  const t = out(page(full(100, '첫째 문단의 첫 줄은 꽉 찬 줄입니다'), ln(116, '첫째 문단의 끝.'), full(148, '둘째 문단의 첫 줄도 꽉 찬 줄입니다'), ln(164, '둘째 문단의 끝.')));
  assert.equal(t, '첫째 문단의 첫 줄은 꽉 찬 줄입니다 첫째 문단의 끝.\n\n둘째 문단의 첫 줄도 꽉 찬 줄입니다 둘째 문단의 끝.');
});

test('문단 사이는 빈 줄 하나이고 3개 이상 연속되지 않는다', () => {
  const t = out(page(ln(100, '가나다라.'), ln(160, '마바사아.'), ln(260, '자차카타.')));
  assert.equal(t, '가나다라.\n\n마바사아.\n\n자차카타.');
});

test('쪽마다 반복되는 머리글·바닥글(제목, n/m)을 지우고 본문은 남긴다', () => {
  const W3 = ['첫째', '둘째', '셋째'];
  const pages = [1, 2, 3].map((n) => page(hdr(22, '문서 제목', '2026. 10. 16.'), ln(100, `${W3[n - 1]} 쪽 본문 첫 문장입니다.`), ln(300, `${W3[n - 1]} 쪽 본문 둘째 문장입니다.`), hdr(775, 'https://example.com/chat/abc', `${n}/3`)));
  const t = out(...pages);
  assert.ok(!/문서 제목|2026\. 10|example\.com|\d\/3/.test(t), t);
  for (const w of W3) assert.ok(t.includes(`${w} 쪽 본문 첫 문장입니다.`) && t.includes(`${w} 쪽 본문 둘째 문장입니다.`), t);
});

test('실제 Chrome 인쇄 머리글 형식(한국어 날짜·시각 + 제목, URL + n/m)은 1쪽짜리 문서에서도 지운다', () => {
  const t = out(page(hdr(24, '26. 10. 16. 오후 4:57', '대화 제목 예시'), ln(100, '본문 첫 문장입니다.', { h: 12 }), ln(130, '본문 둘째 문장입니다.', { h: 12 }), hdr(775, 'https://gemini.example.invalid/app/0fed98e3?hl=ko', '1/1')));
  assert.equal(t, '본문 첫 문장입니다.\n\n본문 둘째 문장입니다.');
});

test('영어 로케일 인쇄 머리글(10/16/26, 4:57 PM)도 지운다', () => {
  const t = out(page(hdr(24, '10/16/26, 4:57 PM', 'Chat title'), ln(100, 'Body sentence one is here.', { h: 12 }), hdr(775, 'https://chatgpt.example.invalid/c/abc', '1/1')));
  assert.equal(t, 'Body sentence one is here.');
});

test('쪽번호만 있는 줄(Page 1, - 1 -, 1 / 3, 3쪽)을 지운다', () => {
  for (const no of ['Page 1', '- 1 -', '1 / 3', '3쪽', '1']) {
    const t = out(page(ln(100, '본문입니다.'), ln(780, no, { x: 290, h: 9 })));
    assert.equal(t, '본문입니다.', no);
  }
});

test('본문에 우연히 머리글과 같은 문구가 한 번 나오면 지우지 않는다', () => {
  const pages = [1, 2, 3].map((n) => page(hdr(22, '문서 제목', ''), ln(100, `${n}쪽 첫 줄입니다.`), n === 2 ? ln(300, '문서 제목') : [], ln(400, `${n}쪽 마지막 줄입니다.`)));
  const t = out(...pages);
  assert.equal((t.match(/문서 제목/g) || []).length, 1, t);
});

test('쪽 가장자리가 아닌 본문 속 URL·날짜·숫자 줄은 지우지 않는다', () => {
  const t = out(page(ln(100, '참고 자료는 아래와 같습니다.'), ln(300, 'https://example.com/paper.pdf', { h: 8 }), ln(330, '26. 10. 16. 오후 4:57', { h: 8 }), ln(360, '42', {}), ln(500, '끝.')));
  assert.ok(t.includes('https://example.com/paper.pdf') && t.includes('26. 10. 16. 오후 4:57') && t.includes('\n\n42\n\n'), t);
});

test('쪽이 바뀌어도 문단이 이어지면 합친다(앞 쪽 마지막 줄이 꽉 차고 종결 부호 없음)', () => {
  const p1 = page(ln(100, '앞 문단입니다.'), full(740, '이 문장은 쪽 맨 아래에서 시작해서 다음 쪽까지'));
  const p2 = page(ln(60, '이어지는 부분입니다.'), ln(200, '다른 문단입니다.'));
  assert.equal(out(p1, p2), '앞 문단입니다.\n\n이 문장은 쪽 맨 아래에서 시작해서 다음 쪽까지 이어지는 부분입니다.\n\n다른 문단입니다.');
});

test('앞 쪽 마지막 줄이 종결 부호로 끝나면 쪽이 바뀔 때 합치지 않는다', () => {
  const p1 = page(ln(100, '앞 문단입니다.'), full(740, '이 문장은 쪽 맨 아래에서 끝나는 문장입니다.'));
  const p2 = page(ln(60, '새 문단이 다음 쪽에서 시작합니다.'));
  assert.equal(out(p1, p2), '앞 문단입니다.\n\n이 문장은 쪽 맨 아래에서 끝나는 문장입니다.\n\n새 문단이 다음 쪽에서 시작합니다.');
});

test('쪽 끝의 짧은 줄(제목·항목)은 다음 쪽 첫 줄과 합치지 않는다', () => {
  const p1 = page(ln(100, '본문입니다.'), ln(740, '다음 항목 제목'));
  const p2 = page(ln(60, '다음 쪽 내용입니다.'));
  assert.equal(out(p1, p2), '본문입니다.\n\n다음 항목 제목\n\n다음 쪽 내용입니다.');
});

test('큰 글씨 제목은 앞뒤 본문과 합치지 않는다', () => {
  const t = out(page(full(100, '본문 첫 줄이 꽉 차 있습니다 이어서'), ln(116, '본문 끝 줄.'), ln(150, '큰 제목', { h: 16 }), full(180, '제목 다음 본문도 꽉 차 있습니다 이어서'), ln(196, '본문 끝.')));
  assert.equal(t, '본문 첫 줄이 꽉 차 있습니다 이어서 본문 끝 줄.\n\n큰 제목\n\n제목 다음 본문도 꽉 차 있습니다 이어서 본문 끝.');
});

test('고정폭 글꼴 줄은 합치지 않고 줄과 들여쓰기를 유지한다', () => {
  const M = 'monospace';
  const t = out(page(
    ln(100, '아래 코드를 보세요.'),
    [item('def f(x):', 50, 140, { font: M, w: 54 })],
    [item('    ', 50, 154, { font: M, w: 24 }), item('if x:', 74, 154, { font: M, w: 30 })],
    [item('        ', 50, 168, { font: M, w: 48 }), item('return 1', 98, 168, { font: M, w: 48 })],
    [item('    ', 50, 182, { font: M, w: 24 }), item('return 0', 74, 182, { font: M, w: 48 })],
    ln(230, '코드 설명입니다.'),
  ));
  assert.equal(t, '아래 코드를 보세요.\n\ndef f(x):\n    if x:\n        return 1\n    return 0\n\n코드 설명입니다.');
});

test('한글 주석·문자열이 섞인 코드 줄(대체 글꼴)도 코드 블록 안에 유지한다', () => {
  const M = 'monospace';
  const t = out(page(
    [item('def f():', 50, 140, { font: M, w: 48 })],
    [item('    ', 50, 154, { font: M, w: 24 }), item('"""', 74, 154, { font: M, w: 18 }), item('한글 설명.', 92, 154, { w: 50, font: 'sans-serif' }), item('"""', 142, 154, { font: M, w: 18 })],
    [item('    ', 50, 168, { font: M, w: 24 }), item('return 1', 74, 168, { font: M, w: 48 })],
  ));
  assert.equal(t, 'def f():\n    """한글 설명."""\n    return 1');
});

test('본문 속 인라인 코드 줄은 코드 블록으로 보지 않는다', () => {
  const t = out(page(
    [item('x = 1', 50, 100, { font: 'monospace', w: 30 }), item(' 을 실행한 다음', 80, 100, { w: RIGHT - 80 })],
    ln(116, '결과를 확인합니다.'),
  ));
  assert.equal(t, 'x = 1 을 실행한 다음 결과를 확인합니다.');
});

test('글머리 기호 글자가 있는 목록 항목은 줄을 유지한다', () => {
  const t = out(page(ln(100, '목록 앞 문장입니다.'), ln(140, '• 첫째 항목'), ln(156, '• 둘째 항목'), ln(172, '1. 번호 항목'), ln(220, '목록 뒤 문장입니다.')));
  assert.equal(t, '목록 앞 문장입니다.\n\n• 첫째 항목\n• 둘째 항목\n1. 번호 항목\n\n목록 뒤 문장입니다.');
});

test('글머리 기호가 도형이라 글자가 없어도, 오른쪽 한계에 못 닿은 줄이면 항목을 분리한다', () => {
  // 마침표 없는 항목이 줄 간격 그대로 이어진다(실제 ChatGPT 인쇄본에서 관찰한 모양)
  const t = out(page(ln(100, '벽돌 질감이 느껴지는 벽', { x: 84 }), ln(116, '벽면의 미묘한 색 변화', { x: 84 }), ln(132, '바닥의 타일 재질감', { x: 84 }), full(148, '긴 항목은 오른쪽 한계까지 가서 줄이 바뀌고', { x: 84 }), ln(164, '나머지가 다음 줄에 남습니다.', { x: 84 }), full(300, '본문 문단이 있어서 왼쪽 여백 기준이 잡힙니다', { x: LEFT })));
  assert.equal(t, '벽돌 질감이 느껴지는 벽\n\n벽면의 미묘한 색 변화\n\n바닥의 타일 재질감\n\n긴 항목은 오른쪽 한계까지 가서 줄이 바뀌고 나머지가 다음 줄에 남습니다.\n\n본문 문단이 있어서 왼쪽 여백 기준이 잡힙니다');
});

test('표처럼 칸이 정렬된 줄은 합치지 않고 칸을 | 로 구분한다', () => {
  const row = (y, a, b, c) => [item(a, 50, y), item(b, 200, y), item(c, 350, y)];
  const t = out(page(ln(100, '표 앞 문장입니다.'), row(140, '항목', '금액', '담당'), row(156, '재료비', '12000', '김하나'), row(172, '대여료', '8000', '이둘'), ln(230, '표 뒤 문장입니다.')));
  assert.equal(t, '표 앞 문장입니다.\n\n항목 | 금액 | 담당\n재료비 | 12000 | 김하나\n대여료 | 8000 | 이둘\n\n표 뒤 문장입니다.');
});

test('영어 줄 끝 하이픈: 붙인 낱말이 문서에 온전히 있으면 하이픈을 빼고, 없으면 합성어로 보고 남긴다', () => {
  const t = out(page(
    full(100, 'The report describes an auto-'), ln(116, 'mated pipeline. The automated pipeline is fast.'),
    full(160, 'This is a well-'), ln(176, 'known result in the field.'),
  ));
  assert.ok(t.includes('describes an automated pipeline.'), t);
  assert.ok(t.includes('This is a well-known result in the field.'), t);
});

test('사용자 말풍선처럼 오른쪽으로 치우친 좁은 블록의 줄바꿈도 이어 붙이고 AI 응답과는 분리한다', () => {
  const R2 = 535;
  const t = out(page(
    full(100, '질문의 첫 줄이 좁은 블록 안에서', { x: 250, right: R2 }), full(116, '두 번째 줄로 이어지고 다시', { x: 250, right: R2 }), full(132, '세 번째 줄로 이어진 뒤에', { x: 250, right: R2 }), ln(148, '끝납니다?', { x: 250 }),
    full(200, '답변의 첫 줄은 왼쪽 여백에서 시작하고', { x: LEFT }), full(216, '오른쪽 한계까지 꽉 차서 이어집니다', { x: LEFT }), ln(232, '답변 끝.'),
  ));
  assert.equal(t, '질문의 첫 줄이 좁은 블록 안에서 두 번째 줄로 이어지고 다시 세 번째 줄로 이어진 뒤에 끝납니다?\n\n답변의 첫 줄은 왼쪽 여백에서 시작하고 오른쪽 한계까지 꽉 차서 이어집니다 답변 끝.');
});

test('역할 표지만 있는 줄은 본문과 합치지 않고, 표지 뒤에 본문이 붙은 줄에는 다음 줄이 이어진다', () => {
  const t = out(page(
    ln(100, '내가 한 말:', { h: 9 }), full(130, '질문 본문이 이 줄에서 시작해서', { x: 210, right: 535 }), full(146, '두 번째 줄로 이어집니다', { x: 210, right: 535 }), ln(162, '끝.', { x: 210 }),
    ln(200, 'ChatGPT 답변:', { h: 9 }), full(230, '답변 본문이 다음 줄에서 시작하고 꽉 차서', { x: LEFT }), ln(246, '이어집니다.'),
    full(300, 'Response: 같은 줄에 본문이 붙은 표지가 있고 그 줄이 꽉 차서', { x: LEFT }), ln(316, '다음 줄이 이어집니다.'),
  ));
  assert.equal(t, '내가 한 말:\n\n질문 본문이 이 줄에서 시작해서 두 번째 줄로 이어집니다 끝.\n\nChatGPT 답변:\n\n답변 본문이 다음 줄에서 시작하고 꽉 차서 이어집니다.\n\nResponse: 같은 줄에 본문이 붙은 표지가 있고 그 줄이 꽉 차서 다음 줄이 이어집니다.');
});

test('수정한 질문이라 표지가 연달아 나와도 두 표지 사이 내용을 지우지 않는다', () => {
  const t = out(page(ln(100, '내가 한 말:', { h: 9 }), ln(130, '수정 전 질문', { x: 210 }), ln(180, '내가 한 말:', { h: 9 }), ln(210, '수정 후 질문', { x: 210 })));
  assert.equal(t, '내가 한 말:\n\n수정 전 질문\n\n내가 한 말:\n\n수정 후 질문');
});

test('본문에 남은 마크다운 별표는 건드리지 않는다', () => {
  const t = out(page(ln(100, '**“영수증은 사진으로 남기기”**를 규칙으로 정한다.')));
  assert.equal(t, '**“영수증은 사진으로 남기기”**를 규칙으로 정한다.');
});

test('글자 사이가 벌어지면 공백, 붙어 있으면 공백 없음, 공백 글자 항목은 공백 한 칸', () => {
  const t = out(page([item('안녕', 50, 100), item('하세요', 70, 100), item('반갑', 130, 100), item(' ', 150, 100, { w: 3 }), item('습니다', 153, 100)]));
  assert.equal(t, '안녕하세요 반갑 습니다');
});

test('잘못된 입력에도 예외를 던지지 않는다', () => {
  for (const bad of [undefined, null, [], [{}], [{ items: null }], [{ items: [{ str: 5 }, null, { str: 'a' }] }], 'x', 3]) {
    assert.equal(typeof Pdf.buildText(bad), 'string');
  }
  assert.equal(Pdf.buildText([]), '');
});

test('쪽 높이·폭을 모르는 입력도 처리한다', () => {
  const t = Pdf.buildText([{ items: [item('본문 한 줄.', 50, 100)] }]);
  assert.equal(t, '본문 한 줄.');
});

/* ───────────────────────── toConversation ───────────────────────── */

test('표지가 있으면 Parse 로 턴을 나누고 parsed:ok', () => {
  const text = '나의 말:\n\n안녕\n\nChatGPT의 말:\n\n반가워요.\n\n나의 말:\n\n두 번째 질문\n\nChatGPT의 말:\n\n두 번째 답변';
  const c = Pdf.toConversation(text, { fileName: '대화.pdf', provider: 'chatgpt' });
  assert.equal(c.parsed, 'ok');
  assert.equal(c.provider, 'chatgpt');
  assert.equal(c.source, '대화.pdf');
  assert.equal(c.turns.length, 2);
  assert.deepEqual(c.turns.map((t) => [t.prompt, t.response]), [['안녕', '반가워요.'], ['두 번째 질문', '두 번째 답변']]);
  assert.ok(c.id && new Set(c.turns.map((t) => t.id).concat(c.id)).size === 3);
});

test('표지가 없으면 parsed:unparsed 이고 prompt 가 빈 의사 턴으로 나눈다', () => {
  const paras = Array.from({ length: 30 }, (_, i) => `${i + 1}번째 문단입니다. ` + '가나다라마바사 '.repeat(12).trim() + '.');
  const text = paras.join('\n\n');
  const c = Pdf.toConversation(text, { fileName: 'x.pdf' });
  assert.equal(c.parsed, 'unparsed');
  assert.ok(c.turns.length > 1);
  assert.ok(c.turns.every((t) => t.prompt === '' && t.response.length > 0));
});

test('의사 턴은 문단 경계에서 묶고 글자를 하나도 잃지 않는다', () => {
  const paras = Array.from({ length: 40 }, (_, i) => `문단${i} ` + '내용입니다 '.repeat(10 + (i % 7) * 6).trim());
  const text = paras.join('\n\n');
  const c = Pdf.toConversation(text, {});
  const rejoined = c.turns.map((t) => t.response).join('');
  assert.equal(rejoined.replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  for (const t of c.turns) assert.ok(t.response.length <= 1200, String(t.response.length));
  const mid = c.turns.slice(0, -1);
  assert.ok(mid.every((t) => t.response.length >= 600), mid.map((t) => t.response.length).join(','));
  // 문단 중간에서 끊기지 않았다: 각 묶음은 문단 전체의 이어 붙임이다
  for (const t of c.turns) for (const p of t.response.split('\n\n')) assert.ok(paras.includes(p), p.slice(0, 30));
});

test('1200자를 넘는 한 문단은 문장 끝에서 나누고 글자는 그대로 보존한다', () => {
  const para = Array.from({ length: 80 }, (_, i) => `이것은 ${i}번째 긴 문장입니다.`).join(' ');
  assert.ok(para.length > 1200);
  const c = Pdf.toConversation(para, {});
  assert.ok(c.turns.length >= 2);
  assert.ok(c.turns.every((t) => t.response.length <= 1200));
  assert.equal(c.turns.map((t) => t.response).join('').replace(/\s+/g, ''), para.replace(/\s+/g, ''));
  assert.ok(c.turns.slice(0, -1).every((t) => /[.]$/.test(t.response)));
});

test('공백 없는 긴 글도 글자를 잃지 않는다(이모지가 잘리지 않는다)', () => {
  const s = '가😀'.repeat(1500);
  const c = Pdf.toConversation(s, {});
  assert.equal(c.turns.map((t) => t.response).join(''), s);
  assert.ok(c.turns.every((t) => !/[\ud800-\udbff]$/.test(t.response) && !/^[\udc00-\udfff]/.test(t.response)));
});

test('provider 를 주면 그대로 쓰고, 없으면 본문으로 추정한다', () => {
  assert.equal(Pdf.toConversation('ChatGPT의 말: 안녕', { provider: 'claude' }).provider, 'claude');
  assert.equal(Pdf.toConversation('ChatGPT said: hi', {}).provider, 'chatgpt');
  assert.equal(Pdf.toConversation('그냥 글', {}).provider, 'other');
});

test('빈 텍스트·잘못된 인자도 예외 없이 빈 의사 대화', () => {
  for (const bad of ['', '  \n ', undefined, null]) {
    const c = Pdf.toConversation(bad, { fileName: 'a.pdf' });
    assert.equal(c.parsed, 'unparsed');
    assert.deepEqual(c.turns, []);
    assert.equal(c.source, 'a.pdf');
  }
});

/* ───────────────────────── guessProvider ───────────────────────── */

test('guessProvider: 서비스 이름과 주소로 추정, 없거나 동률이면 other', () => {
  assert.equal(Pdf.guessProvider('ChatGPT의 말: 안녕. https://chatgpt.com/c/abc'), 'chatgpt');
  assert.equal(Pdf.guessProvider('Claude: Hello. Claude can make mistakes.'), 'claude');
  assert.equal(Pdf.guessProvider('https://gemini.google.com/app/abc\nUser prompt: 질문\nResponse: 답'), 'gemini');
  assert.equal(Pdf.guessProvider('아무 서비스 이름도 없는 글입니다.'), 'other');
  assert.equal(Pdf.guessProvider('ChatGPT 와 Claude 를 비교'), 'other');
  assert.equal(Pdf.guessProvider(''), 'other');
  assert.equal(Pdf.guessProvider(null), 'other');
});

test('guessProvider: 긴 글에서는 앞뒤만 보므로 가운데의 우연한 언급은 영향이 작다', () => {
  const mid = ' 중간 문장.'.repeat(1000) + ' Claude Claude Claude Claude ' + ' 중간 문장.'.repeat(1000);
  assert.equal(Pdf.guessProvider('ChatGPT의 말: 시작' + mid + ' 끝'), 'chatgpt');
});

/* ───────────────────────── extract (pdfjsLib 을 흉내 낸 가짜로 오류 경로 시험) ───────────────────────── */

function fakeLib(o = {}) {
  const calls = { getDocument: [], destroyed: 0 };
  const H = 800;
  const lib = {
    calls,
    GlobalWorkerOptions: {},
    Util: { transform: (m1, m2) => [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]] },
    getDocument(opts) {
      calls.getDocument.push(opts);
      if (o.throwSync) throw new Error('boom');
      const doc = {
        numPages: o.numPages || 1,
        async getPage(n) {
          if (o.failPages && o.failPages.includes(n)) throw new Error('page fail');
          const lines = o.pages ? o.pages[n - 1] || [] : [[`${['첫째', '둘째', '셋째'][n - 1]} 쪽 안녕하세요 테스트 문서입니다 정상 추출 시험.`, 50, 300]];
          return {
            getViewport: () => ({ transform: [1, 0, 0, -1, 0, H], width: 600, height: H }),
            async getTextContent() { return { items: lines.map(([str, x, y]) => ({ str, width: tw(str), height: 10, transform: [10, 0, 0, 10, x, H - y], fontName: 'f1' })), styles: { f1: { fontFamily: 'sans-serif' } } }; },
            cleanup() {},
          };
        },
        async destroy() { calls.destroyed++; },
      };
      return { promise: o.rejectWith ? Promise.reject(Object.assign(new Error('x'), { name: o.rejectWith })) : Promise.resolve(doc), destroy: async () => { calls.destroyed++; } };
    },
  };
  return lib;
}
async function withLib(lib, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'pdfjsLib');
  const prev = globalThis.pdfjsLib;
  globalThis.pdfjsLib = lib;
  try { return await fn(); } finally { if (had) globalThis.pdfjsLib = prev; else delete globalThis.pdfjsLib; }
}
const PDFISH = () => new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(200)).buffer;
const isKorean = (notes) => notes.length > 0 && notes.every((n) => /[가-힣]/.test(n));

test('extract: 예외를 던지지 않고 ok:false + 한국어 안내 — 빈 파일·PDF 아님·너무 큰 파일', async () => {
  let r = await Pdf.extract(new ArrayBuffer(0));
  assert.equal(r.ok, false); assert.ok(isKorean(r.notes)); assert.match(r.notes.join(), /빈 파일|0바이트/);
  r = await Pdf.extract(new TextEncoder().encode('그냥 글입니다').buffer);
  assert.equal(r.ok, false); assert.match(r.notes.join(), /PDF 파일이 아닙니다/);
  const big = new Uint8Array(Pdf.LIMITS.maxBytes + 1); big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  r = await Pdf.extract(big);
  assert.equal(r.ok, false); assert.match(r.notes.join(), /30MB/);
  for (const bad of [undefined, null, 'abc', 5, {}]) { r = await Pdf.extract(bad); assert.equal(r.ok, false); assert.ok(isKorean(r.notes)); }
});

test('extract: 30MB 정확히는 허용 한도 안이다(한도 판정이 어긋나지 않는다)', async () => {
  assert.equal(Pdf.LIMITS.maxBytes, 30 * 1024 * 1024);
  assert.equal(Pdf.LIMITS.maxPages, 300);
});

test('extract: pdf.js 가 없으면 ok:false + 안내', async () => {
  const r = await withLib(undefined, () => Pdf.extract(PDFISH()));
  assert.equal(r.ok, false); assert.match(r.notes.join(), /pdf\.js|불러오지/);
});

test('extract: 암호화 PDF(PasswordException)와 손상 PDF(InvalidPDFException)를 구분해 안내한다', async () => {
  let r = await withLib(fakeLib({ rejectWith: 'PasswordException' }), () => Pdf.extract(PDFISH()));
  assert.equal(r.ok, false); assert.match(r.notes.join(), /암호/);
  r = await withLib(fakeLib({ rejectWith: 'InvalidPDFException' }), () => Pdf.extract(PDFISH()));
  assert.equal(r.ok, false); assert.match(r.notes.join(), /손상/);
  r = await withLib(fakeLib({ throwSync: true }), () => Pdf.extract(PDFISH()));
  assert.equal(r.ok, false); assert.ok(isKorean(r.notes));
});

test('extract: 300쪽 초과는 ok:false 와 쪽수 안내, 파싱은 시작하지 않는다', async () => {
  const lib = fakeLib({ numPages: 301 });
  const r = await withLib(lib, () => Pdf.extract(PDFISH()));
  assert.equal(r.ok, false); assert.equal(r.pageCount, 301); assert.match(r.notes.join(), /301쪽|300쪽/);
  assert.equal(lib.calls.destroyed >= 1, true);
});

test('extract: 글자가 거의 없는 스캔본은 ok:false + OCR 미지원 안내', async () => {
  const r = await withLib(fakeLib({ numPages: 3, pages: [[], [], []] }), () => Pdf.extract(PDFISH()));
  assert.equal(r.ok, false); assert.equal(r.pageCount, 3);
  assert.match(r.notes.join(), /OCR/); assert.match(r.notes.join(), /스캔/);
});

test('extract: 정상 추출, 문서를 정리(destroy)하고, 원본 버퍼 대신 사본을 pdf.js 에 넘긴다', async () => {
  const lib = fakeLib({ numPages: 2 });
  const buf = PDFISH();
  const progress = [];
  const r = await withLib(lib, () => Pdf.extract(buf, { onProgress: (d, t) => progress.push([d, t]) }));
  assert.equal(r.ok, true); assert.equal(r.pageCount, 2);
  assert.ok(r.text.includes('첫째 쪽 안녕하세요 테스트 문서입니다 정상 추출 시험.') && r.text.includes('둘째 쪽'), r.text);
  assert.equal(lib.calls.destroyed, 1);
  const opts = lib.calls.getDocument[0];
  assert.equal(opts.isEvalSupported, false); assert.equal(opts.enableXfa, false);
  assert.notEqual(opts.data.buffer, buf); assert.equal(buf.byteLength > 0, true);
  assert.deepEqual(progress[progress.length - 1], [2, 2]);
});

test('extract: 일부 쪽만 못 읽으면 건너뛰고 안내하며 나머지는 돌려준다', async () => {
  const r = await withLib(fakeLib({ numPages: 3, failPages: [2] }), () => Pdf.extract(PDFISH()));
  assert.equal(r.ok, true);
  assert.match(r.notes.join(), /1쪽은 읽지 못해/);
});

test('configure: workerSrc 를 pdf.js 전역 설정에 반영한다', async () => {
  const lib = fakeLib();
  await withLib(lib, async () => { Pdf.configure({ workerSrc: 'blob:fake-worker' }); await Pdf.extract(PDFISH()); });
  assert.equal(lib.GlobalWorkerOptions.workerSrc, 'blob:fake-worker');
});

/* ───────────────────────── 끝에서 끝: Pdf → Parse → Analyze ───────────────────────── */

/** 문단들을 폭 limit 에 맞춰 줄바꿈한 쪽(들)을 만든다. syllable=true 면 단어 중간에서도 끊는다(Chrome 의 한국어 기본 동작). */
function layout(paragraphs, { limit, syllable, linesPerPage = 40 }) {
  const lines = [];
  let y = 60;
  for (const p of paragraphs) {
    let cur = '', w = 0;
    const flush = (last) => { if (cur.trim()) lines.push({ text: cur.trim(), w, y, full: !last }); y += 16; cur = ''; w = 0; };
    const tokens = syllable ? [...p] : p.split(/(?<= )/);
    for (const tk of tokens) {
      const tkw = tw(tk);
      if (w + tkw > limit && cur) flush(false);
      cur += tk; w += tkw;
    }
    flush(true);
    y += 12;
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    const chunk = lines.slice(i, i + linesPerPage);
    const y0 = chunk[0].y - 60;
    pages.push(page(...chunk.map((l) => [item(l.text, LEFT, l.y - y0, { w: l.full ? limit : tw(l.text) })])));
  }
  return pages;
}

test('줄바꿈 위치가 달라도(단어 중간 포함) 같은 대화에서 같은 분류가 나온다: Pdf → Parse → Analyze', () => {
  const ai = [
    '축제 부스를 준비할 때는 먼저 목적과 예산을 정하고 그다음에 역할을 나누는 순서로 진행하면 좋습니다.',
    '부스의 주제는 방문객이 짧은 시간에 이해할 수 있어야 하므로 한 문장으로 소개할 수 있는 체험 활동을 중심으로 구성해야 합니다.',
    '예산은 재료비와 대여료와 홍보물 제작비로 나누어 기록해 두고 행사 이 주 전에는 구매 목록을 확정해야 합니다.',
    '행사 당일의 동선을 미리 그려 보면 입구와 체험 공간과 정산 공간을 분리할 수 있어 혼잡을 줄일 수 있습니다.',
  ];
  const turn = ['나의 말:', '대학 동아리 축제 부스를 운영하려고 해. 준비 순서를 알려줘.', 'ChatGPT의 말:', ai.join('\n')];
  const own = ['저는 작년에 신입생 환영회를 준비하다가 일정이 밀려 크게 고생한 적이 있습니다.', '그래서 이번에는 회의록을 공유 문서에 남기는 규칙부터 만들었습니다.', '선배들의 조언을 들으니 현수막 주문이 가장 늦어지기 쉽다고 했습니다.'];
  // 본문: AI 문장 4개를 그대로 + 직접 쓴 문장 3개를 섞는다
  const submission = [ai[0], own[0], ai[1], own[1], ai[2], own[2], ai[3]].join(' ');
  const kindsOf = (limit, syllable) => {
    const paras = [turn[0], turn[1], turn[2], ...ai];
    const text = Pdf.buildText(layout(paras, { limit, syllable }));
    const conv = Pdf.toConversation(text, { fileName: 'x.pdf' });
    assert.equal(conv.parsed, 'ok');
    assert.equal(conv.turns.length, 1);
    const doc = Core.blankDoc();
    doc.submission.text = submission;
    doc.conversations = [conv];
    return Analyze.run(doc).sentences.map((s) => s.kind);
  };
  const a = kindsOf(480, true), b = kindsOf(360, true), c = kindsOf(420, false);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(a.filter((k) => k === 'verbatim').length, 4, a.join());
  assert.equal(a.filter((k) => k === 'original').length, 3, a.join());
});

// 실제 Claude Exporter(Chrome 확장) PDF 1건(2026-10-19, Chrome 154 인쇄, 13쪽)의 구조를 따른다. 내용은 지어낸 것이다.
// 맨 위에 제목과 "Created <ISO>" 줄, 대문자 "HUMAN"/"ASSISTANT" 표지가 한 줄씩, 첨부 목록은 "ATTACHMENTS", 도구 블록 자리에는 안내 문구가 들어간다.
const CLAUDE_EXPORT = [
  '도서관 이용 안내 작성', 'Created 2026-04-14T03:44:44.339827Z', '',
  'HUMAN', '', '도서관 대출 규정을 정리해줘. 파일을 첨부할게.', '', 'ATTACHMENTS', '', '대출규정.pdf', '',
  'ASSISTANT', '', '자료를 확인했어요!', '', '```', 'This block is not supported on your current device yet.', '```', '', '일반 도서는 14일 동안 대출할 수 있어요.', '',
  'HUMAN', '', '질문: 연장은 가능한가요?', '답변: 한 번 가능', '',
  'ASSISTANT', '', '네, 한 번 7일 연장할 수 있어요.',
].join('\n');

test('Claude Exporter PDF: HUMAN/ASSISTANT 표지로 턴을 나누고 서비스를 claude로 추정한다', () => {
  assert.strictEqual(Pdf.guessProvider(CLAUDE_EXPORT), 'claude');
  const c = Pdf.toConversation(CLAUDE_EXPORT, { fileName: 'x.pdf' });
  assert.strictEqual(c.parsed, 'ok'); assert.strictEqual(c.provider, 'claude');
  assert.strictEqual(c.turns.length, 2);
  assert.match(c.turns[0].prompt, /^도서관 대출 규정을 정리해줘/);
  assert.match(c.turns[0].response, /14일 동안 대출/);
  assert.match(c.turns[1].prompt, /연장은 가능한가요/);
});

test('Claude Exporter PDF: 확장 프로그램이 넣은 "not supported" 안내 문구는 응답에서 빠진다', () => {
  const c = Pdf.toConversation(CLAUDE_EXPORT, {});
  assert.ok(!c.turns.some((t) => /not supported on your current device/.test(t.response)));
  assert.ok(!/```/.test(c.turns[0].response));
});

test('guessProvider: HUMAN/ASSISTANT 만으로는 claude로 단정하지 않는다 (Created 줄이 있어야 함)', () => {
  assert.notStrictEqual(Pdf.guessProvider('HUMAN\n질문\nASSISTANT\n답'), 'claude');
});
