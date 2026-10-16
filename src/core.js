'use strict';
/**
 * core.js — 문서 구조, 확인 코드, 제출본 검증 (브라우저/Node 공용)
 * 분석 로직은 analyze.js, 대화 파싱은 parse.js. 계약은 docs/spec-v2.md 참조.
 */
(function (root) {
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await root.crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function newId() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function blankDoc() {
    return {
      version: 2,
      meta: { student: '', studentId: '', course: '', professor: '', assignment: '', assignmentBrief: '' },
      submission: { text: '' },
      conversations: [],
      deletions: [],
      reflection: '',
      claimed: null,
      code: null,
    };
  }

  const round4 = (n) => Math.round(n * 1e4) / 1e4;

  /** 확인 코드에 들어가는 내용의 정규형. claimed/code 자신은 제외하고 claimed 값은 포함한다. */
  function canonical(doc) {
    const m = doc.meta;
    return JSON.stringify([
      doc.version,
      [m.student, m.studentId, m.course, m.professor, m.assignment, m.assignmentBrief || ''],
      doc.submission.text,
      doc.conversations.map((c) => [c.id, c.provider, c.url, c.parsed, c.turns.map((t) => [t.id, t.prompt, t.response])]),
      (doc.deletions || []).map((d) => [d.turnId, d.convId, round4(d.relevance), d.chars]),
      doc.reflection || '',
      doc.claimed ? [round4(doc.claimed.dependency), round4(doc.claimed.autonomy), Object.keys(doc.claimed.relevance).sort().map((k) => [k, round4(doc.claimed.relevance[k])])] : null,
    ]);
  }

  function formatCode(hash) {
    return hash.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  }

  async function documentCode(doc) {
    return formatCode(await sha256(canonical(doc)));
  }

  /** 제출 직전: 분석 결과를 claimed에 담고 확인 코드를 붙인 사본을 만든다. */
  async function seal(doc, analyze) {
    const r = analyze.run(doc);
    const relevance = {};
    r.turns.forEach((t) => { relevance[t.id] = round4(t.relevance); });
    const claimed = { dependency: round4(r.summary.dependency), autonomy: round4(r.summary.autonomy), relevance };
    const sealed = { ...doc, claimed, code: null };
    sealed.code = await documentCode(sealed);
    return sealed;
  }

  /**
   * 교수용 검증. 두 가지를 본다.
   *  1) codeOk  — 파일 내용이 확인 코드와 일치하는가 (제출 후 내용이 바뀌지 않았는가)
   *  2) claimOk — 파일에 적힌 점수가 본문·대화로 다시 계산한 값과 같은가
   * 서명이 아니므로, 코드까지 새로 계산해 맞춘 위조는 막지 못한다. PDF에 인쇄된 코드와 대조해야 의미가 있다.
   */
  async function verifyDoc(doc, analyze) {
    const problems = [];
    if (!doc || doc.version !== 2 || !doc.meta || !doc.submission || !Array.isArray(doc.conversations)) {
      return { ok: false, codeOk: false, claimOk: false, code: null, problems: ['지원하지 않는 파일 형식입니다.'] };
    }
    const code = await documentCode(doc);
    const codeOk = !!doc.code && code === doc.code;
    if (!doc.code) problems.push('확인 코드가 없는 파일입니다.');
    else if (!codeOk) problems.push('파일 내용이 확인 코드와 일치하지 않습니다. 제출 후 수정되었을 수 있습니다.');

    let claimOk = false;
    if (!doc.claimed) {
      problems.push('분석 결과(claimed)가 없는 파일입니다.');
    } else {
      const r = analyze.run(doc);
      const same = Math.abs(round4(r.summary.dependency) - doc.claimed.dependency) < 1e-3
        && r.turns.every((t) => Math.abs(round4(t.relevance) - (doc.claimed.relevance[t.id] ?? -1)) < 1e-3)
        && Object.keys(doc.claimed.relevance).length === r.turns.length;
      claimOk = same;
      if (!same) problems.push('파일에 적힌 점수가 본문·대화로 다시 계산한 값과 다릅니다.');
    }
    return { ok: codeOk && claimOk, codeOk, claimOk, code, problems };
  }

  const api = { sha256, newId, blankDoc, canonical, formatCode, documentCode, seal, verifyDoc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : globalThis);
