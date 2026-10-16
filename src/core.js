'use strict';
/**
 * core.js — 화면과 무관한 순수 로직 (브라우저/Node 공용)
 *  - 교수 정책 vs 사용 목적 점검
 *  - 비판적 검증 누락 점검
 *  - 통계
 *  - 해시 체인(사후 수정 탐지)
 */
(function (root) {
  const POLICY_LEVELS = [
    { level: 0, label: '사용 금지', desc: '이 과제에서는 생성형 AI를 사용할 수 없음' },
    { level: 1, label: '학습 보조만', desc: '맞춤법 교정, 개념 설명까지 허용' },
    { level: 2, label: '구상·피드백 허용', desc: '아이디어, 개요, 자료 요약, 초안 피드백까지 허용 (본문·코드 생성은 불가)' },
    { level: 3, label: '폭넓게 허용', desc: '초안·코드 생성까지 허용 (사용 내역 공개 필수)' },
  ];

  // minLevel: 이 목적을 쓰려면 교수 정책이 최소 이 단계여야 함
  // generates: AI가 결과물 내용 자체를 만들어 주는 목적인가 (검증이 특히 중요)
  const PURPOSES = [
    { id: 'grammar', label: '맞춤법·문법 교정', minLevel: 1, generates: false },
    { id: 'explain', label: '개념 설명·학습', minLevel: 1, generates: true },
    { id: 'brainstorm', label: '아이디어 구상', minLevel: 2, generates: true },
    { id: 'outline', label: '개요·구조 제안', minLevel: 2, generates: true },
    { id: 'summarize', label: '자료 요약', minLevel: 2, generates: true },
    { id: 'feedback', label: '초안 피드백', minLevel: 2, generates: true },
    { id: 'draft', label: '초안·문장 생성', minLevel: 3, generates: true },
    { id: 'code', label: '코드 작성·디버깅', minLevel: 3, generates: true },
  ];

  const DISPOSITIONS = [
    { id: 'asis', label: '그대로 반영' },
    { id: 'edited', label: '수정 후 반영' },
    { id: 'reference', label: '참고만 함' },
    { id: 'discarded', label: '폐기' },
  ];

  const VERIFICATIONS = [
    { id: 'fact', label: '사실 관계 확인' },
    { id: 'source', label: '출처 직접 확인' },
    { id: 'cross', label: '다른 자료와 교차 검증' },
    { id: 'logic', label: '논리·계산 직접 검토' },
  ];

  const byId = (list, id) => list.find((x) => x.id === id);

  /** 한 항목에 대한 점검 결과. severity: 'high' | 'warn' */
  function checkEntry(entry, policyLevel) {
    const flags = [];
    const purpose = byId(PURPOSES, entry.purpose);
    if (policyLevel === 0) {
      flags.push({ code: 'policy', severity: 'high', text: '이 과제는 AI 사용 금지 정책입니다. 교수님께 사전 허락을 받았는지 확인하세요.' });
    } else if (purpose && purpose.minLevel > policyLevel) {
      const need = byId(POLICY_LEVELS, purpose.minLevel) || POLICY_LEVELS[purpose.minLevel];
      flags.push({
        code: 'policy',
        severity: 'high',
        text: `'${purpose.label}'은(는) '${need.label}' 이상에서 허용되는 용도입니다. 현재 정책 범위를 넘습니다.`,
      });
    }
    const used = entry.disposition === 'asis' || entry.disposition === 'edited';
    const verified = (entry.verifications || []).length > 0;
    if (used && purpose && purpose.generates && !verified) {
      flags.push({ code: 'unverified', severity: 'warn', text: 'AI 답변을 결과물에 반영했지만 검증 기록이 없습니다.' });
    }
    if (entry.disposition === 'asis' && purpose && (purpose.id === 'draft' || purpose.id === 'code') && !(entry.myChange || '').trim()) {
      flags.push({ code: 'asis-no-contribution', severity: 'warn', text: '생성 결과를 그대로 썼습니다. 본인이 판단·기여한 부분을 적어 주세요.' });
    }
    if (entry.disposition === 'edited' && !(entry.myChange || '').trim()) {
      flags.push({ code: 'edited-no-detail', severity: 'warn', text: "'수정 후 반영'인데 무엇을 어떻게 고쳤는지 적혀 있지 않습니다." });
    }
    return flags;
  }

  function analyze(entries, policyLevel) {
    const perEntry = entries.map((e) => checkEntry(e, policyLevel));
    const tools = [...new Set(entries.map((e) => (e.tool || '').trim()).filter(Boolean))];
    const count = (key, id) => entries.filter((e) => e[key] === id).length;
    const byPurpose = PURPOSES.map((p) => ({ ...p, n: count('purpose', p.id) })).filter((p) => p.n > 0);
    const byDisposition = DISPOSITIONS.map((d) => ({ ...d, n: count('disposition', d.id) }));
    const reflected = entries.filter((e) => e.disposition === 'asis' || e.disposition === 'edited');
    const verifiedReflected = reflected.filter((e) => (e.verifications || []).length > 0);
    const flatFlags = perEntry.flat();
    return {
      total: entries.length,
      tools,
      byPurpose,
      byDisposition,
      reflectedCount: reflected.length,
      verifiedRate: reflected.length ? verifiedReflected.length / reflected.length : null,
      editedRate: reflected.length ? reflected.filter((e) => e.disposition === 'edited').length / reflected.length : null,
      discardedCount: count('disposition', 'discarded'),
      perEntry,
      highFlags: flatFlags.filter((f) => f.severity === 'high').length,
      warnFlags: flatFlags.filter((f) => f.severity === 'warn').length,
    };
  }

  // ---------- 해시 체인 ----------
  const ZERO = '0'.repeat(64);

  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await root.crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function canonicalEntry(e) {
    return JSON.stringify([
      e.id, e.date, e.tool, e.purpose, e.prompt, e.response, e.disposition,
      [...(e.verifications || [])].sort(), e.myChange || '',
    ]);
  }

  async function sealChain(entries) {
    let prev = ZERO;
    const out = [];
    for (const e of entries) {
      const hash = await sha256(prev + canonicalEntry(e));
      out.push({ ...e, prev, hash });
      prev = hash;
    }
    return out;
  }

  async function verifyChain(entries) {
    let prev = ZERO;
    for (let i = 0; i < entries.length; i++) {
      const h = await sha256(prev + canonicalEntry(entries[i]));
      if (entries[i].prev !== prev || entries[i].hash !== h) return { ok: false, brokenAt: i };
      prev = h;
    }
    return { ok: true, head: prev };
  }

  /** 표지 정보·성찰까지 묶은 문서 해시. 내역서 하단의 확인 코드로 쓴다. */
  async function documentHash(meta, entries, reflection) {
    const head = entries.length ? entries[entries.length - 1].hash : ZERO;
    const m = [meta.student, meta.studentId, meta.course, meta.professor, meta.assignment, meta.policyLevel, meta.policyNote || ''];
    return sha256(head + JSON.stringify([m, reflection || '']));
  }

  function formatCode(hash) {
    return hash.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  }

  function newId() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  const api = {
    POLICY_LEVELS, PURPOSES, DISPOSITIONS, VERIFICATIONS,
    byId, checkEntry, analyze, sha256, canonicalEntry, sealChain, verifyChain, documentHash, formatCode, newId,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : globalThis);
