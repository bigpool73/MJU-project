'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core.js');

// 엔진은 별도 모듈이므로 여기서는 계약만 만족하는 가짜 분석기를 쓴다.
const fakeAnalyze = (dep = 0.3, rel = 0.5) => ({
  run: (doc) => ({
    turns: doc.conversations.flatMap((c) => c.turns.map((t) => ({ id: t.id, relevance: rel }))),
    summary: { dependency: dep },
  }),
});

const sample = () => {
  const d = C.blankDoc();
  d.meta.student = '홍길동';
  d.submission.text = '과제 본문입니다.';
  d.conversations = [{ id: 'c1', provider: 'claude', url: 'https://claude.ai/share/x', parsed: 'ok', turns: [{ id: 't1', prompt: '질문', response: '답변' }] }];
  d.reflection = '성찰';
  return d;
};

test('blankDoc은 v2 구조이며 원문(rawText)을 보관하지 않는다', () => {
  const d = C.blankDoc();
  assert.strictEqual(d.version, 2);
  assert.deepStrictEqual(d.conversations, []);
  assert.ok(!('rawText' in d));
});

test('seal → verify 통과', async () => {
  const sealed = await C.seal(sample(), fakeAnalyze());
  assert.match(sealed.code, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  const v = await C.verifyDoc(sealed, fakeAnalyze());
  assert.strictEqual(v.ok, true);
});

test('본문을 바꾸면 확인 코드 불일치', async () => {
  const sealed = await C.seal(sample(), fakeAnalyze());
  const t = JSON.parse(JSON.stringify(sealed));
  t.submission.text += ' 몰래 추가';
  const v = await C.verifyDoc(t, fakeAnalyze());
  assert.strictEqual(v.codeOk, false);
  assert.strictEqual(v.ok, false);
});

test('대화 내용·삭제기록·성찰을 바꿔도 탐지', async () => {
  const sealed = await C.seal(sample(), fakeAnalyze());
  const mut = [
    (d) => { d.conversations[0].turns[0].response = '다른 답변'; },
    (d) => { d.deletions.push({ turnId: 'x', convId: 'c1', relevance: 0.05, chars: 10 }); },
    (d) => { d.reflection = '바꾼 성찰'; },
    (d) => { d.meta.student = '김철수'; },
  ];
  for (const m of mut) {
    const t = JSON.parse(JSON.stringify(sealed));
    m(t);
    assert.strictEqual((await C.verifyDoc(t, fakeAnalyze())).codeOk, false);
  }
});

test('점수(claimed)만 고치고 코드를 다시 계산해도 재계산 값과 달라 탐지', async () => {
  const sealed = await C.seal(sample(), fakeAnalyze(0.6));
  const forged = JSON.parse(JSON.stringify(sealed));
  forged.claimed.dependency = 0.05;
  forged.claimed.autonomy = 0.95;
  forged.code = await C.documentCode(forged);
  const v = await C.verifyDoc(forged, fakeAnalyze(0.6));
  assert.strictEqual(v.codeOk, true);
  assert.strictEqual(v.claimOk, false);
  assert.strictEqual(v.ok, false);
});

test('코드가 없거나 형식이 다른 파일은 정상 통과하지 않는다', async () => {
  assert.strictEqual((await C.verifyDoc({ version: 1 }, fakeAnalyze())).ok, false);
  const unsealed = sample();
  assert.strictEqual((await C.verifyDoc(unsealed, fakeAnalyze())).ok, false);
});
