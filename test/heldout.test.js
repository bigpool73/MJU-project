'use strict';
/**
 * 블라인드 검증(held-out) — 엔진 구현을 보지 않고 docs/spec-v2.md 의 계약만으로 만든 케이스로 Analyze 를 검사한다.
 * 케이스: test/heldout/cases.js (조각·턴 정답은 구성으로 확정). 하드 어서트는 실패하면 테스트 실패,
 * 소프트 지표(혼동행렬·연관도 분포·오분류 목록)는 어서트하지 않고 끝에 출력하고 JSON 으로 저장한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Analyze = require('../src/analyze.js');
const { cases, validateCase } = require('./heldout/cases.js');

const METRICS_PATH = process.env.HELDOUT_METRICS_PATH
  || '/tmp/claude-0/-home-user-mju-project/7e238b33-e2a6-5f87-a0b0-3b0cd2586e3e/scratchpad/heldout-metrics.json';
const KINDS = ['verbatim', 'adapted', 'studentOrigin', 'original'];
const PRED_KINDS = [...KINDS, 'none'];
const AI_FAMILY = new Set(['verbatim', 'adapted']);
const REFUSAL = '해당 대화는 과제와 연관도가 높아, 삭제가 불가합니다.'; // 명세 Analyze.REFUSAL_MESSAGE 값

const round = (n, d = 3) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? `${a}/${b} = ${(100 * a / b).toFixed(1)}%` : `${a}/${b}`);
const head = (s, n = 34) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\n/g, '⏎');
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- 분석 결과를 정답 조각에 대응시키기 ----------

/** 엔진이 나눈 문장과 정답 조각의 글자 겹침으로 투표해, 조각마다 엔진의 판정을 하나 정한다. */
function predictSegments(c, result) {
  const order = ['original', 'studentOrigin', 'adapted', 'verbatim']; // 동률이면 앞쪽을 택해 결정적으로 만든다
  return c.segments.map((seg) => {
    const votes = { verbatim: 0, adapted: 0, studentOrigin: 0, original: 0 };
    const srcVotes = new Map();
    let scoreSum = 0;
    let weight = 0;
    for (const s of result.sentences) {
      const ov = Math.min(seg.end, s.end) - Math.max(seg.start, s.start);
      if (ov <= 0 || !(s.kind in votes)) continue;
      votes[s.kind] += ov;
      scoreSum += (s.score || 0) * ov;
      weight += ov;
      if (s.source && s.source.turnId) srcVotes.set(s.source.turnId, (srcVotes.get(s.source.turnId) || 0) + ov);
    }
    let predicted = 'none';
    let best = 0;
    for (const k of order) if (votes[k] > best) { best = votes[k]; predicted = k; }
    let sourceTurn = null;
    let sv = 0;
    for (const [id, v] of srcVotes) if (v > sv) { sv = v; sourceTurn = id; }
    return { seg, predicted, score: weight ? scoreSum / weight : null, sourceTurn };
  });
}

const analysisCache = new Map();
function analysisOf(c) {
  if (!analysisCache.has(c.id)) {
    const doc = c.makeDoc();
    const result = Analyze.run(doc);
    analysisCache.set(c.id, { c, doc, result, pred: predictSegments(c, result) });
  }
  return analysisCache.get(c.id);
}

const allPred = () => cases.flatMap((c) => analysisOf(c).pred.map((p) => ({ ...p, caseId: c.id })));

function describeMiss(p) {
  const s = p.seg;
  return `${p.caseId}:${s.idx} [${s.kind}→${p.predicted}${s.traps.length ? ' ' + s.traps.join(',') : ''}] "${head(s.text)}"`;
}

// ---------- 하드 어서트 ----------

test('케이스 데이터 내부 일관성(엔진과 무관)', () => {
  const errors = cases.flatMap((c) => validateCase(c).errors);
  assert.deepStrictEqual(errors, []);
});

test('턴 라벨: 정답 unrelated 는 삭제 가능, related 는 삭제 불가', () => {
  const wrong = [];
  for (const c of cases) {
    const doc = c.makeDoc();
    for (const t of c.turns) {
      if (t.label === 'borderline') continue;
      const r = Analyze.canDelete(doc, t.id);
      const want = t.label === 'unrelated';
      if (r.ok !== want) wrong.push(`${c.id}/${t.id} [${t.label}${t.traps.length ? ' ' + t.traps.join(',') : ''}] relevance=${round(r.relevance)} ok=${r.ok}`);
    }
  }
  assert.deepStrictEqual(wrong, [], `삭제 판정이 정답과 다른 턴 ${wrong.length}개`);
});

test('verbatim 조각의 90% 이상이 verbatim 또는 adapted', () => {
  const rows = allPred().filter((p) => p.seg.kind === 'verbatim');
  const hit = rows.filter((p) => AI_FAMILY.has(p.predicted)).length;
  const misses = rows.filter((p) => !AI_FAMILY.has(p.predicted)).map(describeMiss);
  assert.ok(hit / rows.length >= 0.9, `verbatim 적중 ${pct(hit, rows.length)}; 놓친 조각:\n  ${misses.join('\n  ')}`);
});

test('original 조각 중 verbatim 으로 분류된 비율 5% 이하', () => {
  const rows = allPred().filter((p) => p.seg.kind === 'original');
  const bad = rows.filter((p) => p.predicted === 'verbatim');
  assert.ok(bad.length / rows.length <= 0.05, `original→verbatim ${pct(bad.length, rows.length)}:\n  ${bad.map(describeMiss).join('\n  ')}`);
});

test('studentOrigin 조각이 verbatim/adapted 로 분류되는 비율 20% 이하', () => {
  const rows = allPred().filter((p) => p.seg.kind === 'studentOrigin');
  const bad = rows.filter((p) => AI_FAMILY.has(p.predicted));
  assert.ok(bad.length / rows.length <= 0.2, `studentOrigin→AI ${pct(bad.length, rows.length)}:\n  ${bad.map(describeMiss).join('\n  ')}`);
});

test('의존도 단조성: AI 문장을 더 많이 복사한 변형일수록 dependency 가 크다 (전부 학생 <0.10, 전부 복사 >=0.80)', () => {
  const problems = [];
  for (const c of cases) {
    const deps = c.chain.map((v) => Analyze.run(c.makeDoc(v.text)).summary.dependency);
    for (let i = 1; i < deps.length; i++) {
      if (!(deps[i] > deps[i - 1])) problems.push(`${c.id}: ${c.chain[i - 1].aiCount}→${c.chain[i].aiCount}칸에서 ${round(deps[i - 1], 4)}→${round(deps[i], 4)} (증가하지 않음)`);
    }
    if (!(deps[0] < 0.1)) problems.push(`${c.id}: 전부 학생 본문의 dependency ${round(deps[0], 4)} (<0.10 아님)`);
    if (!(deps[deps.length - 1] >= 0.8)) problems.push(`${c.id}: 전부 복사 본문의 dependency ${round(deps[deps.length - 1], 4)} (>=0.80 아님)`);
  }
  assert.deepStrictEqual(problems, []);
});

// ---------- 명세 불변 조건 (명세에 적힌 것만) ----------

test('명세 불변 조건: 임계값, 오프셋, 정렬, 비율, 결정성', () => {
  assert.strictEqual(Analyze.DELETE_THRESHOLD, 0.15);
  for (const c of cases) {
    const { doc, result } = analysisOf(c);
    let prevStart = -1;
    for (const s of result.sentences) {
      assert.strictEqual(s.text, doc.submission.text.slice(s.start, s.end), `${c.id}: 문장 오프셋이 본문과 맞지 않음 (idx ${s.idx})`);
      assert.ok(s.start >= prevStart, `${c.id}: 문장이 본문 순서가 아님`);
      prevStart = s.start;
    }
    for (let i = 1; i < result.turns.length; i++) {
      const a = result.turns[i - 1];
      const b = result.turns[i];
      const ok = a.relevance > b.relevance
        || (a.relevance === b.relevance && (a.convIndex < b.convIndex || (a.convIndex === b.convIndex && a.index < b.index)));
      assert.ok(ok, `${c.id}: 턴이 연관도 내림차순(동점은 대화·턴 순서)이 아님: ${a.id}(${a.relevance}) 다음 ${b.id}(${b.relevance})`);
    }
    assert.strictEqual(result.turns.length, c.turns.length, `${c.id}: 결과 턴 수`);
    const sm = result.summary;
    const shareSum = KINDS.reduce((acc, k) => acc + sm.shares[k], 0);
    assert.ok(Math.abs(shareSum - 1) < 1e-6, `${c.id}: shares 합 ${shareSum}`);
    assert.ok(Math.abs(sm.dependency - (sm.shares.verbatim + 0.5 * sm.shares.adapted)) < 1e-6, `${c.id}: dependency 식 불일치`);
    assert.ok(Math.abs(sm.autonomy - (1 - sm.dependency)) < 1e-6, `${c.id}: autonomy != 1-dependency`);
    for (const t of result.turns) {
      const cd = Analyze.canDelete(doc, t.id);
      assert.strictEqual(cd.ok, cd.relevance < Analyze.DELETE_THRESHOLD, `${c.id}/${t.id}: ok 가 relevance < 임계값과 일치하지 않음`);
      assert.ok(Math.abs(cd.relevance - t.relevance) < 1e-9, `${c.id}/${t.id}: canDelete 와 run 의 relevance 가 다름`);
    }
    assert.deepStrictEqual(Analyze.run(c.makeDoc()), result, `${c.id}: 같은 입력인데 결과가 다름(비결정적)`);
    const fresh = c.makeDoc();
    const snap = clone(fresh);
    Analyze.run(fresh);
    assert.deepStrictEqual(fresh, snap, `${c.id}: run 이 입력 doc 을 바꿈`);
  }
});

test('삭제: 연관 높은 턴은 거부 메시지, 무관 턴은 불변 삭제 + 내용 미보존 + 남은 턴 연관도 불변', () => {
  for (const c of cases) {
    const doc = c.makeDoc();
    const before = clone(doc);
    const result = Analyze.run(doc);
    const byId = new Map(result.turns.map((t) => [t.id, t]));
    for (const t of c.turns.filter((x) => x.label === 'related')) {
      const r = Analyze.deleteTurn(doc, t.id);
      assert.strictEqual(r.ok, false, `${c.id}/${t.id}: related 턴이 삭제됨`);
      assert.strictEqual(r.message, REFUSAL, `${c.id}/${t.id}: 거부 메시지`);
      assert.deepStrictEqual((r.doc || doc).conversations, before.conversations, `${c.id}/${t.id}: 거부했는데 대화가 바뀜`);
    }
    let cur = doc;
    const gone = [];
    for (const t of c.turns.filter((x) => x.label === 'unrelated')) {
      const r = Analyze.deleteTurn(cur, t.id);
      if (!r.ok) continue; // 삭제 가능 여부 자체는 위의 하드 어서트가 본다
      assert.notStrictEqual(r.doc, cur, `${c.id}/${t.id}: 새 doc 을 돌려주지 않음`);
      cur = r.doc;
      gone.push(c.turnMap.get(t.id));
    }
    assert.deepStrictEqual(doc, before, `${c.id}: deleteTurn 이 입력 doc 을 바꿈`);
    const json = JSON.stringify(cur);
    for (const g of gone) assert.ok(!json.includes(g.response), `${c.id}/${g.id}: 삭제한 응답이 doc 에 남아 있음`);
    assert.strictEqual((cur.deletions || []).length, gone.length, `${c.id}: deletions 기록 수`);
    const after = Analyze.run(cur);
    assert.strictEqual(after.turns.length, c.turns.length - gone.length, `${c.id}: 삭제 후 턴 수`);
    for (const t of after.turns) {
      assert.ok(Math.abs(t.relevance - byId.get(t.id).relevance) < 1e-9, `${c.id}/${t.id}: 다른 턴을 지웠더니 연관도가 바뀜`);
    }
  }
});

// ---------- 소프트 지표 (어서트 없음) ----------

function stats(arr) {
  if (!arr.length) return { n: 0, min: null, mean: null, max: null };
  return { n: arr.length, min: round(Math.min(...arr)), mean: round(arr.reduce((a, b) => a + b, 0) / arr.length), max: round(Math.max(...arr)) };
}

function confusion(rows) {
  const m = {};
  for (const k of KINDS) { m[k] = {}; for (const p of PRED_KINDS) m[k][p] = 0; }
  for (const r of rows) m[r.seg.kind][r.predicted]++;
  return m;
}

function collectMetrics() {
  const out = { cases: [], note: '정답은 구성으로 확정된 값. 소프트 지표는 어서트하지 않는다.' };
  const preds = [];
  const turnRows = [];
  for (const c of cases) {
    let a;
    try { a = analysisOf(c); } catch (e) { out.cases.push({ id: c.id, error: String(e && e.message) }); continue; }
    a.pred.forEach((p) => preds.push({ ...p, caseId: c.id }));
    const byId = new Map(a.result.turns.map((t) => [t.id, t]));
    const labelRel = { related: [], borderline: [], unrelated: [] };
    for (const t of c.turns) {
      const r = byId.get(t.id);
      if (!r) continue;
      labelRel[t.label].push(r.relevance);
      turnRows.push({ caseId: c.id, id: t.id, label: t.label, traps: t.traps, relevance: r.relevance, deletable: r.relevance < Analyze.DELETE_THRESHOLD, intent: r.intent });
    }
    // 정답 의존도(글자 수 기준)와 엔진 값
    let aiChars = 0;
    let total = 0;
    for (const s of c.segments) {
      const len = s.end - s.start;
      total += len;
      if (s.kind === 'verbatim') aiChars += len;
      else if (s.kind === 'adapted') aiChars += 0.5 * len;
    }
    let chain = null;
    try { chain = c.chain.map((v) => ({ aiCount: v.aiCount, slots: v.slots, dependency: round(Analyze.run(c.makeDoc(v.text)).summary.dependency, 4) })); } catch (e) { chain = String(e && e.message); }
    out.cases.push({
      id: c.id,
      field: c.field,
      bodyChars: c.body.length,
      expectedDependency: round(aiChars / total, 4),
      engineDependency: round(a.result.summary.dependency, 4),
      band: a.result.summary.band,
      confusion: confusion(a.pred),
      relevance: { related: stats(labelRel.related), borderline: stats(labelRel.borderline), unrelated: stats(labelRel.unrelated) },
      chain,
    });
  }

  out.confusion = confusion(preds);
  out.segmentTotals = Object.fromEntries(KINDS.map((k) => [k, preds.filter((p) => p.seg.kind === k).length]));
  out.turnTotals = Object.fromEntries(['related', 'borderline', 'unrelated'].map((l) => [l, turnRows.filter((t) => t.label === l).length]));

  // 함정별: 정답 계열(AI: verbatim/adapted, 학생: studentOrigin/original)과 맞는 비율
  const trapMap = {};
  for (const p of preds) {
    for (const tag of p.seg.traps.length ? p.seg.traps : ['(none)']) {
      const e = trapMap[tag] || (trapMap[tag] = { n: 0, familyOk: 0, exact: 0, predicted: {} });
      e.n++;
      const truthAi = AI_FAMILY.has(p.seg.kind);
      if (truthAi === AI_FAMILY.has(p.predicted) && p.predicted !== 'none') e.familyOk++;
      if (p.predicted === p.seg.kind) e.exact++;
      e.predicted[p.predicted] = (e.predicted[p.predicted] || 0) + 1;
    }
  }
  out.byTrap = trapMap;

  out.relevance = {};
  for (const l of ['related', 'borderline', 'unrelated']) out.relevance[l] = stats(turnRows.filter((t) => t.label === l).map((t) => t.relevance));
  out.turnTrapRelevance = {};
  for (const tag of ['shortFollowup', 'longResponse', 'lexicalOverlap', 'draft']) {
    const rows = turnRows.filter((t) => t.traps.includes(tag));
    out.turnTrapRelevance[tag] = { ...stats(rows.map((t) => t.relevance)), labels: rows.reduce((acc, t) => { acc[t.label] = (acc[t.label] || 0) + 1; return acc; }, {}) };
  }
  out.borderlineDeletable = turnRows.filter((t) => t.label === 'borderline').map((t) => ({ id: `${t.caseId}/${t.id}`, relevance: round(t.relevance), deletable: t.deletable }));

  const hitRows = preds.filter((p) => ['verbatim', 'adapted', 'studentOrigin'].includes(p.seg.kind) && ['verbatim', 'adapted', 'studentOrigin'].includes(p.predicted));
  out.sourceHit = { n: hitRows.length, hit: hitRows.filter((p) => p.sourceTurn === p.seg.from).length };

  out.misclassifiedSegments = preds
    .filter((p) => AI_FAMILY.has(p.seg.kind) !== AI_FAMILY.has(p.predicted) || p.predicted === 'none')
    .map((p) => ({ case: p.caseId, idx: p.seg.idx, truth: p.seg.kind, predicted: p.predicted, score: round(p.score), traps: p.seg.traps, text: head(p.seg.text, 60) }));
  out.misclassifiedTurns = turnRows
    .filter((t) => (t.label === 'unrelated' && !t.deletable) || (t.label === 'related' && t.deletable))
    .map((t) => ({ case: t.caseId, id: t.id, label: t.label, traps: t.traps, relevance: round(t.relevance) }));
  out.turnRows = turnRows.map((t) => ({ ...t, relevance: round(t.relevance) }));
  return out;
}

function printSummary(m) {
  const L = [];
  L.push('');
  L.push('======== held-out 요약 (소프트 지표, 어서트 아님) ========');
  L.push(`케이스 ${cases.length}개 | 조각 ${JSON.stringify(m.segmentTotals)} | 턴 ${JSON.stringify(m.turnTotals)}`);
  L.push('');
  L.push('[조각 혼동행렬] 행=정답, 열=엔진');
  L.push(['정답\\엔진', ...PRED_KINDS].map((x) => x.padEnd(14)).join(''));
  for (const k of KINDS) L.push([k, ...PRED_KINDS.map((p) => String(m.confusion[k][p]))].map((x) => x.padEnd(14)).join(''));
  L.push('');
  L.push('[함정별] n / 계열 일치(AI↔학생) / 정확 일치 / 엔진 판정 분포');
  for (const [tag, e] of Object.entries(m.byTrap)) L.push(`  ${tag.padEnd(13)} ${String(e.n).padStart(3)}  계열 ${pct(e.familyOk, e.n).padEnd(16)} 정확 ${pct(e.exact, e.n).padEnd(16)} ${JSON.stringify(e.predicted)}`);
  L.push('');
  L.push('[턴 연관도] min / mean / max (n)');
  for (const l of ['related', 'borderline', 'unrelated']) {
    const s = m.relevance[l];
    L.push(`  ${l.padEnd(11)} ${s.min} / ${s.mean} / ${s.max} (n=${s.n})`);
  }
  for (const [tag, s] of Object.entries(m.turnTrapRelevance)) L.push(`  턴 함정 ${tag.padEnd(15)} ${s.min} / ${s.mean} / ${s.max} (n=${s.n}) ${JSON.stringify(s.labels)}`);
  const bd = m.borderlineDeletable;
  L.push(`  borderline 중 삭제 가능으로 판정: ${bd.filter((x) => x.deletable).length}/${bd.length}`);
  L.push('');
  L.push('[케이스별] 정답 의존도 vs 엔진 의존도, 사다리(AI 칸 수: 의존도)');
  for (const c of m.cases) {
    if (c.error) { L.push(`  ${c.id}: 실행 오류 ${c.error}`); continue; }
    const chain = Array.isArray(c.chain) ? c.chain.map((v) => `${v.aiCount}/${v.slots}:${v.dependency}`).join('  ') : c.chain;
    L.push(`  ${c.id.padEnd(15)} 정답 ${c.expectedDependency}  엔진 ${c.engineDependency} (${c.band})  | ${chain}`);
  }
  L.push('');
  L.push(`[출처 지목] AI·초안 계열로 맞게 본 조각 중 출처 턴까지 맞은 비율: ${pct(m.sourceHit.hit, m.sourceHit.n)}`);
  L.push('');
  L.push(`[오분류 조각] ${m.misclassifiedSegments.length}개 (AI↔학생 계열이 다르거나 판정 없음)`);
  for (const x of m.misclassifiedSegments) L.push(`  ${x.case}:${x.idx} ${x.truth}→${x.predicted} score=${x.score} ${x.traps.join(',')} "${x.text}"`);
  L.push(`[오분류 턴] ${m.misclassifiedTurns.length}개`);
  for (const x of m.misclassifiedTurns) L.push(`  ${x.case}/${x.id} ${x.label} relevance=${x.relevance} ${x.traps.join(',')}`);
  L.push('==========================================================');
  console.log(L.join('\n'));
}

test.after(() => {
  let m;
  try {
    m = collectMetrics();
  } catch (e) {
    console.log(`\n[held-out] 지표 수집 실패: ${e && e.message}`);
    return;
  }
  try { printSummary(m); } catch (e) { console.log(`\n[held-out] 요약 출력 실패: ${e && e.message}`); }
  try {
    fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
    fs.writeFileSync(METRICS_PATH, JSON.stringify(m, null, 2));
  } catch (e) {
    console.log(`[held-out] 지표 JSON 을 쓰지 못함(테스트에는 영향 없음): ${e && e.message}`);
  }
});
