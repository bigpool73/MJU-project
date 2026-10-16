'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('../src/analyze.js');
const C = require('../src/core.js');
const { build } = require('./fixtures/build.js');

const FIXTURE_IDS = ['carbon-tax', 'binary-search', 'subscription', 'school-start', 'sleep-memory', 'overfitting'];
const FIXTURES = FIXTURE_IDS.map((id) => build(require(`./fixtures/${id}.js`)));
const RUNS = new Map(FIXTURES.map((f) => [f.id, A.run(f.doc)])); // 같은 문서를 여러 시험이 함께 쓴다

const clone = (o) => JSON.parse(JSON.stringify(o));
const KINDS = ['verbatim', 'adapted', 'studentOrigin', 'original'];
const INTENTS = ['generate', 'revise', 'explain', 'ideas', 'outline', 'summarize', 'feedback', 'other'];
const BANNED = ['표절', '부정행위', '부정 행위', 'AI가 썼', 'AI가 쓴', 'AI가 작성', '대필', '컨닝', 'cheat', 'plagiar'];

const mkDoc = ({ title = '', brief = '', body = '', convs = [] } = {}) => ({
  version: 2,
  meta: { student: '', studentId: '', course: '', professor: '', assignment: title, assignmentBrief: brief },
  submission: { text: body },
  conversations: convs.map((c, ci) => ({
    id: c.id || `c${ci}`,
    provider: 'other',
    url: '',
    parsed: 'ok',
    turns: c.turns.map((t, ti) => ({ id: t.id || `c${ci}t${ti}`, prompt: t.prompt || '', response: t.response || '' })),
  })),
  deletions: [],
  reflection: '',
  claimed: null,
  code: null,
});

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

/** 어떤 입력에서도 지켜져야 하는 출력 불변 조건 */
function checkInvariants(doc, r) {
  const text = doc && doc.submission && typeof doc.submission.text === 'string' ? doc.submission.text : '';
  let prevEnd = 0;
  for (const s of r.sentences) {
    assert.strictEqual(text.slice(s.start, s.end), s.text, '오프셋이 본문과 어긋남');
    assert.ok(s.start >= prevEnd && s.end > s.start, '문장이 겹치거나 비어 있음');
    prevEnd = s.end;
    assert.ok(KINDS.includes(s.kind));
    assert.ok(s.score >= 0 && s.score <= 1);
    if (s.kind === 'original') assert.strictEqual(s.source, null);
    else {
      assert.ok(s.source && typeof s.source.turnId === 'string');
      assert.ok(s.source.snippet.length <= 80);
    }
  }
  assert.strictEqual(r.sentences.map((s) => s.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''), '비공백 글자가 빠짐');
  const sh = r.summary.shares;
  assert.strictEqual(sh.verbatim + sh.adapted + sh.studentOrigin + sh.original, 1, 'shares 합이 1이 아님');
  assert.strictEqual(r.summary.dependency, sh.verbatim + 0.5 * sh.adapted);
  assert.strictEqual(r.summary.autonomy, 1 - r.summary.dependency);
  const c = r.summary.sentenceCounts;
  assert.strictEqual(c.verbatim + c.adapted + c.studentOrigin + c.original, r.sentences.length);
  assert.ok(['low', 'mid', 'high'].includes(r.summary.band));
  assert.strictEqual(r.summary.turnCount, r.turns.length);
  assert.deepStrictEqual(Object.keys(r.summary.intents).sort(), INTENTS.slice().sort());
  assert.strictEqual(Object.values(r.summary.intents).reduce((a, b) => a + b, 0), r.turns.length);
  for (let i = 0; i < r.turns.length; i++) {
    const t = r.turns[i];
    assert.ok(t.relevance >= 0 && t.relevance <= 1);
    assert.strictEqual(t.deletable, t.relevance < A.DELETE_THRESHOLD);
    assert.strictEqual(t.relevanceLabel, t.relevance >= 0.3 ? 'high' : t.relevance >= 0.15 ? 'mid' : 'low');
    assert.ok(INTENTS.includes(t.intent));
    assert.ok(t.promptHead.length <= 80 && t.responseHead.length <= 80);
    assert.strictEqual(typeof t.summaryLine, 'string');
    if (i > 0) assert.ok(r.turns[i - 1].relevance >= t.relevance, '연관도 내림차순이 아님');
  }
  assert.ok(Array.isArray(r.narrative) && r.narrative.length >= 1 && r.narrative.every((x) => typeof x === 'string' && x.length > 0));
  for (const line of r.narrative.concat(r.turns.map((t) => t.summaryLine))) {
    for (const w of BANNED) assert.ok(!line.includes(w), `단정 표현 "${w}" 사용: ${line}`);
  }
}

/** 정답 구간(part)별로 엔진이 낸 문장 목록 */
function verdicts(f, r) {
  return f.truth.map((tr) => ({
    tr,
    inside: r.sentences.filter((s) => s.start >= tr.start && s.end <= tr.end),
    straddle: r.sentences.filter((s) => s.start < tr.end && s.end > tr.start && !(s.start >= tr.start && s.end <= tr.end)),
  }));
}

// ---------------------------------------------------------------- 계약
test('상수·거부 메시지·의도 라벨이 명세와 같다', () => {
  assert.strictEqual(A.DELETE_THRESHOLD, 0.15);
  assert.strictEqual(A.REFUSAL_MESSAGE, '해당 대화는 과제와 연관도가 높아, 삭제가 불가합니다.');
  for (const k of INTENTS) {
    const label = A.intentLabel(k);
    assert.ok(/[가-힣]/.test(label), `${k} 라벨이 한국어가 아님`);
  }
  assert.strictEqual(new Set(INTENTS.map(A.intentLabel)).size, INTENTS.length, '라벨이 겹침');
  assert.strictEqual(A.intentLabel('outline'), '개요 구성');
  assert.strictEqual(A.intentLabel('없는 의도'), A.intentLabel('other'));
});

test('브라우저처럼 module 없이 불러오면 self.Analyze로 노출된다 (UMD)', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'analyze.js'), 'utf8');
  const fakeSelf = {};
  vm.runInNewContext(code, { self: fakeSelf, globalThis: fakeSelf });
  assert.strictEqual(typeof fakeSelf.Analyze.run, 'function');
  assert.strictEqual(fakeSelf.Analyze.DELETE_THRESHOLD, 0.15);
});

test('Core.seal / verifyDoc와 호환되고, 삭제 후 다시 봉인해도 검증을 통과한다', async () => {
  const f = FIXTURES[0];
  const sealed = await C.seal(f.doc, A);
  assert.strictEqual((await C.verifyDoc(sealed, A)).ok, true);
  const chat = RUNS.get(f.id).turns.find((t) => f.labels[t.id] === 'chat');
  const del = A.deleteTurn(f.doc, chat.id);
  assert.strictEqual(del.ok, true);
  const resealed = await C.seal(del.doc, A);
  assert.strictEqual((await C.verifyDoc(resealed, A)).ok, true);
  const forged = clone(resealed);
  forged.deletions[0].relevance = 0.9;
  assert.strictEqual((await C.verifyDoc(forged, A)).codeOk, false);
});

// ---------------------------------------------------------------- 픽스처
test('픽스처의 정답은 코드로 검증된다: 옮긴 문장은 응답에 있고 직접 쓴 문장은 어디에도 없다', () => {
  for (const f of FIXTURES) assert.deepStrictEqual(f.problems, [], `${f.id}: ${f.problems.join(' / ')}`);
});

test('픽스처는 서로 다른 주제 4벌이며 모든 유형을 갖춘다', () => {
  assert.ok(FIXTURES.length >= 3);
  const need = ['copy', 'light', 'rewrite', 'own', 'draft', 'polish'];
  for (const f of FIXTURES) {
    const hows = new Set(f.truth.map((t) => t.how));
    for (const h of need) assert.ok(hows.has(h), `${f.id}에 ${h} 문장이 없음`);
    const labels = new Set(Object.values(f.labels));
    for (const l of ['related', 'chat', 'ambiguous']) assert.ok(labels.has(l), `${f.id}에 ${l} 턴이 없음`);
  }
  assert.ok(FIXTURES.some((f) => /^[\x00-\x7f]+$/.test(f.doc.submission.text)), '영어 픽스처가 없음');
  assert.ok(FIXTURES.some((f) => f.doc.submission.text.includes('```')), '코드가 든 픽스처가 없음');
  assert.strictEqual(new Set(FIXTURES.map((f) => f.doc.meta.assignment)).size, FIXTURES.length);
});

// ---------------------------------------------------------------- 불변 조건
test('모든 픽스처에서 출력 불변 조건이 지켜진다 (오프셋·shares 합 1·내림차순·단정 표현 없음)', () => {
  for (const f of FIXTURES) checkInvariants(f.doc, RUNS.get(f.id));
});

test('문장 경계가 정답 구간과 어긋나지 않는다 (문장이 두 구간에 걸치지 않음)', () => {
  for (const f of FIXTURES) {
    for (const v of verdicts(f, RUNS.get(f.id))) {
      assert.deepStrictEqual(v.straddle, [], `${f.id}: 구간을 넘는 문장 ${v.tr.text.slice(0, 20)}`);
      assert.ok(v.inside.length >= 1);
    }
  }
});

test('같은 입력은 항상 같은 결과이고 입력을 바꾸지 않는다', () => {
  for (const f of FIXTURES) {
    const frozen = deepFreeze(clone(f.doc));
    const a = A.run(frozen);
    const b = A.run(clone(f.doc));
    assert.deepStrictEqual(a, b);
    assert.strictEqual(JSON.stringify(a), JSON.stringify(RUNS.get(f.id)));
    assert.deepStrictEqual(frozen, f.doc);
  }
});

test('연관도는 그 턴과 과제만으로 정해진다: 다른 턴을 지우거나 순서를 바꿔도 같다', () => {
  for (const f of FIXTURES) {
    const base = new Map(RUNS.get(f.id).turns.map((t) => [t.id, t.relevance]));
    const all = f.doc.conversations.flatMap((c) => c.turns.map((t) => t.id));
    for (const id of all) {
      const alone = clone(f.doc);
      alone.conversations = alone.conversations.map((c) => ({ ...c, turns: c.turns.filter((t) => t.id === id) })).filter((c) => c.turns.length);
      const r = A.run(alone);
      assert.strictEqual(r.turns.length, 1);
      assert.strictEqual(r.turns[0].relevance, base.get(id), `${f.id}/${id}: 혼자 두면 값이 달라짐`);
      assert.strictEqual(A.canDelete(f.doc, id).relevance, base.get(id), `${f.id}/${id}: canDelete와 run이 다름`);
    }
    const reversed = clone(f.doc);
    reversed.conversations.reverse().forEach((c) => c.turns.reverse());
    for (const t of A.run(reversed).turns) assert.strictEqual(t.relevance, base.get(t.id));
    const dropped = clone(f.doc);
    dropped.conversations[0].turns = dropped.conversations[0].turns.slice(0, 1);
    for (const t of A.run(dropped).turns) assert.strictEqual(t.relevance, base.get(t.id));
  }
});

test('연관도 내림차순이고, 동점은 대화 순서 → 턴 순서로 정렬된다', () => {
  const same = { prompt: '탄소세 도입에 찬성하는 근거를 알려줘', response: '탄소세는 온실가스를 배출하는 행위에 비용을 부과하여 기업이 배출을 줄이도록 유도하는 정책입니다. 걷은 세수를 저소득 가구에 환급하면 부담을 줄일 수 있습니다.' };
  const chat = { prompt: '저녁 메뉴 추천해줘', response: '김치찌개나 파스타를 추천합니다. 날씨가 쌀쌀하면 따뜻한 국물이 좋습니다.' };
  const doc = mkDoc({
    title: '탄소세 도입에 찬성하는 논증문',
    body: '탄소세는 온실가스를 배출하는 행위에 비용을 부과하는 정책이다. 걷은 세수를 환급하면 저소득 가구의 부담을 줄일 수 있다. 기업은 배출을 줄일 유인을 갖게 된다.',
    convs: [
      { id: 'a', turns: [{ id: 'a0', ...chat }, { id: 'a1', ...same }, { id: 'a2', ...same }] },
      { id: 'b', turns: [{ id: 'b0', ...same }, { id: 'b1', ...chat }] },
    ],
  });
  const r = A.run(doc);
  assert.deepStrictEqual(r.turns.map((t) => t.id), ['a1', 'a2', 'b0', 'a0', 'b1']);
  assert.strictEqual(r.turns[0].relevance, r.turns[1].relevance);
  assert.strictEqual(r.turns[1].relevance, r.turns[2].relevance);
  assert.strictEqual(r.turns[3].relevance, r.turns[4].relevance);
  assert.ok(r.turns[2].relevance > r.turns[3].relevance);
  checkInvariants(doc, r);
});

test('canDelete: 연관도가 0.15 미만이면 허용, 그 외에는 정확한 거부 메시지', () => {
  for (const f of FIXTURES) {
    for (const t of RUNS.get(f.id).turns) {
      const c = A.canDelete(f.doc, t.id);
      assert.strictEqual(c.ok, t.relevance < 0.15, `${f.id}/${t.id}`);
      assert.strictEqual(c.relevance, t.relevance);
      if (!c.ok) assert.strictEqual(c.message, '해당 대화는 과제와 연관도가 높아, 삭제가 불가합니다.');
      else assert.notStrictEqual(c.message, A.REFUSAL_MESSAGE);
    }
  }
  const unknown = A.canDelete(FIXTURES[0].doc, '없는-id');
  assert.strictEqual(unknown.ok, false);
  assert.notStrictEqual(unknown.message, A.REFUSAL_MESSAGE);
});

test('삭제 판정은 소수 4자리로 반올림된 연관도로 하므로 화면에 보이는 값과 어긋나지 않는다', () => {
  for (const f of FIXTURES) {
    for (const t of RUNS.get(f.id).turns) assert.strictEqual(t.deletable, Number(t.relevance.toFixed(4)) < 0.15);
  }
});

test('deleteTurn은 원본을 바꾸지 않고, 삭제된 내용은 어디에도 남기지 않는다', () => {
  for (const f of FIXTURES) {
    const chat = RUNS.get(f.id).turns.find((t) => f.labels[t.id] === 'chat' && t.deletable);
    const src = f.doc.conversations.flatMap((c) => c.turns).find((t) => t.id === chat.id);
    const snapshot = JSON.stringify(f.doc);
    const frozen = deepFreeze(clone(f.doc));
    const r = A.deleteTurn(frozen, chat.id);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(JSON.stringify(f.doc), snapshot);
    assert.notStrictEqual(r.doc, frozen);
    assert.strictEqual(r.doc.deletions.length, 1);
    assert.deepStrictEqual(Object.keys(r.doc.deletions[0]).sort(), ['chars', 'convId', 'relevance', 'turnId']);
    assert.deepStrictEqual(r.doc.deletions[0], { turnId: chat.id, convId: chat.convId, relevance: chat.relevance, chars: src.prompt.length + src.response.length });
    const left = r.doc.conversations.flatMap((c) => c.turns.map((t) => t.id));
    assert.ok(!left.includes(chat.id));
    assert.strictEqual(left.length, f.doc.conversations.flatMap((c) => c.turns).length - 1);
    const dump = JSON.stringify(r.doc);
    assert.ok(!dump.includes(src.prompt.slice(0, 15)) && !dump.includes(src.response.slice(0, 15)), '삭제한 내용이 문서에 남음');
    assert.strictEqual(A.deleteTurn(r.doc, chat.id).ok, false, '같은 턴을 두 번 지울 수는 없다');
  }
});

test('연관도가 높은 턴은 deleteTurn이 거부하고 문서를 그대로 돌려준다', () => {
  for (const f of FIXTURES) {
    const rel = RUNS.get(f.id).turns[0];
    const before = JSON.stringify(f.doc);
    const r = A.deleteTurn(f.doc, rel.id);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.message, A.REFUSAL_MESSAGE);
    assert.strictEqual(JSON.stringify(r.doc), before);
    assert.strictEqual(JSON.stringify(f.doc), before);
  }
});

test('무관한 턴을 모두 지워도 남은 턴의 연관도·의존도는 바뀌지 않고, 점수·확인 코드는 비워진다', () => {
  for (const f of FIXTURES) {
    const r0 = RUNS.get(f.id);
    let doc = { ...clone(f.doc), claimed: { dependency: 0, autonomy: 1, relevance: {} }, code: 'AAAA-BBBB-CCCC-DDDD' };
    const deletable = r0.turns.filter((t) => t.deletable).map((t) => t.id);
    assert.ok(deletable.length >= 3, `${f.id}: 지울 수 있는 턴이 너무 적음`);
    for (const id of deletable) {
      const d = A.deleteTurn(doc, id);
      assert.strictEqual(d.ok, true, `${f.id}/${id}`);
      doc = d.doc;
    }
    assert.strictEqual(doc.claimed, null);
    assert.strictEqual(doc.code, null);
    assert.strictEqual(doc.deletions.length, deletable.length);
    const r1 = A.run(doc);
    assert.strictEqual(r1.summary.deletableTurnCount, 0);
    assert.strictEqual(r1.turns.length, r0.turns.length - deletable.length);
    const before = new Map(r0.turns.map((t) => [t.id, t.relevance]));
    for (const t of r1.turns) assert.strictEqual(t.relevance, before.get(t.id));
    assert.strictEqual(r1.summary.dependency, r0.summary.dependency, '잡담을 지웠는데 의존도가 달라짐');
    checkInvariants(doc, r1);
  }
});

// ---------------------------------------------------------------- 보정
test('보정: 직접 관련된 턴은 0.30 이상, 무관한 잡담은 0.15 미만, 애매한 턴은 그 사이에 가깝다', (t) => {
  const rel = [];
  const chat = [];
  const amb = [];
  for (const f of FIXTURES) {
    for (const x of RUNS.get(f.id).turns) {
      const bucket = { related: rel, chat, ambiguous: amb }[f.labels[x.id]];
      if (bucket) bucket.push({ id: `${f.id}/${x.id}`, v: x.relevance });
    }
  }
  const min = (a) => a.reduce((m, x) => (x.v < m.v ? x : m));
  const max = (a) => a.reduce((m, x) => (x.v > m.v ? x : m));
  const median = (a) => a.map((x) => x.v).sort((p, q) => p - q)[Math.floor(a.length / 2)];
  t.diagnostic(`관련 ${rel.length}턴 최솟값 ${min(rel).v} (${min(rel).id}) / 잡담 ${chat.length}턴 최댓값 ${max(chat).v} (${max(chat).id}) / 애매 ${amb.length}턴 ${amb.map((x) => x.v).sort((p, q) => p - q).join(' ')}`);
  assert.ok(min(rel).v >= 0.3, `관련 턴 최솟값 ${min(rel).v} (${min(rel).id})`);
  assert.ok(max(chat).v < 0.15, `잡담 최댓값 ${max(chat).v} (${max(chat).id})`);
  assert.ok(median(amb) < min(rel).v, '애매한 턴의 중앙값이 관련 턴 최솟값보다 높음');
  assert.ok(amb.some((x) => x.v >= 0.15) && amb.some((x) => x.v < 0.15), '애매한 턴이 한쪽으로만 쏠림');
  for (const f of FIXTURES) {
    const r = RUNS.get(f.id);
    const best = r.turns[0];
    assert.strictEqual(f.labels[best.id], 'related', `${f.id}: 맨 위 턴이 관련 턴이 아님`);
    const order = r.turns.map((x) => f.labels[x.id]);
    assert.ok(order.lastIndexOf('related') < order.indexOf('chat'), `${f.id}: 잡담이 관련 턴보다 위에 있음`);
  }
});

test('알려진 약점: 표만 있는 응답은 0.30에 못 미치지만(mid) 삭제 기준 0.15는 넘어 삭제할 수 없다', (t) => {
  const f = FIXTURES.find((x) => x.id === 'sleep-memory');
  const turn = RUNS.get(f.id).turns.find((x) => f.labels[x.id] === 'weak');
  t.diagnostic(`표 위주 응답 연관도 ${turn.relevance}`);
  assert.ok(turn.relevance >= 0.15 && turn.relevance < 0.3, String(turn.relevance));
  assert.strictEqual(turn.deletable, false);
});

test('보정: 본문 문장의 종류가 구성 방식(그대로·고쳐 씀·직접·초안·교정본)과 일치한다', (t) => {
  const miss = [];
  const stat = { own: [], paraphrase: [], rewrite: [], light: [], copy: [], draft: [], polish: [] };
  let total = 0;
  for (const f of FIXTURES) {
    for (const v of verdicts(f, RUNS.get(f.id))) {
      for (const s of v.inside) {
        total++;
        stat[v.tr.how].push(s.score);
        if (s.kind !== v.tr.expect) miss.push(`${f.id} [${v.tr.how}→${s.kind} ${s.score}] ${s.text.slice(0, 24)}`);
      }
    }
  }
  const rng = (a) => (a.length ? `${Math.min(...a).toFixed(2)}~${Math.max(...a).toFixed(2)}(${a.length})` : '-');
  t.diagnostic(`문장 ${total}개. 점수 범위 — 직접 ${rng(stat.own)} / 완전 재서술 ${rng(stat.paraphrase)} / 고쳐 씀 ${rng(stat.rewrite)} / 가볍게 고침 ${rng(stat.light)} / 그대로 ${rng(stat.copy)}`);
  assert.deepStrictEqual(miss, []);
  assert.ok(Math.max(...stat.own) < A.ADAPTED_T, '직접 쓴 문장이 고쳐 쓴 임계값을 넘음');
  assert.ok(Math.min(...stat.rewrite) >= A.ADAPTED_T, '고쳐 쓴 문장이 임계값 아래');
  assert.ok(Math.max(...stat.rewrite) < A.VERBATIM_T && Math.min(...stat.light) >= A.VERBATIM_T, 'verbatim 경계가 흔들림');
});

test('보정: 출처로 지목된 턴이 실제로 옮겨 온 턴이고, 턴별 reflected 집계와 맞는다', () => {
  for (const f of FIXTURES) {
    const r = RUNS.get(f.id);
    for (const v of verdicts(f, r)) {
      if (!v.tr.from || v.tr.expect === 'original') continue;
      for (const s of v.inside) {
        assert.ok(s.source, `${f.id}: 출처 없음 ${s.text.slice(0, 20)}`);
        assert.strictEqual(s.source.turnId, v.tr.from, `${f.id}: ${v.tr.how} 문장의 출처가 ${s.source.turnId} (정답 ${v.tr.from})`);
        const turn = r.turns.find((x) => x.id === s.source.turnId);
        assert.strictEqual(s.source.convIndex, turn.convIndex);
        assert.strictEqual(s.source.turnIndex, turn.index);
      }
    }
    for (const turn of r.turns) {
      for (const k of ['verbatim', 'adapted', 'studentOrigin']) {
        assert.strictEqual(turn.reflected[k], r.sentences.filter((s) => s.kind === k && s.source.turnId === turn.id).length);
      }
      assert.strictEqual(turn.summaryLine.includes('과제 반영: 없음'), turn.reflected.verbatim + turn.reflected.adapted === 0);
    }
  }
});

test('보정: 학생 초안을 교정받은 경우 — 초안 그대로는 주체적 작성, AI가 고친 문장만 의존으로 센다', () => {
  for (const f of FIXTURES) {
    const r = RUNS.get(f.id);
    const draft = verdicts(f, r).filter((v) => v.tr.how === 'draft').flatMap((v) => v.inside);
    const polish = verdicts(f, r).filter((v) => v.tr.how === 'polish').flatMap((v) => v.inside);
    assert.ok(draft.length >= 1 && polish.length >= 1);
    assert.ok(draft.every((s) => s.kind === 'studentOrigin'));
    assert.ok(polish.every((s) => s.kind === 'verbatim'));
    // 같은 턴에서 초안(학생 원문)과 교정본(AI 응답)이 모두 나왔지만 의존도는 글자 수 기준으로 그대로·고쳐 쓴 문장만 센다
    const len = (k) => r.sentences.filter((s) => s.kind === k).reduce((n, s) => n + s.text.replace(/\s/g, '').length, 0);
    const total = KINDS.reduce((n, k) => n + len(k), 0);
    assert.ok(Math.abs(r.summary.dependency - (len('verbatim') + 0.5 * len('adapted')) / total) < 1e-3);
    assert.ok(r.summary.shares.studentOrigin > 0);
  }
});

test('보정: 이 엔진이 못 잡는다고 밝힌 것 — 자기 말로 완전히 다시 쓴 문장은 원문(original)으로 센다', () => {
  let n = 0;
  for (const f of FIXTURES) {
    for (const v of verdicts(f, RUNS.get(f.id))) {
      if (v.tr.how !== 'paraphrase') continue;
      n++;
      assert.ok(v.inside.every((s) => s.kind === 'original'));
    }
  }
  assert.ok(n >= 2);
});

// ---------------------------------------------------------------- 문장 나누기
const spans = (text) => A.splitSentences(text).map(({ start, end }) => text.slice(start, end));

test('문장 나누기: 마침표·물음표·느낌표·줄바꿈에서 끊고, 소수점·약어·번호는 끊지 않는다', () => {
  assert.deepStrictEqual(spans('탄소세는 필요한 정책이다. 그런데 정말 그럴까? 그렇다고 나는 믿는다!'), ['탄소세는 필요한 정책이다.', '그런데 정말 그럴까?', '그렇다고 나는 믿는다!']);
  assert.deepStrictEqual(spans('첫 번째 줄은 이렇게 쓴다\n두 번째 줄은 이렇게 쓴다\r\n세 번째 줄은 이렇게 쓴다'), ['첫 번째 줄은 이렇게 쓴다', '두 번째 줄은 이렇게 쓴다', '세 번째 줄은 이렇게 쓴다']);
  assert.strictEqual(spans('The price rose 3.5 percent last year. It fell again later.').length, 2);
  assert.strictEqual(spans('We use taxes, e.g. carbon taxes in Sweden, as a tool.').length, 1);
  assert.strictEqual(spans('1. 서론 부분은 이렇게 쓴다\n2. 본론 부분은 이렇게 쓴다').length, 2);
  assert.deepStrictEqual(spans('"탄소세는 반드시 필요하다." 라고 그는 길게 말했다. 다음 문장도 길게 쓴다.'), ['"탄소세는 반드시 필요하다."', '라고 그는 길게 말했다.', '다음 문장도 길게 쓴다.']); // 닫는 따옴표는 앞 문장에 붙는다
});

test('문장 나누기: 마침표 없는 한국어 종결 뒤 공백에서 끊되 "때마다"·"다 같이"에서는 끊지 않는다', () => {
  assert.deepStrictEqual(spans('사람들은 때마다 다른 선택을 하게 된다 그리고 결과는 달라진다.'), ['사람들은 때마다 다른 선택을 하게 된다', '그리고 결과는 달라진다.']);
  assert.strictEqual(spans('다 같이 가자는 말에 모두가 동의했다.').length, 1);
  assert.strictEqual(spans('공부를 하다 보면 요령이 생기고 실력이 늘어난다.').length, 1);
});

test('문장 나누기: 너무 짧은 조각은 앞 문장에 붙이고, 맨 앞이면 뒷 문장에 붙인다', () => {
  assert.deepStrictEqual(spans('탄소세는 효과적인 정책이다. 네. 그리고 다음 문장이 길게 이어진다.'), ['탄소세는 효과적인 정책이다. 네.', '그리고 다음 문장이 길게 이어진다.']);
  assert.deepStrictEqual(spans('서론\n탄소세는 효과적인 정책이다.'), ['서론\n탄소세는 효과적인 정책이다.']);
  assert.deepStrictEqual(spans('네.'), ['네.']);
  assert.deepStrictEqual(spans(''), []);
  assert.deepStrictEqual(spans(' \n\t '), []);
});

test('문장 나누기: 이모지·아주 긴 한 줄·공백뿐인 구간에서도 오프셋이 맞고 조각이 400자를 넘지 않는다', () => {
  const emoji = '😀 오늘은 정말 즐거운 하루였다. 🎉🎉 내일도 그랬으면 좋겠다 😀';
  const e = A.splitSentences(emoji);
  assert.ok(e.length >= 1);
  assert.strictEqual(e.map(({ start, end }) => emoji.slice(start, end)).join('').replace(/\s/g, ''), emoji.replace(/\s/g, ''));
  const long = '가나다라마바사 '.repeat(500);
  const parts = A.splitSentences(long);
  assert.ok(parts.length >= 8);
  assert.ok(parts.every(({ start, end }) => end - start <= 401));
  const noSpace = '가'.repeat(1500);
  assert.ok(A.splitSentences(noSpace).every(({ start, end }) => end - start <= 401));
});

// ---------------------------------------------------------------- 정규화·토큰
test('정규화·토큰: 마크다운 표지를 지워도 같은 토큰이 나오고, 자모 분리형(NFD)도 같다', () => {
  const plainText = '탄소세는 온실가스를 줄이는 정책이다 그리고 세수를 환급한다';
  const md = '## 탄소세는 **온실가스**를 줄이는 `정책`이다\n- 그리고 세수를 환급한다\n```text\n```';
  assert.deepStrictEqual(A.tokenize(A.normalize(md), true), A.tokenize(A.normalize(plainText), true));
  assert.strictEqual(A.normalize('탄소세는 환경 정책이다'.normalize('NFD')), A.normalize('탄소세는 환경 정책이다'));
  assert.deepStrictEqual(A.tokenize(A.normalize('1. 첫째 항목\n2) 둘째 항목'), false), A.tokenize(A.normalize('항목 항목'), false));
});

test('자모가 분리된(NFD) 한글로 입력해도 같은 판정이 나온다', () => {
  for (const f of FIXTURES.filter((x) => /[가-힣]/.test(x.doc.submission.text))) {
    const nfd = JSON.parse(JSON.stringify(f.doc).normalize('NFD'));
    const a = RUNS.get(f.id);
    const b = A.run(nfd);
    assert.deepStrictEqual(b.sentences.map((s) => s.kind), a.sentences.map((s) => s.kind), f.id);
    assert.deepStrictEqual(b.turns.map((t) => [t.id, t.relevance]), a.turns.map((t) => [t.id, t.relevance]), f.id);
    assert.strictEqual(b.summary.dependency, a.summary.dependency);
    checkInvariants(nfd, b);
  }
});

test('정규화·토큰: 한국어 조사·어미 2-gram은 정지 목록으로 빠지고, 영문은 어간으로 모은다', () => {
  assert.deepStrictEqual(A.tokenize(A.normalize('합니다 입니다 있는 에서 하였다 했습니다'), false), []);
  const t = A.tokenize(A.normalize('탄소세를 도입한다'), false);
  assert.ok(t.includes('탄소') && t.includes('소세') && t.includes('도입'));
  assert.ok(!t.some((g) => g.endsWith('를')), '조사가 붙은 조각이 남음');
  assert.deepStrictEqual(A.tokenize(A.normalize('Carbon taxes cause emissions drops'), false), A.tokenize(A.normalize('carbon tax caused emission dropping'), false));
  assert.deepStrictEqual(A.tokenize(A.normalize('calculateTotalPrice and HTTPServer'), false), A.tokenize(A.normalize('calculate total price http server'), false));
  assert.ok(A.tokenize(A.normalize('The carbon tax works'), true).includes('carbon tax'), '영문 인접 단어쌍');
});

test('상투구만 겹치는 문장과 짧은 문장은 우연히 일치해도 AI 반영으로 세지 않는다', () => {
  const ai = '결론적으로 이러한 점을 종합해 볼 때 따라서 이와 같은 정책의 도입은 필요하다고 할 수 있습니다. In conclusion, therefore, as a result of these points, it can be said that the policy is needed.';
  const bodies = [
    '결론적으로 이러한 점을 종합해 볼 때 따라서 우리는 내일 소풍을 간다고 할 수 있다.',
    'In conclusion, therefore, as a result of these points, it can be said that the moon is bright.',
    '따라서 필요하다.',
    '네, 그렇습니다. 맞습니다.',
  ];
  for (const body of bodies) {
    const r = A.run(mkDoc({ title: '소풍 계획', body, convs: [{ turns: [{ prompt: '정리해줘', response: ai }] }] }));
    assert.ok(r.sentences.every((s) => s.kind === 'original'), `상투구가 반영으로 셈: ${body}`);
    assert.strictEqual(r.summary.dependency, 0);
  }
});

test('코드: 코드펜스가 없어도 들여쓴 코드 덩어리를 통째로 옮기면 잡고, 한 줄짜리 코드는 판단하지 않는다', () => {
  const code = 'def binary_search(arr, target):\n    low, high = 0, len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1';
  const doc = mkDoc({
    title: '이진 탐색 구현',
    body: `아래는 구현이다 그대로 적는다.\n\n${code}\n\n이상이다 끝.`,
    convs: [{ turns: [{ prompt: '이진 탐색 함수를 작성해줘', response: `반복문 버전입니다.\n\n${code}\n\n중간 위치를 계산해 범위를 줄입니다.` }] }],
  });
  const r = A.run(doc);
  const hit = r.sentences.find((s) => s.text.includes('binary_search'));
  assert.ok(hit.text.includes('return -1'), '코드 줄이 한 덩어리로 묶이지 않음');
  assert.strictEqual(hit.kind, 'verbatim');
  const one = A.run(mkDoc({ title: '이진 탐색', body: 'return mid;\n\n설명을 적는다 충분히 길게 쓴다.', convs: [{ turns: [{ prompt: 'x', response: 'if arr[mid] == target:\n    return mid' }] }] }));
  assert.ok(one.sentences.every((s) => s.kind === 'original'));
  checkInvariants(doc, r);
});

test('두 문장을 합쳐 쓴 문장도, 한 문장을 둘로 나눠 쓴 문장도 AI 응답과의 겹침으로 잡는다', () => {
  const s1 = '탄소세는 온실가스를 배출하는 행위에 직접 비용을 부과하여 기업과 가계가 스스로 배출을 줄이도록 유도하는 시장 친화적 정책입니다.';
  const s2 = '규제와 달리 감축 방법을 정부가 정하지 않고 각 주체가 가장 저렴한 방법을 찾도록 하므로 사회 전체의 감축 비용이 낮아집니다.';
  const turns = [{ id: 't', prompt: '탄소세를 설명해줘', response: `${s1} ${s2}` }];
  const merged = A.run(mkDoc({ title: '탄소세', body: `${s1.replace('입니다.', '이며')} ${s2.replace('낮아집니다.', '낮아진다.')}`, convs: [{ turns }] }));
  assert.strictEqual(merged.sentences.length, 1);
  assert.strictEqual(merged.sentences[0].kind, 'verbatim');
  const split = A.run(mkDoc({ title: '탄소세', body: '규제와 달리 감축 방법을 정부가 정하지 않는다. 각 주체가 가장 저렴한 방법을 찾도록 하므로 사회 전체의 감축 비용이 낮아진다.', convs: [{ turns }] }));
  assert.ok(split.sentences.length === 2 && split.sentences.every((s) => s.kind !== 'original' && s.source.turnId === 't'));
});

// ---------------------------------------------------------------- 연관도 세부
test('짧고 모호한 후속 질문은 응답이 과제와 맞으면 관련으로 보고, 맞지 않으면 무관으로 본다', () => {
  const f = FIXTURES[0];
  const on = f.doc.conversations[0].turns.find((t) => t.prompt === '더 자세히 알려줘');
  const off = '순두부찌개는 두부와 해물을 넣고 얼큰하게 끓이는 한국의 대표적인 찌개입니다. 김치찌개와 달리 국물이 맑고 부드러우며 밥과 함께 먹기 좋습니다. 계란을 하나 깨 넣으면 더욱 고소해집니다.';
  const mk = (response) => ({ ...clone(f.doc), conversations: [{ id: 'x', provider: 'other', url: '', parsed: 'ok', turns: [{ id: 'q', prompt: '더 자세히 알려줘', response }] }] });
  const rOn = A.run(mk(on.response)).turns[0].relevance;
  const rOff = A.run(mk(off)).turns[0].relevance;
  assert.ok(rOn >= 0.3, `후속 질문 + 관련 응답 = ${rOn}`);
  assert.ok(rOff < 0.15, `후속 질문 + 무관 응답 = ${rOff}`);
  // 같은 후속 질문이어도 앞 턴과 상관없이 응답만으로 정해진다
  assert.strictEqual(A.canDelete(f.doc, on && f.doc.conversations[0].turns.find((t) => t === on || t.id === on.id).id).relevance, RUNS.get(f.id).turns.find((t) => t.id === on.id).relevance);
});

test('긴 AI 응답 속의 일반 어휘가 점수를 희석하지 않는다: 같은 핵심 문장 + 곁다리 문장을 늘려도 관련 턴으로 남는다', () => {
  const f = FIXTURES[0];
  const core = f.doc.conversations[0].turns[0].response;
  const filler = Array.from({ length: 40 }, (_, i) => `예를 들어 ${i + 1}번째 상황에서는 여러 사람이 서로 다른 의견을 나누며 다양한 방법으로 시간을 보내고 함께 이야기를 이어 갑니다.`).join(' ');
  const mk = (response) => ({ ...clone(f.doc), conversations: [{ id: 'x', provider: 'other', url: '', parsed: 'ok', turns: [{ id: 'q', prompt: '탄소세 도입에 찬성하는 근거를 정리해줘', response }] }] });
  const short = A.run(mk(core)).turns[0].relevance;
  const long = A.run(mk(`${filler} ${core} ${filler}`)).turns[0].relevance;
  assert.ok(short >= 0.3 && long >= 0.3, `${short} → ${long}`);
  assert.ok(long >= short * 0.8, `응답이 길어졌다고 점수가 ${short} → ${long}로 희석됨`);
});

test('대화 내용을 본문에 옮겨 썼다면 주제어가 겹치지 않아도 연관도가 올라 삭제할 수 없다', () => {
  const sentence = '일정을 미리 계획하고 매일 조금씩 나누어 작성하면 마감 직전에 몰리는 부담을 크게 줄일 수 있습니다.';
  const turn = { id: 'time', prompt: '마감이 다가오는데 시간을 어떻게 관리해야 해?', response: `${sentence} 하루에 쓸 분량을 정해 두고 휴식 시간도 미리 넣어 두세요. 중간 점검 날짜를 정하면 막판에 당황하지 않습니다.` };
  const own = '탄소세는 온실가스 배출에 비용을 부과하는 정책이다. 걷은 세수를 환급하면 저소득 가구의 부담이 줄어든다. 기업은 배출을 줄일 유인을 갖게 된다.';
  const base = { title: '탄소세 도입에 찬성하는 논증문', convs: [{ turns: [turn] }] };
  const without = A.run(mkDoc({ ...base, body: own }));
  const withCopy = A.run(mkDoc({ ...base, body: `${own} ${sentence.replace('입니다.', '다.')}` }));
  assert.ok(without.turns[0].relevance < 0.15, `옮겨 쓰지 않았는데 ${without.turns[0].relevance}`);
  assert.ok(withCopy.turns[0].relevance >= 0.3, `옮겨 썼는데 ${withCopy.turns[0].relevance}`);
  assert.strictEqual(A.canDelete(mkDoc({ ...base, body: `${own} ${sentence}` }), 'time').message, A.REFUSAL_MESSAGE);
  assert.strictEqual(A.canDelete(mkDoc({ ...base, body: own }), 'time').ok, true);
});

// ---------------------------------------------------------------- 출처 판정
const D1 = '탄소세를 도입하면 기업들이 탄소를 많이 내뿜는 만큼 돈을 내야 하니까 자연스럽게 공장에서 나오는 탄소를 줄이려고 노력하게 된다.';
const D2 = '반대하는 사람들은 물가가 올라서 서민이 힘들어진다고 하지만 걷은 세금을 서민에게 돌려주면 오히려 이득을 볼 수도 있다.';
const P1 = '탄소세를 도입하면 기업은 배출한 탄소의 양만큼 비용을 부담하게 되므로 자연스럽게 공정에서 나오는 배출량을 줄이려는 동기가 생긴다.';

test('studentOrigin: 학생이 먼저 보낸 글과 AI가 그대로 둔 문장은 주체적 작성, AI가 고친 문장만 의존으로 센다', () => {
  const doc = mkDoc({
    title: '탄소세 도입 논증문',
    body: `${D1}\n${D2}\n${P1}`,
    convs: [{ turns: [{ id: 'fix', prompt: `문장을 다듬어줘.\n${D1}\n${D2}`, response: `${P1}\n${D2}` }] }],
  });
  const r = A.run(doc);
  assert.deepStrictEqual(r.sentences.map((s) => s.kind), ['studentOrigin', 'studentOrigin', 'verbatim']);
  assert.ok(r.sentences.every((s) => s.source.turnId === 'fix'));
  assert.strictEqual(r.summary.shares.verbatim + r.summary.shares.adapted > 0.3, true);
  assert.ok(r.summary.dependency < 0.45 && r.summary.dependency > 0.2);
  assert.deepStrictEqual(r.turns[0].reflected, { verbatim: 1, adapted: 0, studentOrigin: 2 });
});

test('studentOrigin: 학생 원문을 살짝만 고쳐 쓴 문장도 AI 응답보다 원문에 가까우면 주체적 작성이다', () => {
  const tweaked = D1.replace('노력하게 된다', '노력하게 될 것이다').replace('공장에서', '공장들에서');
  const doc = mkDoc({
    title: '탄소세 도입 논증문',
    body: tweaked,
    convs: [{ turns: [{ id: 'fix', prompt: `다듬어줘.\n${D1}`, response: P1 }] }],
  });
  const s = A.run(doc).sentences[0];
  assert.strictEqual(s.kind, 'studentOrigin');
});

test('studentOrigin이 아니다: AI가 먼저 쓴 글을 나중 프롬프트에 붙여넣은 경우는 먼저 나온 응답을 출처로 본다 (같은 대화·다른 대화)', () => {
  const X = '탄소세는 온실가스를 배출하는 행위에 직접 비용을 부과하여 기업과 가계가 스스로 배출을 줄이도록 유도하는 시장 친화적 정책입니다.';
  const X2 = '탄소세는 온실가스를 배출하는 행위에 직접 비용을 부과하므로 기업과 가계가 스스로 배출을 줄이도록 하는 시장 친화적 정책이라고 할 수 있습니다.';
  const sameConv = mkDoc({
    title: '탄소세 도입 논증문',
    body: X,
    convs: [{ turns: [
      { id: 'first', prompt: '탄소세가 뭐야?', response: X },
      { id: 'again', prompt: `이 글을 더 쉽게 고쳐줘.\n${X}`, response: X2 },
    ] }],
  });
  const a = A.run(sameConv).sentences[0];
  assert.strictEqual(a.kind, 'verbatim');
  assert.strictEqual(a.source.turnId, 'first');
  const crossConv = mkDoc({
    title: '탄소세 도입 논증문',
    body: X,
    convs: [
      { turns: [{ id: 'ai', prompt: '탄소세가 뭐야?', response: X }] },
      { turns: [{ id: 'paste', prompt: `맞춤법만 봐줘.\n${X}`, response: '맞춤법은 정확합니다.' }] },
    ],
  });
  const b = A.run(crossConv).sentences[0];
  assert.strictEqual(b.kind, 'verbatim');
  assert.strictEqual(b.source.turnId, 'ai');
  assert.deepStrictEqual(A.run(sameConv).turns.find((t) => t.id === 'again').reflected, { verbatim: 0, adapted: 0, studentOrigin: 0 });
});

test('studentOrigin: AI가 피드백만 하고 문장을 쓰지 않았어도 학생이 보낸 원문과 같은 문장은 주체적 작성이다', () => {
  const doc = mkDoc({
    title: '탄소세 도입 논증문',
    body: D2,
    convs: [{ turns: [{ id: 'fb', prompt: `이 문단 피드백 해줘.\n${D2}`, response: '논리는 좋습니다. 근거를 한 가지 더 보강하세요.' }] }],
  });
  const s = A.run(doc).sentences[0];
  assert.strictEqual(s.kind, 'studentOrigin');
  assert.strictEqual(s.source.turnId, 'fb');
});

// ---------------------------------------------------------------- 의도
test('의도 분류: 한국어와 영어 키워드, 우선순위, 붙여넣은 글 속 단어에 속지 않기', () => {
  const table = [
    ['서론 본론 결론 개요를 짜줘', 'outline'], ['보고서 목차 만들어줘', 'outline'], ['Give me an outline for my essay', 'outline'],
    ['이 글 요약해줘', 'summarize'], ['Summarize this article', 'summarize'], ['핵심만 간추려줘', 'summarize'],
    ['문장을 자연스럽게 다듬어줘', 'revise'], ['맞춤법 고쳐줘', 'revise'], ['Can you fix the grammar?', 'revise'], ['Please proofread my paragraph', 'revise'], ['이 문장 다시 써줘 말고 고쳐 써줘', 'revise'],
    ['내 글 피드백 해줘', 'feedback'], ['이 코드 리뷰해줘', 'feedback'], ['Can you review my draft and give feedback?', 'feedback'],
    ['논점을 정리해줘', 'ideas'], ['주제 추천해줘', 'ideas'], ['Brainstorm some ideas for my essay', 'ideas'], ['I need arguments for a persuasive essay', 'ideas'],
    ['서론을 써줘', 'generate'], ['함수를 작성해줘', 'generate'], ['Write a paragraph about taxes', 'generate'], ['Draft an introduction', 'generate'],
    ['탄소세가 뭐야?', 'explain'], ['더 자세히 알려줘', 'explain'], ['What is a hash table?', 'explain'], ['tell me more', 'explain'], ['차이점을 설명해줘', 'explain'],
    ['오늘 저녁 뭐 먹을지 추천해줘', 'other'], ['남자친구가 연락을 안 해서 서운해', 'other'], ['', 'other'],
  ];
  for (const [prompt, want] of table) assert.strictEqual(A.classifyIntent(prompt), want, prompt);
  // 우선순위: 구체적인 작업이 일반 동사를 이긴다
  assert.strictEqual(A.classifyIntent('개요를 작성해줘'), 'outline');
  assert.strictEqual(A.classifyIntent('고쳐 써줘'), 'revise');
  assert.strictEqual(A.classifyIntent('요약해서 설명해줘'), 'summarize');
  // 긴 프롬프트는 앞뒤 지시문만 본다: 붙여넣은 글 가운데의 '요약'·'개요'에 속지 않는다
  const middle = '그리고 이 단락에서는 요약과 개요를 설명하고 피드백도 다룬다. '.repeat(30);
  assert.strictEqual(A.classifyIntent(`문장을 다듬어줘.\n${middle}\n끝.`), 'revise');
  assert.strictEqual(A.classifyIntent(`${middle}\n이 글을 다듬어줘.`), 'revise');
});

// ---------------------------------------------------------------- 요약 문구
test('summaryLine과 narrative: 형식, 필수 내용, 정직성 규칙(단정 표현 없음·한계 명시)', () => {
  for (const f of FIXTURES) {
    const r = RUNS.get(f.id);
    for (const t of r.turns) {
      assert.match(t.summaryLine, /^요청: .+ · 연관도 \d+% · 과제 반영: (없음|문장 \d+개\(그대로 \d+, 수정 \d+\))/);
      assert.ok(t.summaryLine.includes(`연관도 ${Math.round(t.relevance * 100)}%`));
      assert.ok(t.summaryLine.includes(A.intentLabel(t.intent)));
      assert.strictEqual(t.summaryLine.includes('삭제 가능'), t.deletable);
    }
    const text = r.narrative.join('\n');
    assert.ok(text.includes(`${r.summary.turnCount}개`));
    assert.ok(text.includes(`${Math.round(r.summary.dependency * 100)}%`));
    assert.ok(text.includes(A.intentLabel(r.turns[0].intent)) && text.includes(`${Math.round(r.turns[0].relevance * 100)}%`), '가장 연관도 높은 대화가 빠짐');
    assert.ok(/추정/.test(text) && /원본인지 이 도구가 검증하지 못/.test(text) && /하한/.test(text), '한계 문구가 빠짐');
    assert.ok(r.narrative[r.narrative.length - 1].includes('추정'), '한계는 마지막 줄');
  }
  // 명세의 예시 "요청: 개요 구성 · 연관도 87% · 과제 반영: 문장 4개(그대로 1, 수정 3)"와 같은 모양이 실제로 나온다
  const withReflection = FIXTURES.flatMap((f) => RUNS.get(f.id).turns).find((t) => t.reflected.verbatim + t.reflected.adapted >= 2);
  assert.ok(withReflection, '문장을 둘 이상 반영한 턴이 없음');
  const n = withReflection.reflected.verbatim + withReflection.reflected.adapted;
  assert.ok(withReflection.summaryLine.includes(`과제 반영: 문장 ${n}개(그대로 ${withReflection.reflected.verbatim}, 수정 ${withReflection.reflected.adapted})`));
});

test('모든 문장을 그대로 옮긴 최악의 경우에도 단정 표현 없이 근거 중심으로 쓴다', () => {
  const f = FIXTURES[0];
  const body = f.doc.conversations[0].turns.slice(0, 4).map((t) => t.response.replace(/\*\*/g, '')).join('\n\n');
  const doc = { ...clone(f.doc), submission: { text: body } };
  const r = A.run(doc);
  assert.strictEqual(r.summary.band, 'high');
  assert.ok(r.summary.dependency >= 0.9);
  checkInvariants(doc, r);
  assert.ok(r.narrative.join('\n').includes('AI 답변과의 겹침'));
});

test('삭제 기록에 연관도가 기준 이상인 항목이 있으면 narrative가 앱의 삭제 규칙과 맞지 않는다고 밝힌다', () => {
  const f = FIXTURES[1];
  const doc = clone(f.doc);
  doc.deletions = [{ turnId: 'x', convId: 'c', relevance: 0.05, chars: 100 }, { turnId: 'y', convId: 'c', relevance: 0.6, chars: 900 }];
  const r = A.run(doc);
  const text = r.narrative.join('\n');
  assert.ok(text.includes('삭제된 대화는 2개') && text.includes('1개는 기록된 연관도가 삭제 기준'));
  doc.deletions = [doc.deletions[0]];
  assert.ok(!A.run(doc).narrative.join('\n').includes('맞지 않습니다'));
  checkInvariants(doc, A.run(doc));
});

// ---------------------------------------------------------------- 견고성
test('견고성: 빈 본문·대화 없음·턴 없음·아주 짧은 본문·영어만·이모지·코드블록·깨진 입력에서 예외 없이 불변 조건을 지킨다', () => {
  const t = [{ id: 't', prompt: '탄소세가 뭐야?', response: '탄소세는 온실가스 배출에 비용을 부과하는 정책입니다.' }];
  const docs = [
    mkDoc({ title: '제목', body: '', convs: [{ turns: t }] }),
    mkDoc({ title: '제목', body: '   \n\n\t ', convs: [{ turns: t }] }),
    mkDoc({ title: '제목', body: '탄소세는 온실가스 배출에 비용을 부과하는 정책이다.', convs: [] }),
    mkDoc({ title: '제목', body: '탄소세는 온실가스 배출에 비용을 부과하는 정책이다.', convs: [{ turns: [] }, { turns: [] }] }),
    mkDoc({ title: '', body: '네.', convs: [{ turns: t }] }),
    mkDoc({ title: '', body: 'ㅇ', convs: [{ turns: [{ prompt: '', response: '' }] }] }),
    mkDoc({ title: 'Carbon tax', body: 'Carbon taxes put a price on emissions. That gives firms a reason to cut them.', convs: [{ turns: [{ prompt: 'What is a carbon tax?', response: 'A carbon tax puts a price on emissions. That gives firms a reason to cut them.' }] }] }),
    mkDoc({ title: '😀', body: '😀😀😀 🎉🎉🎉\n\n👍', convs: [{ turns: [{ prompt: '😀', response: '🎉🎉 👍👍' }] }] }),
    mkDoc({ title: '코드', body: '```python\nprint("hi")\n```', convs: [{ turns: [{ prompt: '```', response: '```js\nlet a = 1;\n```\n```' }] }] }),
    mkDoc({ title: '표', body: '| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n***\n> 인용\n- 목록', convs: [{ turns: [{ prompt: '| x |', response: '| y |\n|---|' }] }] }),
    mkDoc({ title: '제목', body: 'A'.repeat(5000) + '\n' + '가'.repeat(5000), convs: [{ turns: [{ prompt: 'B'.repeat(5000), response: '나'.repeat(5000) }] }] }),
  ];
  for (const d of docs) {
    const r = A.run(d);
    checkInvariants(d, r);
    assert.ok(Array.isArray(r.sentences));
  }
  const empty = A.run(docs[0]);
  assert.deepStrictEqual(empty.sentences, []);
  assert.deepStrictEqual(empty.summary.shares, { verbatim: 0, adapted: 0, studentOrigin: 0, original: 1 });
  assert.strictEqual(empty.summary.dependency, 0);
  assert.ok(empty.narrative.join('').includes('본문이 비어'));
  const noTurns = A.run(docs[2]);
  assert.strictEqual(noTurns.turns.length, 0);
  assert.strictEqual(noTurns.summary.relatedTurnCount, 0);
  assert.ok(noTurns.narrative.join('').includes('첨부된 AI 대화가 없'));
  // 구조가 깨진 문서
  const broken = [undefined, null, {}, { conversations: null }, { submission: { text: null }, conversations: [null, {}, { turns: null }, { turns: [null, {}, { id: 5, prompt: 7, response: { a: 1 } }] }] }, { meta: null, submission: null, conversations: [{ id: null, turns: [{ prompt: null }] }] }];
  for (const d of broken) assert.doesNotThrow(() => { const r = A.run(d); assert.ok(Array.isArray(r.turns)); });
  assert.strictEqual(A.canDelete(undefined, 'x').ok, false);
  assert.strictEqual(A.deleteTurn(undefined, 'x').ok, false);
});

test('견고성: 아주 긴 입력(본문·응답 수십만 자)과 병적인 입력이 예외 없이 제때 끝난다', () => {
  const pool = FIXTURES.flatMap((f) => f.doc.conversations.flatMap((c) => c.turns.map((t) => t.response))).join(' ');
  const big = (n) => pool.repeat(Math.ceil(n / pool.length)).slice(0, n);
  const started = Date.now();
  const huge = mkDoc({ title: '탄소세 이진 탐색', body: big(400000), convs: [{ turns: [{ prompt: big(50000), response: big(400000) }, { prompt: '안녕', response: '안녕하세요' }] }] });
  const r = A.run(huge);
  checkInvariants(huge, r);
  const pathological = ['x'.padStart(100000, ' '), '-'.repeat(100000), 'A'.repeat(100000), '1. '.repeat(30000), 'e.g. a '.repeat(30000), '`'.repeat(50000), '\n'.repeat(100000), '😀'.repeat(50000), '가'.repeat(300000), '가 '.repeat(100000)];
  for (const p of pathological) {
    const d = mkDoc({ title: p.slice(0, 50), brief: p.slice(0, 50), body: p, convs: [{ turns: [{ prompt: p, response: p }] }] });
    checkInvariants(d, A.run(d));
  }
  assert.ok(Date.now() - started < 15000, `너무 오래 걸림: ${Date.now() - started}ms`);
});

test('성능: 본문 20,000자 + 턴 60개(턴당 약 1,500자)를 300ms 안에 처리한다 (첫 호출 기준)', (t) => {
  const pool = FIXTURES.flatMap((f) => f.doc.conversations.flatMap((c) => c.turns.flatMap((x) => [x.response, x.prompt])))
    .join(' ').split(/(?<=[.다요])\s+/).filter((s) => s.length > 15);
  const gen = (len, seed) => { let s = ''; for (let i = 0; s.length < len; i++) s += `${pool[(i * 7 + seed * 13) % pool.length]} ${i % 8 === 7 ? '\n\n' : ''}`; return s.slice(0, len); };
  const doc = mkDoc({
    title: '탄소세 구독 서비스 이진 탐색 보고서',
    body: gen(20000, 1),
    convs: [{ turns: Array.from({ length: 60 }, (_, k) => ({ id: `p${k}`, prompt: pool[(k * 11) % pool.length], response: gen(1500, k + 2) })) }],
  });
  assert.ok(doc.submission.text.length === 20000);
  const t0 = process.hrtime.bigint();
  const r = A.run(doc);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  t.diagnostic(`20,000자 + 60턴: 첫 호출 ${ms.toFixed(0)}ms, 문장 ${r.sentences.length}개`);
  assert.ok(ms < 300, `${ms.toFixed(0)}ms`);
  checkInvariants(doc, r);
  const t1 = process.hrtime.bigint();
  A.canDelete(doc, 'p3');
  assert.ok(Number(process.hrtime.bigint() - t1) / 1e6 < 100, 'canDelete는 한 턴만 계산하므로 훨씬 빨라야 한다');
});

test('역할을 나누지 못한 대화(parsed: unparsed)가 있으면 narrative가 의존도가 높게 나올 수 있다고 밝힌다', () => {
  const doc = clone(FIXTURES[0].doc);
  doc.conversations[0].parsed = 'unparsed';
  assert.ok(A.run(doc).narrative.join('\n').includes('역할 표지를 찾지 못한 대화가 1개'));
  assert.ok(!RUNS.get(FIXTURES[0].id).narrative.join('\n').includes('역할 표지'));
});

test('퍼징: 무작위(고정 시드) 문서 200개에서 예외 없이 불변 조건을 지키고 결과가 JSON으로 왕복된다', () => {
  let seed = 20260101;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const POOL = ['가', '나', '다', '탄소세', '를', '는', '입니다', '합니다', '했다', '. ', '? ', '! ', '\n', '\n\n', '  ', '**', '`', '```', '# ', '- ', '1. ', '| ', '😀', 'abc', 'Carbon', 'tax', 'the', 'of', 'é', '中', 'の', '—', '…', '"', ')', 'e.g. ', '3.5', '\r\n', '\t', ' ', ' ', ' ', '정책', '배출', '비용을', '부과하여', 'emissions', 'policy', '한글입니다'.normalize('NFD'), '탄소세는'.normalize('NFD'), 'e\u0301'];
  const text = (n) => Array.from({ length: Math.floor(rnd() * n) }, () => pick(POOL)).join(pick(['', ' ']));
  for (let i = 0; i < 200; i++) {
    const body = text(120);
    const convs = Array.from({ length: Math.floor(rnd() * 3) }, () => ({
      turns: Array.from({ length: Math.floor(rnd() * 4) }, () => ({
        prompt: text(60),
        response: rnd() < 0.4 ? `${text(30)} ${body.slice(0, Math.floor(rnd() * body.length))} ${text(30)}` : text(150),
      })),
    }));
    const doc = mkDoc({ title: text(8), brief: text(10), body, convs });
    const r = A.run(doc);
    checkInvariants(doc, r);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), r, 'JSON으로 왕복되지 않음(NaN·undefined)');
    for (const t of r.turns) assert.strictEqual(A.canDelete(doc, t.id).relevance, t.relevance);
  }
});
