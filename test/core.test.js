'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core.js');

const entry = (o = {}) => ({
  id: 'a', date: '2026-10-01', tool: 'Claude', purpose: 'brainstorm', prompt: 'p', response: 'r',
  disposition: 'edited', verifications: ['fact'], myChange: '내용을 고침', ...o,
});

const sample = () => {
  const d = C.blankDoc();
  d.meta.student = '홍길동';
  d.submission.text = '과제 본문입니다.';
  d.conversations = [{ id: 'c1', provider: 'claude', source: '대화1.pdf', parsed: 'ok', turns: [{ id: 't1', prompt: '질문', response: '답변' }] }];
  d.reflection = '성찰';
  return d;
};

test('blankDoc은 v2 구조이며 원문(rawText)을 보관하지 않는다', () => {
  const d = C.blankDoc();
  assert.strictEqual(d.version, 2);
  assert.deepStrictEqual(d.conversations, []);
  assert.ok(!('rawText' in d));
});

test('정책 범위 안이면 경고 없음', () => {
  assert.deepStrictEqual(C.checkEntry(entry(), 2), []);
});

test('금지 정책에서는 모든 사용이 high 경고', () => {
  assert.ok(C.checkEntry(entry({ purpose: 'grammar' }), 0).some((f) => f.code === 'policy'));
});

test('반영했는데 검증 기록이 없으면 경고 (교정은 제외)', () => {
  const f1 = C.checkEntry(entry({ verifications: [] }), 3);
  assert.ok(f1.some((f) => f.code === 'unverified'));
  const f2 = C.checkEntry(entry({ purpose: 'grammar', verifications: [], myChange: 'x' }), 3);
  assert.ok(!f2.some((f) => f.code === 'unverified'));
});

test('폐기·참고만은 검증 누락 경고 대상이 아님', () => {
  assert.ok(!C.checkEntry(entry({ disposition: 'discarded', verifications: [] }), 3).some((f) => f.code === 'unverified'));
});

test('초안을 그대로 썼고 본인 기여가 비어 있으면 경고', () => {
  const f = C.checkEntry(entry({ purpose: 'draft', disposition: 'asis', myChange: '' }), 3);
  assert.ok(f.some((x) => x.code === 'asis-no-contribution'));
});

test('통계: 검증률·수정률', () => {
  const es = [
    entry({ id: '1' }),
    entry({ id: '2', disposition: 'asis', verifications: [] }),
    entry({ id: '3', disposition: 'discarded', verifications: [] }),
  ];
  const s = C.analyze(es, 2);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.reflectedCount, 2);
  assert.strictEqual(s.verifiedRate, 0.5);
  assert.strictEqual(s.editedRate, 0.5);
  assert.strictEqual(s.discardedCount, 1);
});

test('빈 목록 통계는 비율이 null', () => {
  const s = C.analyze([], 2);
  assert.strictEqual(s.verifiedRate, null);
});

test('해시 체인: 정상 → 통과, 내용 변조 → 변조 위치 탐지', async () => {
  const sealed = await C.sealChain([entry({ id: '1' }), entry({ id: '2' }), entry({ id: '3' })]);
  assert.deepStrictEqual((await C.verifyChain(sealed)).ok, true);
  const tampered = sealed.map((e) => ({ ...e }));
  tampered[1].prompt = '몰래 바꾼 프롬프트';
  const r = await C.verifyChain(tampered);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.brokenAt, 1);
});

test('해시 체인: 항목 삭제·순서 변경도 탐지', async () => {
  const sealed = await C.sealChain([entry({ id: '1' }), entry({ id: '2' }), entry({ id: '3' })]);
  assert.strictEqual((await C.verifyChain([sealed[0], sealed[2]])).ok, false);
  assert.strictEqual((await C.verifyChain([sealed[1], sealed[0], sealed[2]])).ok, false);
});

test('문서 해시는 표지·성찰 변경 시 달라짐', async () => {
  const meta = { student: 'a', studentId: '1', course: 'c', professor: 'p', assignment: 'x', policyLevel: 2 };
  const sealed = await C.sealChain([entry()]);
  const h1 = await C.documentHash(meta, sealed, '성찰');
  const h2 = await C.documentHash({ ...meta, policyLevel: 3 }, sealed, '성찰');
  const h3 = await C.documentHash(meta, sealed, '다른 성찰');
  assert.notStrictEqual(h1, h2);
  assert.notStrictEqual(h1, h3);
  assert.match(C.formatCode(h1), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
});
