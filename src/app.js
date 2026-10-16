'use strict';
const { POLICY_LEVELS, PURPOSES, DISPOSITIONS, VERIFICATIONS, byId, analyze, checkEntry, sealChain, verifyChain, documentHash, formatCode, newId } = Core;

const KEY = 'ai-usage-ledger.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v === null ? '해당 없음' : `${Math.round(v * 100)}%`);
const today = () => new Date().toISOString().slice(0, 10);

const blank = () => ({
  meta: { student: '', studentId: '', course: '', professor: '', assignment: '', policyLevel: 2, policyNote: '' },
  entries: [],
  reflection: '',
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...blank(), ...s, meta: { ...blank().meta, ...(s.meta || {}) } };
    }
  } catch { /* 저장소를 쓸 수 없는 환경이면 메모리에서만 동작 */ }
  return blank();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/** 항목이 바뀔 때마다 체인을 다시 봉인한다. */
async function commit() {
  state.entries = await sealChain(state.entries);
  save();
  renderLog();
  renderReport();
}

// ---------------------------------------------------------------- 탭
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== `tab-${name}`; });
  if (name === 'report') renderReport();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------------------------------------------------------------- ① 과제·정책
function initSetup() {
  document.querySelectorAll('[data-meta]').forEach((el) => {
    el.value = state.meta[el.dataset.meta] ?? '';
    el.addEventListener('input', () => { state.meta[el.dataset.meta] = el.value; save(); renderLog(); });
  });
  $('#policyBox').innerHTML = POLICY_LEVELS.map((p) => `
    <label><input type="radio" name="policy" value="${p.level}" ${state.meta.policyLevel === p.level ? 'checked' : ''}>
    <span>${esc(p.label)}<small>${esc(p.desc)}</small></span></label>`).join('');
  $('#policyBox').addEventListener('change', (e) => {
    state.meta.policyLevel = Number(e.target.value);
    save(); renderLog(); updateLiveFlags();
  });
}

// ---------------------------------------------------------------- ② 사용 기록
function initForm() {
  const f = $('#entryForm');
  f.purpose.innerHTML = PURPOSES.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  $('#dispBox').innerHTML = DISPOSITIONS.map((d, i) => `<label><input type="radio" name="disposition" value="${d.id}" ${i === 1 ? 'checked' : ''}>${esc(d.label)}</label>`).join('');
  $('#verBox').innerHTML = VERIFICATIONS.map((v) => `<label><input type="checkbox" name="ver" value="${v.id}">${esc(v.label)}</label>`).join('');
  f.date.value = today();
  f.addEventListener('input', updateLiveFlags);
  f.addEventListener('change', updateLiveFlags);
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = readForm();
    state.entries.push({ id: newId(), ...e });
    await commit();
    f.prompt.value = ''; f.response.value = ''; f.myChange.value = '';
    f.querySelectorAll('input[name=ver]').forEach((c) => { c.checked = false; });
    updateLiveFlags();
  });
}
function readForm() {
  const f = $('#entryForm');
  return {
    date: f.date.value, tool: f.tool.value.trim(), purpose: f.purpose.value,
    prompt: f.prompt.value.trim(), response: f.response.value.trim(),
    disposition: f.disposition.value,
    verifications: [...f.querySelectorAll('input[name=ver]:checked')].map((c) => c.value),
    myChange: f.myChange.value.trim(),
  };
}
function flagHtml(flags) {
  return flags.map((fl) => `<div class="flag ${fl.severity}">${fl.severity === 'high' ? '⚠ 정책 확인' : '△ 보완 권장'} · ${esc(fl.text)}</div>`).join('');
}
function updateLiveFlags() {
  const flags = checkEntry(readForm(), state.meta.policyLevel);
  $('#liveFlags').innerHTML = flags.length ? flagHtml(flags) : '<div class="flag ok">✓ 현재 입력은 정책 범위 안이고 검증·기여 기록이 갖춰져 있습니다.</div>';
}
function renderLog() {
  const list = $('#entryList');
  $('#entryCount').textContent = state.entries.length ? `${state.entries.length}건` : '';
  if (!state.entries.length) { list.innerHTML = '<p class="empty">아직 기록이 없습니다. 위 양식으로 첫 기록을 추가하거나, 상단의 “예시 데이터 불러오기”를 눌러 보세요.</p>'; return; }
  list.innerHTML = state.entries.map((e, i) => {
    const flags = checkEntry(e, state.meta.policyLevel);
    return `<div class="entry">
      <header><div><b>#${i + 1}</b> ${esc(e.date)} <span class="tag">${esc(e.tool)}</span><span class="tag">${esc(byId(PURPOSES, e.purpose)?.label)}</span><span class="tag">${esc(byId(DISPOSITIONS, e.disposition)?.label)}</span></div>
      <button class="danger" data-del="${esc(e.id)}" type="button">삭제</button></header>
      <dl><dt>프롬프트</dt><dd>${esc(e.prompt)}</dd><dt>AI 답변 요약</dt><dd>${esc(e.response)}</dd>
      <dt>검증</dt><dd>${e.verifications.length ? e.verifications.map((v) => esc(byId(VERIFICATIONS, v)?.label)).join(', ') : '없음'}</dd>
      ${e.myChange ? `<dt>내가 직접 고치거나 판단한 부분</dt><dd>${esc(e.myChange)}</dd>` : ''}</dl>
      ${flags.length ? `<div class="flags">${flagHtml(flags)}</div>` : ''}</div>`;
  }).join('');
}
$('#entryList').addEventListener('click', async (ev) => {
  const id = ev.target.dataset?.del;
  if (!id) return;
  if (!confirm('이 기록을 삭제할까요? 삭제하면 이후 기록의 확인 코드가 모두 다시 계산됩니다.')) return;
  state.entries = state.entries.filter((e) => e.id !== id);
  await commit();
});

// ---------------------------------------------------------------- ③ 내역서
/** doc = { meta, entries, reflection } → 내역서 HTML (학생 화면·교수 검증 화면 공용) */
async function buildReport(doc, integrity) {
  const { meta, entries, reflection } = doc;
  const policy = POLICY_LEVELS[meta.policyLevel] || POLICY_LEVELS[2];
  const a = analyze(entries, meta.policyLevel);
  const max = Math.max(1, ...a.byPurpose.map((p) => p.n));
  const code = integrity?.code ?? formatCode(await documentHash(meta, entries, reflection));

  const flagRows = [];
  a.perEntry.forEach((fl, i) => fl.forEach((f) => flagRows.push(`<div class="rflag ${f.severity}">#${i + 1} · ${f.severity === 'high' ? '정책 확인 필요' : '보완 권장'} — ${esc(f.text)}</div>`)));

  return `
  <h1>생성형 AI 사용 내역서</h1>
  <p class="sub">${esc(meta.course) || '과목명 미입력'} · ${esc(meta.assignment) || '과제명 미입력'}</p>
  <table>
    <tr><th>제출자</th><td>${esc(meta.student)} (${esc(meta.studentId)})</td><th>담당 교수</th><td>${esc(meta.professor)}</td></tr>
    <tr><th>적용 정책</th><td colspan="3">${esc(policy.label)} — ${esc(policy.desc)}${meta.policyNote ? `<br><small>${esc(meta.policyNote)}</small>` : ''}</td></tr>
  </table>

  <h3>1. 사용 요약</h3>
  <div class="stats">
    <div class="stat"><b>${a.total}</b>사용 기록(건)</div>
    <div class="stat"><b>${a.tools.length}</b>사용 도구<br><small>${esc(a.tools.join(', ')) || '-'}</small></div>
    <div class="stat"><b>${pct(a.verifiedRate)}</b>반영 건 중 검증 비율</div>
    <div class="stat"><b>${pct(a.editedRate)}</b>반영 건 중 직접 수정 비율</div>
  </div>
  <h3>2. 용도별 사용</h3>
  ${a.byPurpose.map((p) => `<div class="bar"><span class="l">${esc(p.label)}</span><i style="width:${(p.n / max) * 220}px"></i> ${p.n}건</div>`).join('') || '<p>기록 없음</p>'}
  <p style="margin-top:8px">결과물 반영 방식: ${a.byDisposition.map((d) => `${esc(d.label)} ${d.n}건`).join(' · ')}</p>

  <h3>3. 자동 점검 결과</h3>
  ${flagRows.length ? flagRows.join('') : '<div class="rflag ok">정책 범위 이탈이나 검증 누락으로 표시된 항목이 없습니다.</div>'}

  <h3>4. 상세 사용 기록</h3>
  ${entries.map((e, i) => `<div class="item"><b>#${i + 1}</b> ${esc(e.date)} · ${esc(e.tool)} · ${esc(byId(PURPOSES, e.purpose)?.label)} · <b>${esc(byId(DISPOSITIONS, e.disposition)?.label)}</b>
    <dl><dt>프롬프트</dt><dd>${esc(e.prompt)}</dd><dt>AI 답변 요약</dt><dd>${esc(e.response)}</dd>
    <dt>직접 검증</dt><dd>${e.verifications.length ? e.verifications.map((v) => esc(byId(VERIFICATIONS, v)?.label)).join(', ') : '없음'}</dd>
    ${e.myChange ? `<dt>본인이 고치거나 판단한 부분</dt><dd>${esc(e.myChange)}</dd>` : ''}</dl></div>`).join('') || '<p>기록 없음</p>'}

  <h3>5. 학생 성찰</h3>
  <p style="white-space:pre-wrap">${esc(reflection) || '(작성하지 않음)'}</p>

  <p style="margin-top:16px">위 내용은 사실과 다르지 않음을 확인합니다.</p>
  <div class="sign"><div>제출일: ${esc(today())}</div><div>학생 ${esc(meta.student)} (서명)</div></div>
  <div class="seal">문서 확인 코드: <code>${esc(code)}</code><br>
  교수님은 학생이 함께 제출한 .json 파일을 이 서비스의 ‘④ 교수용 검증’에 올려 이 코드와 일치하는지, 기록이 사후에 바뀌지 않았는지 확인할 수 있습니다.</div>`;
}
async function renderReport() {
  $('#report').innerHTML = await buildReport(state);
}
function initReport() {
  $('#reflection').value = state.reflection;
  $('#reflection').addEventListener('input', (e) => { state.reflection = e.target.value; save(); renderReport(); });
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnExport').addEventListener('click', async () => {
    const doc = { version: 1, meta: state.meta, entries: state.entries, reflection: state.reflection, code: formatCode(await documentHash(state.meta, state.entries, state.reflection)) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `AI사용내역_${state.meta.studentId || 'draft'}.json` });
    a.click(); URL.revokeObjectURL(url);
  });
}

// ---------------------------------------------------------------- ④ 교수용 검증
$('#verifyFile').addEventListener('change', async (ev) => {
  const out = $('#verifyResult');
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const doc = JSON.parse(await file.text());
    if (!doc.meta || !Array.isArray(doc.entries)) throw new Error('형식이 올바르지 않습니다');
    const chain = await verifyChain(doc.entries);
    const recomputed = formatCode(await documentHash(doc.meta, doc.entries, doc.reflection));
    const codeOk = chain.ok && recomputed === doc.code;
    const verdict = codeOk
      ? `<div class="flag ok">✓ 기록이 작성 이후 바뀌지 않았습니다. 확인 코드 ${esc(recomputed)}</div>`
      : `<div class="flag high">⚠ 변조가 의심됩니다. ${chain.ok ? '표지 정보 또는 성찰 내용이 파일의 확인 코드와 다릅니다.' : `${chain.brokenAt + 1}번째 기록부터 해시가 맞지 않습니다.`}</div>`;
    out.innerHTML = `${verdict}<article class="report">${await buildReport(doc, { code: recomputed })}</article>`;
  } catch (e) {
    out.innerHTML = `<div class="flag high">파일을 읽을 수 없습니다: ${esc(e.message)}</div>`;
  }
});

// ---------------------------------------------------------------- 예시 데이터
$('#btnDemo').addEventListener('click', async () => {
  if (state.entries.length && !confirm('현재 입력한 내용이 예시 데이터로 대체됩니다. 계속할까요?')) return;
  state = {
    meta: { student: '홍길동(예시)', studentId: '60250000', course: '교양 글쓰기 (예시)', professor: '김교수 (예시)', assignment: '청년 주거 문제에 관한 논증문', policyLevel: 2, policyNote: '아이디어·개요·피드백은 허용, 본문 생성은 금지. 사용 내역 첨부 필수.' },
    entries: [
      { id: newId(), date: '2026-10-05', tool: 'Claude', purpose: 'brainstorm', prompt: '청년 주거 문제를 다룰 논증문 주제를 5개 제안해 줘. 서로 다른 관점으로.', response: '월세 부담, 공공임대 공급, 지방 이주 유인 등 5개 주제를 제안함.', disposition: 'edited', verifications: ['fact'], myChange: '5개 중 월세 부담 주제를 골라 “서울 자취 대학생”으로 범위를 좁힘.' },
      { id: newId(), date: '2026-10-07', tool: 'Gemini', purpose: 'summarize', prompt: '아래 통계청 보도자료 핵심을 5줄로 요약해 줘. (보도자료 붙여넣음)', response: '청년 1인가구 월세 비중이 증가했다는 내용을 요약함.', disposition: 'edited', verifications: ['source', 'cross'], myChange: '요약의 “증가율 12%”가 원문에 없어 삭제하고 원문 표 3의 수치로 교체.' },
      { id: newId(), date: '2026-10-09', tool: 'Claude', purpose: 'outline', prompt: '내 주제와 주장으로 논증문 개요를 서론-본론-결론으로 짜 줘.', response: '본론 3단락(원인-영향-대안) 개요를 제안함.', disposition: 'edited', verifications: ['logic'], myChange: '“영향” 단락을 근거 부족으로 빼고 인터뷰 사례 단락으로 대체.' },
      { id: newId(), date: '2026-10-12', tool: 'ChatGPT', purpose: 'grammar', prompt: '이 문단의 맞춤법과 띄어쓰기만 고쳐 줘. 내용은 바꾸지 마.', response: '띄어쓰기 6곳, 조사 2곳 수정.', disposition: 'asis', verifications: [], myChange: '' },
      { id: newId(), date: '2026-10-13', tool: 'Claude', purpose: 'draft', prompt: '결론 문단을 대신 써 줘.', response: '결론 초안을 제시했으나 내 주장과 어긋나 사용하지 않음.', disposition: 'discarded', verifications: [], myChange: '직접 결론을 작성함.' },
    ],
    reflection: '개요를 잡을 때 AI가 큰 도움이 됐지만, 요약 과정에서 원문에 없는 수치를 만들어 낸 것을 확인하고 이후에는 숫자를 반드시 원문과 대조했다. 결론은 AI 초안이 내 주장과 달라 직접 썼다.',
  };
  document.querySelectorAll('[data-meta]').forEach((el) => { el.value = state.meta[el.dataset.meta] ?? ''; });
  document.querySelector(`input[name=policy][value="${state.meta.policyLevel}"]`).checked = true;
  $('#reflection').value = state.reflection;
  await commit();
  updateLiveFlags();
});

// ---------------------------------------------------------------- 시작
initSetup(); initForm(); initReport();
sealChain(state.entries).then((s) => { state.entries = s; renderLog(); updateLiveFlags(); renderReport(); });
