'use strict';
/**
 * 블라인드 검증용 케이스 빌더(조립·내부 일관성 검사). 엔진 구현을 보지 않고 docs/spec-v2.md 의 계약만으로 만들었다.
 *
 * 본문은 조각(segment)을 이어 붙여 코드로 만들고, 오프셋·정답 라벨도 코드로 계산한다.
 * 그래서 "이 문장은 AI 응답에서 왔다 / 학생이 직접 썼다"가 구성으로 확정된다.
 * 케이스 원자료는 ./data/*.js, 목록과 export 는 ./cases.js. Conversation 은 명세(PDF 첨부 흐름)의 { id, provider, source, parsed, turns } 모양으로 만든다.
 *
 * 조각 종류
 *   verbatim      AI 응답 문장을 마크다운만 벗겨 그대로 (find: 응답 안 유일한 부분 문자열, 또는 text 직접)
 *   adapted       AI 문장의 어순·어휘를 바꿨지만 절반 이상 내용 유지
 *   original      AI 대화와 무관하게 직접 쓴 문장
 *   studentOrigin 학생이 먼저 프롬프트로 보낸 자기 문장(draft)을 본문에 쓴 것(가벼운 교정 포함)
 * 조각의 traps: boilerplate(상투구) short(짧은 문장) draft(교정받은 초안) sharedTerm(전문용어 공유)
 *               genericVocab(일반 어휘) code(코드)
 * 턴의 traps:   shortFollowup(짧은 후속 질문) longResponse(매우 긴 응답) lexicalOverlap(무관하지만 단어가 겹침)
 *               draft(초안 교정 턴)
 */
const Core = require('../../src/core.js');

/** 의존도 사다리: 같은 칸 수(n)에서 AI 문장으로 바꾸는 비율 */
const LEVELS = [0, 0.25, 0.5, 0.75, 1];

// ---------- 마크다운·문장 처리 ----------

/** 마크다운 기호만 벗긴다. 코드 펜스 안의 줄은 code:true 로 표시해 그대로 둔다. */
function stripMarkdown(md) {
  const out = [];
  let inFence = false;
  for (const raw of md.split('\n')) {
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) { out.push({ text: raw, code: true }); continue; }
    const text = raw
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
    if (/^(?:-{3,}|\*{3,})$/.test(text)) continue;
    out.push({ text, code: false });
  }
  return out;
}

/** 마침표·물음표·느낌표 뒤에 공백이나 줄 끝이 올 때만 문장을 끊는다 (3.5, O(1) 같은 것은 유지). */
function splitSentences(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    cur += line[i];
    if (/[.!?]/.test(line[i]) && (i + 1 >= line.length || /\s/.test(line[i + 1]))) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// ---------- 유사도(검증 전용, 엔진과 무관) ----------

/** 한글은 어절 안 2-gram, 영문은 4자 이상 단어. 일반 기능어가 점수를 올리지 않게 한다. */
function grams(s) {
  const out = new Set();
  const t = String(s).toLowerCase();
  for (const w of t.match(/[a-z0-9]+/g) || []) if (w.length >= 4) out.add('w:' + w);
  for (const run of t.match(/[가-힣]+/g) || []) {
    if (run.length === 1) out.add('h:' + run);
    for (let i = 0; i + 1 < run.length; i++) out.add('h:' + run.slice(i, i + 2));
  }
  return out;
}
function containment(a, b) {
  const A = grams(a);
  const B = grams(b);
  if (!A.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.size;
}
function dice(a, b) {
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}
const normWs = (s) => String(s).replace(/\s+/g, ' ').trim();

// ---------- 조립 ----------

function build(raw) {
  const turnMap = new Map();
  const convs = raw.conversations.map((c) => ({
    ...c,
    turns: c.turns.map((t) => {
      const lines = stripMarkdown(t.response);
      const rec = {
        ...t,
        convId: c.id,
        traps: t.traps || [],
        plain: lines.map((l) => l.text).filter(Boolean).join('\n'),
        sentences: lines.filter((l) => !l.code).flatMap((l) => splitSentences(l.text)),
      };
      if (turnMap.has(t.id)) throw new Error(`${raw.id}: 턴 id 중복 ${t.id}`);
      turnMap.set(t.id, rec);
      return rec;
    }),
  }));

  const segments = raw.segments.map((s, i) => {
    let text = s.text;
    if (s.kind === 'verbatim' && s.find) {
      const src = turnMap.get(s.from);
      if (!src) throw new Error(`${raw.id} #${i}: 없는 턴 ${s.from}`);
      const hits = src.sentences.filter((x) => x.includes(s.find));
      if (hits.length !== 1) throw new Error(`${raw.id} #${i}: find "${s.find}" 가 ${hits.length}개 문장에 걸림`);
      text = hits[0];
    }
    if (typeof text !== 'string' || !text) throw new Error(`${raw.id} #${i}: text 없음`);
    return { idx: i, kind: s.kind, from: s.from || null, draft: s.draft || null, traps: s.traps || [], brk: s.brk || null, text };
  });

  let body = '';
  segments.forEach((s, i) => {
    if (i > 0) body += s.brk === 'para' ? '\n\n' : s.brk === 'nl' ? '\n' : ' ';
    s.start = body.length;
    body += s.text;
    s.end = body.length;
  });

  const turns = convs.flatMap((c) => c.turns.map((t) => ({ id: t.id, convId: c.id, label: t.label, traps: t.traps })));
  const makeDoc = (text = body) => {
    const d = Core.blankDoc();
    d.meta = { ...raw.meta };
    d.submission.text = text;
    d.conversations = convs.map((c) => ({
      id: c.id, provider: c.provider, source: c.source, parsed: 'ok',
      turns: c.turns.map((t) => ({ id: t.id, prompt: t.prompt, response: t.response })),
    }));
    return d;
  };

  const out = { id: raw.id, field: raw.field, meta: raw.meta, convs, turnMap, turns, segments, body, makeDoc };
  out.chain = buildChain(out);
  return out;
}

/** 챗봇 특유의 응대 문장(학생이 본문에 옮길 이유가 없는 것)은 사다리 후보에서 뺀다. */
const CHAT_TALK = /드리겠|드릴게|드립니다|드릴 수|말씀해|알려|바랍니다|수정본|아래|위에서|앞에서|이어서|궁금|도와|물론입니다|알아보겠|정리했|정리해|하세요|보세요|^Use |Here|Let me|I can|I'd|feel free|let me know|Sure|Of course|below|above/i;

/** 사다리용 AI 문장 후보: 관련 있는 일반 턴(초안 교정 턴 제외)의 산문 문장에서 길이·형태 조건으로 고른다. */
function aiPool(c, n) {
  const lists = [];
  for (const conv of c.convs) {
    for (const t of conv.turns) {
      if (t.label !== 'related' || t.traps.includes('draft')) continue;
      const eng = /^[\x00-\x7f]*$/.test(t.sentences.join(''));
      const ok = t.sentences.filter((s) => {
        const len = s.length;
        const inRange = eng ? len >= 55 && len <= 230 : len >= 30 && len <= 140;
        return inRange && /[.!]$/.test(s) && !/[?:|]/.test(s) && !CHAT_TALK.test(s);
      });
      if (ok.length) lists.push(ok);
    }
  }
  const out = [];
  for (let r = 0; out.length < n && r < 60; r++) {
    for (const l of lists) {
      if (out.length >= n) break;
      const s = l[r * 2];
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

/**
 * 같은 칸(slot) 구성에서 AI 문장으로 바꾼 칸 수만 늘린 본문들.
 * 0%는 학생이 쓴 문장만(original+studentOrigin 전부), 100%는 AI 응답 문장만.
 */
function buildChain(c) {
  const own = c.segments.filter((s) => s.kind === 'original' || s.kind === 'studentOrigin').map((s) => s.text);
  const ai = aiPool(c, own.length);
  const n = Math.min(own.length, ai.length);
  let stride = 3;
  while (gcd(stride, n) !== 1) stride++;
  const order = Array.from({ length: n }, (_, i) => (i * stride) % n); // 바꿀 칸의 순서(흩어지게)
  return LEVELS.map((ratio) => {
    const k = Math.round(n * ratio);
    const swap = new Set(order.slice(0, k));
    const parts = Array.from({ length: n }, (_, i) => (swap.has(i) ? ai[i] : own[i]));
    return { ratio, aiCount: k, slots: n, text: parts.join(' '), parts, swap: [...swap] };
  });
}

// ---------- 내부 일관성 검사 (엔진 없이) ----------

function validateCase(c) {
  const errors = [];
  const info = [];
  const fail = (m) => errors.push(`[${c.id}] ${m}`);
  const allResp = c.convs.flatMap((cv) => cv.turns);
  const allRespSentences = allResp.flatMap((t) => t.sentences.map((s) => ({ s, turn: t.id })));
  const prompts = allResp.map((t) => ({ p: normWs(t.prompt), id: t.id }));

  if (c.body.length < 800 || c.body.length > 2000) fail(`본문 길이 ${c.body.length}자 (800~2000 아님)`);
  for (const s of c.segments) {
    if (c.body.slice(s.start, s.end) !== s.text) fail(`#${s.idx} 오프셋 불일치`);
  }
  const ids = c.turns.map((t) => t.id);
  if (new Set(ids).size !== ids.length) fail('턴 id 중복');
  for (const t of c.turns) if (!['related', 'borderline', 'unrelated'].includes(t.label)) fail(`${t.id} 라벨 이상: ${t.label}`);

  const rows = [];
  for (const s of c.segments) {
    const row = { idx: s.idx, kind: s.kind, traps: s.traps.join(','), len: s.text.length };
    const src = s.from ? c.turnMap.get(s.from) : null;
    if (s.kind !== 'original' && !src) { fail(`#${s.idx} ${s.kind} 인데 from 턴이 없음`); rows.push(row); continue; }
    const text = normWs(s.text);

    if (s.kind === 'verbatim') {
      if (!normWs(src.plain).includes(text)) fail(`#${s.idx} verbatim 이 ${s.from} 응답(마크다운 제거)에 없음`);
      if (prompts.some((p) => p.p.includes(text))) fail(`#${s.idx} verbatim 문장이 학생 프롬프트에도 있음(출처 모호)`);
      row.sim = 1;
    } else if (s.kind === 'adapted') {
      if (normWs(src.plain).includes(text)) fail(`#${s.idx} adapted 가 응답에 그대로 있음`);
      let best = 0; let bestS = '';
      for (const x of src.sentences) { const v = containment(s.text, x); if (v > best) { best = v; bestS = x; } }
      row.sim = +best.toFixed(2);
      row.src = bestS.slice(0, 40);
      if (best < 0.4 || best > 0.92) fail(`#${s.idx} adapted 유사도 ${best.toFixed(2)} (0.40~0.92 밖)`);
    } else if (s.kind === 'original') {
      let best = 0; let bestId = '';
      for (const x of allRespSentences) { const v = containment(s.text, x.s); if (v > best) { best = v; bestId = x.turn; } }
      let pbest = 0;
      for (const p of prompts) pbest = Math.max(pbest, containment(s.text, p.p));
      row.sim = +best.toFixed(2);
      row.promptSim = +pbest.toFixed(2);
      row.nearest = bestId;
      const trapped = s.traps.length > 0;
      const limit = trapped ? 0.55 : 0.4;
      // 아주 짧은 문장은 비교 단위(gram)가 몇 개 안 되어 유사도가 의미 없으므로 한도를 적용하지 않는다(통째 포함 여부만 본다).
      if (grams(s.text).size >= 6 && best >= limit) fail(`#${s.idx} original 인데 응답과 유사도 ${best.toFixed(2)} (한도 ${limit})`);
      if (allResp.some((t) => normWs(t.plain).includes(text))) fail(`#${s.idx} original 문장이 응답에 그대로 있음`);
      if (prompts.some((p) => p.p.includes(text))) fail(`#${s.idx} original 문장이 프롬프트에 있음`);
      if (pbest >= 0.7) fail(`#${s.idx} original 인데 프롬프트와 유사도 ${pbest.toFixed(2)}`);
    } else if (s.kind === 'studentOrigin') {
      if (!s.draft) { fail(`#${s.idx} studentOrigin 에 draft 없음`); continue; }
      if (!normWs(src.prompt).includes(normWs(s.draft))) fail(`#${s.idx} draft 가 ${s.from} 프롬프트에 없음`);
      const toDraft = dice(s.text, s.draft);
      let toAi = 0;
      for (const x of src.sentences) toAi = Math.max(toAi, dice(s.text, x));
      row.sim = +toDraft.toFixed(2);
      row.aiSim = +toAi.toFixed(2);
      if (toDraft < 0.8) fail(`#${s.idx} 본문이 초안과 ${toDraft.toFixed(2)} 로 너무 다름`);
      if (!(toDraft > toAi)) fail(`#${s.idx} 본문이 초안(${toDraft.toFixed(2)})보다 AI 수정문(${toAi.toFixed(2)})에 가까움`);
    } else {
      fail(`#${s.idx} 알 수 없는 kind ${s.kind}`);
    }
    rows.push(row);
  }

  // 사다리: 칸 수가 충분하고 단계마다 AI 칸이 늘어야 한다.
  const counts = c.chain.map((v) => v.aiCount);
  if (c.chain[0].slots < 8) fail(`사다리 칸이 ${c.chain[0].slots}개뿐`);
  for (let i = 1; i < counts.length; i++) if (!(counts[i] > counts[i - 1])) fail(`사다리 ${i}단계에서 AI 칸이 늘지 않음`);
  info.push(`사다리 칸 ${c.chain[0].slots}, AI 칸 ${counts.join('/')}`);

  return { errors, info, rows };
}

module.exports = { LEVELS, build, validateCase, stripMarkdown, splitSentences, containment, dice, grams };
