'use strict';
/**
 * app.js — 화면 (v2: PDF 첨부 흐름). 사용자 입력(파일명·본문·대화)은 모두 textContent 로만 넣는다.
 * 계약은 docs/spec-v2.md. 분석 결과는 저장하지 않고 항상 Analyze.run(doc)으로 다시 계산한다.
 */
(function () {
  const LOGO = 'assets/mju-logo.png';
  const KEY = 'mju-ai-statement.v2';
  const STEPS = ['인적사항·과목', '자료 첨부', '분석 결과', '제출'];
  const PROVIDERS = [['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini'], ['other', '기타·모름']];
  const PROVIDER_LABEL = Object.fromEntries(PROVIDERS);
  const BAND_LABEL = { low: '낮음', mid: '중간', high: '높음' };
  const REL_LABEL = { high: '연관도 높음', mid: '연관도 보통', low: '연관도 낮음' };
  const KIND = {
    verbatim: { label: '그대로 반영', tag: '그대로', desc: 'AI 답변과 거의 같은 문장' },
    adapted: { label: '수정 반영', tag: '수정', desc: 'AI 답변을 고쳐 쓴 흔적이 있는 문장' },
    studentOrigin: { label: '학생 원문 교정', tag: '교정', desc: '학생이 AI에 보낸 자기 글과 가까운 문장' },
    original: { label: '직접 작성', tag: '직접', desc: '겹치는 AI 답변이 확인되지 않은 문장' },
  };
  const KIND_ORDER = ['verbatim', 'adapted', 'studentOrigin', 'original'];
  const UNPARSED_WARN = '대화 속 \'내 질문\'과 \'AI 답변\'을 구분하지 못했습니다. 이 경우 AI 의존도가 실제보다 높게 나올 수 있습니다(상한 추정).';

  const $ = (s, r = document) => r.querySelector(s);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const live = (msg) => { const el = $('#live'); el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 30); };

  /** DOM 생성 도우미. 문자열 자식은 항상 텍스트 노드가 된다. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'value') value = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    if (value !== undefined) el.value = value;
    return el;
  }

  /** replaceChildren 은 배열·null 을 글자로 바꿔 버리므로 h()와 같은 규칙으로 채운다. */
  function fill(el, ...kids) { el.replaceChildren(h('div', { class: 'fill' }, ...kids)); el.replaceChildren(...el.firstChild.childNodes); }

  // ------------------------------------------------------------ 상태
  const blankUi = () => ({ pages: {}, guessed: {}, notes: {}, noAi: false, assignFile: null, pasteCount: 0 });
  let S = { doc: Core.blankDoc(), step: 1, ui: blankUi() };
  const T = { busy: [], errors: [], assignMsg: null, assignBusy: null, confirmDel: null, refusal: {}, valErrs: null, rev: 0, cache: null, tab: 'student', deleteNote: '' };

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && s.doc && s.doc.version === 2 && Array.isArray(s.doc.conversations) && s.doc.meta && s.doc.submission) {
        S = { doc: { ...Core.blankDoc(), ...s.doc, meta: { ...Core.blankDoc().meta, ...s.doc.meta } }, step: Math.min(4, Math.max(1, Number(s.step) || 1)), ui: { ...blankUi(), ...(s.ui || {}) } };
      }
    } catch (e) { /* 저장소를 쓸 수 없으면 메모리로만 동작 */ }
    // 이어 하기: 필수 입력이 모자라면 갈 수 있는 곳까지만
    for (let k = 1; k < S.step; k++) if (validate(k).length) { S.step = k; break; }
  }
  function save() {
    T.rev++;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 메모리로만 동작 */ }
  }
  function result() {
    if (!T.cache || T.cache.rev !== T.rev) T.cache = { rev: T.rev, r: Analyze.run(S.doc) };
    return T.cache.r;
  }
  const hasUnparsed = (doc) => doc.conversations.some((c) => c.parsed === 'unparsed' && c.turns.length);
  const convName = (c, i) => c.source || `붙여넣은 대화 ${i + 1}`;

  // ------------------------------------------------------------ 검증
  function validate(step) {
    const d = S.doc, m = d.meta, errs = [];
    if (step === 1) {
      [['student', '이름'], ['studentId', '학번'], ['course', '과목명'], ['assignment', '과제명']].forEach(([k, l]) => {
        if (!m[k].trim()) errs.push({ msg: `${l}을(를) 입력해 주세요.`, sel: `#f-${k}` });
      });
    } else if (step === 2) {
      if (d.submission.text.trim().length < 20) errs.push({ msg: '과제 결과물을 올리거나 붙여넣어 주세요(20자 이상).', sel: '#submissionText' });
      if (!d.conversations.some((c) => c.turns.length) && !S.ui.noAi && !d.deletions.length) errs.push({ msg: 'AI 대화 PDF를 올려 주세요. AI 대화가 없다면 "AI 대화가 없습니다"에 체크해 주세요.', sel: '#convFile' });
    }
    return errs;
  }
  function showErrs(errs) {
    T.valErrs = errs;
    renderStage();
    const first = errs[0] && $(errs[0].sel);
    if (first) first.focus();
    live(errs.map((e) => e.msg).join(' '));
  }
  function goTo(n) {
    T.valErrs = null;
    if (n > S.step) {
      for (let k = S.step; k < n; k++) {
        const e = validate(k);
        if (e.length) { S.step = k; save(); showErrs(e); return; }
      }
    }
    S.step = n; save();
    renderStage(true);
  }

  // ------------------------------------------------------------ 확인 막대(window.confirm 은 iframe 샌드박스에서 막힘)
  function askConfirm(text, yesLabel, onYes) {
    const bar = $('#confirmBar');
    const close = () => bar.replaceChildren();
    const no = h('button', { type: 'button', onclick: close }, '취소');
    bar.replaceChildren(h('div', { class: 'inner', role: 'alertdialog', 'aria-label': '확인' },
      h('span', null, text),
      h('button', { type: 'button', class: 'primary', onclick: () => { close(); onYes(); } }, yesLabel), no));
    no.focus();
  }

  // ------------------------------------------------------------ 단계 표시
  function renderStepper() {
    $('#stepper').replaceChildren(h('ol', { class: 'stepper' }, STEPS.map((l, i) => {
      const n = i + 1;
      const cls = n < S.step ? 'done' : n === S.step ? 'current' : '';
      return h('li', { class: cls }, h('button', { type: 'button', 'aria-current': n === S.step ? 'step' : null, onclick: () => { if (n !== S.step) goTo(n); } },
        h('span', { class: 'num' }, n < S.step ? '✓' : String(n)), h('span', null, l)));
    })));
  }

  function renderStage(moveFocus) {
    const fn = [null, step1, step2, step3, step4][S.step];
    const wrap = h('div', null, fn());
    $('#stage').replaceChildren(wrap);
    if (S.step === 2) { renderAssign(); renderConvs(); }
    renderStepper();
    if (moveFocus) {
      const hd = $('#stage h2');
      if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus(); }
      live(`${S.step}단계: ${STEPS[S.step - 1]}`);
      window.scrollTo(0, 0);
    }
  }

  function stepNav(prev, next, nextLabel) {
    return h('div', { class: 'step-nav no-print' },
      prev ? h('button', { type: 'button', id: 'btnPrev', onclick: () => goTo(S.step - 1) }, '← 이전') : h('span'),
      next ? h('button', { type: 'button', id: 'btnNext', class: 'primary', onclick: () => goTo(S.step + 1) }, nextLabel || '다음 →') : h('span'));
  }
  function valBox() {
    const e = T.valErrs;
    if (!e || !e.length) return h('div', { class: 'val-msg', hidden: true, role: 'alert' });
    return h('div', { class: 'val-msg', role: 'alert' }, '다음 단계로 가기 전에 확인해 주세요.', h('ul', null, e.map((x) => h('li', null, x.msg))));
  }

  // ------------------------------------------------------------ 1단계
  function step1() {
    const m = S.doc.meta;
    const inv = new Set((T.valErrs || []).map((e) => e.sel));
    const field = (key, label, o = {}) => {
      const attrs = { id: `f-${key}`, autocomplete: 'off', value: m[key], 'aria-required': o.req ? 'true' : null, 'aria-invalid': inv.has(`#f-${key}`) ? 'true' : null,
        oninput: (e) => { m[key] = e.target.value; e.target.removeAttribute('aria-invalid'); save(); } };
      const input = o.area ? h('textarea', { ...attrs, rows: 3, placeholder: o.ph }) : h('input', attrs);
      return h('label', { class: o.span ? 'span2' : null }, label, o.req ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null, input);
    };
    return [
      h('h2', null, '1. 인적사항·과목'),
      h('p', { class: 'hint' }, '별표(*)는 꼭 입력해야 합니다.'),
      h('div', { class: 'grid2' },
        field('student', '이름', { req: true }), field('studentId', '학번', { req: true }),
        field('course', '과목명', { req: true }), field('professor', '담당 교수'),
        field('assignment', '과제명', { req: true, span: true }),
        field('assignmentBrief', '과제 안내문 (선택)', { area: true, span: true, ph: '교수님이 주신 과제 안내를 붙여넣으면, 대화가 과제와 관련 있는지 더 정확히 판단합니다.' })),
      valBox(), stepNav(false, true),
    ];
  }

  // ------------------------------------------------------------ 2단계
  function dropZone(o) {
    const input = h('input', { type: 'file', id: o.id, class: 'sr-only', accept: o.accept, multiple: o.multiple, disabled: o.locked,
      onchange: (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) o.onFiles(fs); } });
    const zone = h('label', { class: `dropzone${o.locked ? ' locked' : ''}`, for: o.id },
      h('div', null, o.text), h('span', { class: 'pick' }, o.pick), input);
    if (!o.locked) {
      ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
      zone.addEventListener('drop', (e) => { e.preventDefault(); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) o.onFiles(fs); });
    }
    return zone;
  }

  const locked = () => S.doc.deletions.length > 0;

  function step2() {
    return [
      h('h2', null, '2. 자료 첨부'),
      h('div', { class: 'attach-grid' }, h('div', { class: 'attach-box', id: 'assignBox' }), h('div', { class: 'attach-box', id: 'convBox' })),
      valBox(), stepNav(true, true),
    ];
  }

  function renderAssign() {
    const box = $('#assignBox');
    if (!box) return;
    const af = S.ui.assignFile;
    const ta = h('textarea', { id: 'submissionText', rows: 8, disabled: locked(), value: S.doc.submission.text, placeholder: '파일 대신 여기에 과제 본문을 붙여넣어도 됩니다.',
      oninput: (e) => { S.doc.submission.text = e.target.value; S.ui.assignFile = S.ui.assignFile && { ...S.ui.assignFile, edited: true }; e.target.removeAttribute('aria-invalid'); save(); count.textContent = `${e.target.value.length.toLocaleString()}자`; } });
    const count = h('span', { class: 'count' }, `${S.doc.submission.text.length.toLocaleString()}자`);
    fill(box,
      h('h3', null, 'A. 과제 결과물 ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
      dropZone({ id: 'assignFile', accept: '.pdf,.hwp,.hwpx,.docx,.doc,.txt,.md,application/pdf,text/plain,text/markdown', multiple: false, locked: locked(), onFiles: (fs) => addAssignment(fs[0]),
        text: 'PDF, 한글(.hwp·.hwpx), 워드(.docx), .txt 파일을 끌어다 놓으세요', pick: '파일 선택' }),
      T.assignBusy ? h('div', { class: 'job' }, T.assignBusy) : null,
      T.assignMsg ? h('div', { class: `job${T.assignMsg.err ? ' err' : ''}`, role: T.assignMsg.err ? 'alert' : 'status' }, T.assignMsg.text) : null,
      af ? h('p', { class: 'hint' }, `불러온 파일: ${af.name}${af.pages ? ` · ${af.pages}쪽` : ''}${af.fmt ? ` · ${{ docx: '워드', hwp: '한글', hwpx: '한글(hwpx)' }[af.fmt] || af.fmt} 문서` : ''}${af.edited ? ' (이후 직접 수정함)' : ''}`) : null,
      locked() ? h('div', { class: 'notice warn' }, '삭제 기록이 있어 과제 본문은 바꿀 수 없습니다. 바꾸려면 "처음부터 다시"를 눌러 주세요.') : null,
      h('label', null, '과제 본문 (붙여넣기·수정 가능) ', count, ta));
  }

  async function addAssignment(file) {
    if (locked()) return;
    const name = file.name, low = name.toLowerCase();
    T.assignMsg = null;
    try {
      let text, pages = 0, fmt = '';
      if (/\.(txt|md)$/.test(low) || file.type.startsWith('text/')) {
        T.assignBusy = `${name} 읽는 중…`; renderAssign();
        text = await file.text();
        if (text.includes('�')) T.assignMsg = { text: '글자가 깨져 보이는 부분이 있습니다. 메모장 등에서 UTF-8로 다시 저장하거나 PDF로 올려 주세요.', err: false };
      } else if (/\.pdf$/.test(low) || file.type === 'application/pdf') {
        T.assignBusy = `${name} 읽는 중…`; renderAssign();
        const r = await Pdf.extract(await file.arrayBuffer(), { onProgress: (d, t) => { T.assignBusy = `${name} 읽는 중… (${d}/${t}쪽)`; renderAssign(); } });
        if (!r.ok) { T.assignBusy = null; T.assignMsg = { text: `${name}: ${r.notes.join(' ')}`, err: true }; renderAssign(); return; }
        text = r.text; pages = r.pageCount;
        if (r.notes.length) T.assignMsg = { text: r.notes.join(' '), err: false };
      } else if (/\.(docx|doc|hwp|hwpx)$/.test(low)) {
        T.assignBusy = `${name} 읽는 중…`; renderAssign();
        const r = await Docs.extract(await file.arrayBuffer(), name);
        if (!r.ok) { T.assignBusy = null; T.assignMsg = { text: `${name}: ${r.notes.join(' ')}`, err: true }; renderAssign(); return; }
        text = r.text; fmt = r.format;
        T.assignMsg = { text: `${r.text.length.toLocaleString()}자를 읽었습니다. 아래 본문 칸에서 빠진 부분이 없는지 확인해 주세요. 표·글상자 안의 글은 순서대로 이어서 읽고, 그림 속 글자는 읽지 못합니다.`, err: false };
      } else {
        T.assignMsg = { text: `${name}: 지원하지 않는 형식입니다. PDF, 한글(.hwp·.hwpx), 워드(.docx), .txt 파일을 올리거나 본문을 붙여넣어 주세요.`, err: true };
        renderAssign(); return;
      }
      S.doc.submission.text = text.replace(/\r\n?/g, '\n').trim();
      S.ui.assignFile = { name, pages, fmt };
      save();
      live(`${name} 불러옴`);
    } catch (e) {
      T.assignMsg = { text: `${name}: 파일을 읽지 못했습니다. 다른 형식으로 저장하거나 본문을 붙여넣어 주세요.`, err: true };
    }
    T.assignBusy = null;
    renderAssign();
  }

  function renderConvs() {
    const box = $('#convBox');
    if (!box) return;
    const d = S.doc;
    const items = d.conversations.map((c, i) => {
      const unp = c.parsed === 'unparsed';
      const guessed = S.ui.guessed[c.id];
      const sel = h('select', { 'aria-label': `${convName(c, i)} 서비스`, value: c.provider,
        onchange: (e) => { c.provider = e.target.value; S.ui.guessed[c.id] = false; save(); renderConvs(); } }, PROVIDERS.map(([v, l]) => h('option', { value: v }, l)));
      const pg = S.ui.pages[c.id];
      return h('div', { class: 'conv-item', 'data-conv': c.id },
        h('div', { class: 'name' }, convName(c, i)),
        h('div', { class: 'conv-meta' },
          h('span', null, '서비스 ', sel, ' ', guessed ? h('span', { class: 'badge info' }, '추정') : h('span', { class: 'badge' }, '직접 선택')),
          h('span', null, unp ? `묶음 ${c.turns.length}개` : `턴 ${c.turns.length}개`),
          pg ? h('span', null, `${pg}쪽`) : null,
          unp ? h('span', { class: 'badge warn' }, '질문/답변 구분 못함') : h('span', { class: 'badge ok' }, '질문/답변 구분됨')),
        unp ? h('div', { class: 'notice warn', role: 'alert' }, UNPARSED_WARN) : null,
        (S.ui.notes[c.id] || []).length ? h('p', { class: 'notes' }, S.ui.notes[c.id].join(' ')) : null);
    });
    const pasteTa = h('textarea', { id: 'pasteText', rows: 6, placeholder: '대화 화면의 내용을 전체 선택(Ctrl+A) → 복사 → 여기에 붙여넣기' });
    const pasteMsg = h('div', { id: 'pasteMsg', 'aria-live': 'polite' });
    fill(box,
      h('h3', null, 'B. AI 대화 PDF ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
      h('ol', { class: 'howto' },
        h('li', null, h('b', null, 'ChatGPT·Claude·Gemini 대화 화면에서 Ctrl+P'), ' (맥은 Cmd+P)'),
        h('li', null, '대상: ', h('b', null, 'PDF로 저장'), ' → 저장'),
        h('li', null, h('b', null, '여기에 올리기'), ' (여러 개 가능)')),
      dropZone({ id: 'convFile', accept: '.pdf,application/pdf', multiple: true, onFiles: addConvFiles, text: '대화 PDF를 끌어다 놓으세요 (여러 개 가능)', pick: 'PDF 선택' }),
      T.busy.map((j) => h('div', { class: 'job', role: 'status' }, j.total ? `${j.name} 읽는 중… (${j.done}/${j.total}쪽)` : `${j.name} 읽는 중…`)),
      T.errors.map((e, i) => h('div', { class: 'job err', role: 'alert' }, h('button', { type: 'button', class: 'x', 'aria-label': '안내 닫기', onclick: () => { T.errors.splice(i, 1); renderConvs(); } }, '닫기'), h('b', null, `${e.name} `), e.notes.join(' '))),
      h('div', { id: 'convList' }, items.length ? h('div', null, h('p', { class: 'count' }, `추가된 대화 ${items.length}개`), items) : h('p', { class: 'empty' }, '아직 올린 대화가 없습니다.')),
      items.length ? h('p', { class: 'hint' }, '잘못 올렸다면 "처음부터 다시"로 새로 시작하세요. 연관도 삭제 규칙은 3단계에서만 적용됩니다.') : null,
      !items.length ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'noAi', checked: S.ui.noAi, onchange: (e) => { S.ui.noAi = e.target.checked; save(); } }), 'AI 대화가 없습니다 (AI를 쓰지 않았거나 대화를 남기지 않았어요)') : null,
      h('details', { class: 'paste' }, h('summary', null, 'PDF가 안 될 때: 대화 내용 붙여넣기'),
        h('label', null, '대화 내용', pasteTa), pasteMsg,
        h('button', { type: 'button', id: 'btnPaste', onclick: () => {
          const t = pasteTa.value.trim();
          if (t.length < 20) { pasteMsg.replaceChildren(h('div', { class: 'job err', role: 'alert' }, '붙여넣은 내용이 너무 짧습니다.')); return; }
          const c = Pdf.toConversation(t, {});
          if (!c.turns.length) { pasteMsg.replaceChildren(h('div', { class: 'job err', role: 'alert' }, '읽을 수 있는 대화가 없습니다.')); return; }
          S.ui.guessed[c.id] = c.provider !== 'other';
          d.conversations.push(c); save(); renderConvs(); live('붙여넣은 대화를 추가했습니다');
        } }, '붙여넣은 대화 추가')));
  }

  async function addConvFiles(files) {
    for (const f of files) await addConv(f);
  }
  async function addConv(file) {
    const job = { name: file.name, done: 0, total: 0 };
    T.busy.push(job); renderConvs();
    const fail = (...notes) => { T.errors.push({ name: file.name, notes }); };
    try {
      if (S.doc.conversations.some((c) => c.source === file.name)) {
        fail('이미 올린 파일입니다. 다시 올리려면 "처음부터 다시"로 새로 시작해 주세요.');
      } else if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        fail('PDF 파일만 올릴 수 있습니다. PDF가 안 되면 아래 "PDF가 안 될 때"에 붙여넣어 주세요.');
      } else {
        const r = await Pdf.extract(await file.arrayBuffer(), { onProgress: (dn, t) => { job.done = dn; job.total = t; renderConvs(); } });
        if (!r.ok) fail(...r.notes);
        else {
          const c = Pdf.toConversation(r.text, { fileName: file.name });
          if (!c.turns.length) fail('읽을 수 있는 대화 내용이 없습니다.');
          else {
            S.doc.conversations.push(c);
            S.ui.pages[c.id] = r.pageCount; S.ui.guessed[c.id] = c.provider !== 'other'; S.ui.notes[c.id] = r.notes;
            save(); live(`${file.name} 추가됨`);
          }
        }
      }
    } catch (e) { fail('파일을 읽는 중 오류가 났습니다. 다시 시도하거나 붙여넣기를 이용해 주세요.'); }
    T.busy.splice(T.busy.indexOf(job), 1);
    renderConvs();
  }

  // ------------------------------------------------------------ 본문 표시
  function sourceLabel(doc, src) {
    const c = doc.conversations[src.convIndex];
    return `${src.convIndex + 1}번 대화${c ? `(${convName(c, src.convIndex)})` : ''}의 ${src.turnIndex + 1}번째 턴`;
  }

  function bodyViewer(R, doc, defaultOn) {
    const onClass = 'mark-on';
    const text = h('div', { class: `body-text${defaultOn ? ` ${onClass}` : ''}`, 'data-role': 'body' });
    const panel = h('div', { class: 'source-panel', role: 'status', 'aria-live': 'polite', hidden: true });
    const legend = h('div', { class: 'legend', hidden: !defaultOn, 'aria-label': '범례' }, KIND_ORDER.map((k) =>
      h('span', null, h('span', { class: `lg k-${k}` }, KIND[k].tag), ` ${KIND[k].label}`)));
    const full = doc.submission.text;
    let pos = 0;
    const showSource = (s, el) => {
      text.querySelectorAll('.sent.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      const kids = [h('b', null, `${KIND[s.kind].label}`), ` · 겹침 점수 ${pct(s.score)} · `, KIND[s.kind].desc];
      if (s.source) {
        kids.push(h('div', null, `출처: ${sourceLabel(doc, s.source)}`));
        kids.push(h('div', null, s.kind === 'studentOrigin' ? '학생이 AI에게 보낸 원문(근거 문장):' : '겹침 근거 문장:'));
        kids.push(h('blockquote', null, s.source.snippet));
      } else {
        kids.push(h('div', null, '겹치는 AI 답변을 찾지 못했습니다. (겹침 기반 추정이라, AI 답변을 읽고 자기 말로 다시 쓴 내용은 구분하지 못합니다.)'));
      }
      panel.replaceChildren(...kids);
      panel.hidden = false;
    };
    R.sentences.forEach((s) => {
      if (s.start > pos) text.append(full.slice(pos, s.start));
      const el = h('span', { class: `sent k-${s.kind}`, 'data-kind': s.kind, 'data-tag': KIND[s.kind].tag, title: `${KIND[s.kind].label} — 누르면 출처를 보여 줍니다` }, full.slice(s.start, s.end));
      const act = () => { if (text.classList.contains(onClass)) showSource(s, el); };
      el.addEventListener('click', act);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      text.append(el);
      pos = s.end;
    });
    if (pos < full.length) text.append(full.slice(pos));
    const sync = (on) => {
      text.classList.toggle(onClass, on); legend.hidden = !on;
      text.querySelectorAll('.sent').forEach((el) => { if (on) { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); } else { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.classList.remove('sel'); } });
      if (!on) panel.hidden = true;
    };
    sync(defaultOn);
    if (!R.sentences.length) text.append(h('span', { class: 'empty' }, '(본문이 없습니다)'));
    return h('div', { class: 'body-viewer' },
      h('div', { class: 'viewer-bar no-print' },
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', class: 'ai-toggle', checked: defaultOn, onchange: (e) => sync(e.target.checked) }), 'AI 반영 부분 표시'),
        h('span', { class: 'hint' }, '켜면 문장마다 표시가 붙고, 문장을 누르면 출처 대화가 보입니다.')),
      legend, text, panel);
  }

  // ------------------------------------------------------------ 대화 카드
  function turnCard(tr, doc, opt) {
    const c = doc.conversations[tr.convIndex];
    const turn = c && c.turns[tr.index];
    const chk = { ...tr };
    const title = `${tr.convIndex + 1}번 대화 · ${c ? convName(c, tr.convIndex) : ''} (${PROVIDER_LABEL[c?.provider] || ''}) · ${tr.index + 1}번째 ${c && c.parsed === 'unparsed' ? '묶음' : '턴'}`;
    const card = h('div', { class: 'turn-card', 'data-turn': tr.id, 'data-rel': tr.relevance.toFixed(4) });
    card.append(
      h('div', { class: 'turn-top' }, h('div', { class: 'turn-title' }, title),
        h('div', { class: 'turn-badges' }, tr.deletable ? h('span', { class: 'badge ok', 'data-role': 'deletable' }, '삭제 가능') : null,
          c && c.parsed === 'unparsed' ? h('span', { class: 'badge warn' }, '질문/답변 구분 못함') : null)),
      h('div', { class: 'rel' }, h('b', null, `연관도 ${pct(tr.relevance)} · ${REL_LABEL[tr.relevanceLabel] || ''}`), h('div', { class: 'track', role: 'img', 'aria-label': `연관도 ${pct(tr.relevance)}` }, h('i', { style: `width:${Math.round(tr.relevance * 100)}%` }))),
      h('div', { class: 'turn-badges' }, h('span', { class: 'badge info' }, `요청 유형(참고): ${Analyze.intentLabel(tr.intent)}`)),
      h('p', { class: 'turn-sum' }, tr.summaryLine));
    if (turn) {
      card.append(h('details', null, h('summary', null, '프롬프트·응답 원문 보기'),
        h('h4', null, '학생의 프롬프트'), h('pre', null, turn.prompt || '(질문/답변을 구분하지 못해 프롬프트가 비어 있습니다)'),
        h('h4', null, 'AI 응답'), h('pre', null, turn.response)));
    }
    if (opt.editable) {
      const area = h('div', { class: 'del-area no-print' });
      const draw = () => {
        const refusal = T.refusal[tr.id];
        const confirming = T.confirmDel === tr.id;
        fill(area,
          confirming
            ? h('div', { class: 'confirm-row', role: 'alertdialog', 'aria-label': '삭제 확인' },
              h('span', null, '이 대화를 삭제할까요? 내용은 지워지고 건수·연관도·글자 수만 내역서에 남습니다.'),
              h('button', { type: 'button', class: 'danger btn-confirm-del', onclick: () => doDelete(tr.id) }, '삭제 확인'),
              h('button', { type: 'button', onclick: () => { T.confirmDel = null; draw(); } }, '취소'))
            : h('button', { type: 'button', class: 'danger btn-del', onclick: () => tryDelete(tr.id, draw) }, '삭제'),
          refusal ? h('div', { class: 'notice high refusal', role: 'alert' }, refusal) : null);
      };
      draw();
      card.append(area);
    }
    void chk;
    return card;
  }

  function tryDelete(turnId, redraw) {
    delete T.refusal[turnId];
    const chk = Analyze.canDelete(S.doc, turnId);
    if (!chk.ok) { T.refusal[turnId] = chk.message; redraw(); live(chk.message); return; }
    T.confirmDel = turnId; redraw();
    const b = $(`[data-turn="${turnId}"] .btn-confirm-del`);
    if (b) b.focus();
  }
  function doDelete(turnId) {
    const r = Analyze.deleteTurn(S.doc, turnId);
    T.confirmDel = null;
    if (!r.ok) { T.refusal[turnId] = r.message; renderStage(); return; }
    S.doc = r.doc;
    // 대화에 턴이 하나도 안 남으면 목록에서도 정리한다(내용이 없으므로 규칙 우회가 아님)
    S.doc = { ...S.doc, conversations: S.doc.conversations.filter((c) => c.turns.length) };
    save();
    T.deleteNote = `대화를 삭제했습니다. (삭제 ${S.doc.deletions.length}건, 연관도 ${pct(S.doc.deletions[S.doc.deletions.length - 1].relevance)})`;
    renderStage();
    live(T.deleteNote);
  }

  // ------------------------------------------------------------ 요약
  function meters(R, doc) {
    const sm = R.summary;
    const unp = hasUnparsed(doc);
    const mk = (cls, label, v, extra) => h('div', { class: `meter ${cls}` },
      h('div', { class: 'lbl' }, h('span', null, label), extra),
      h('div', { class: 'big', 'data-role': cls === 'dep' ? 'dependency' : 'autonomy' }, pct(v)),
      h('div', { class: 'track', role: 'img', 'aria-label': `${label} ${pct(v)}` }, h('i', { style: `width:${Math.round(v * 100)}%` })));
    return h('div', { class: 'meters' },
      mk('dep', 'AI 의존도(추정)', sm.dependency, h('span', null, h('span', { class: 'badge info', 'data-role': 'band' }, `구간: ${BAND_LABEL[sm.band]}`), unp ? h('span', { class: 'badge warn', 'data-role': 'upper' }, ' 상한 추정') : null)),
      mk('aut', '학생 주체성(추정)', sm.autonomy, null));
  }
  function breakdown(R) {
    const sm = R.summary;
    return h('div', null,
      h('div', { class: 'stack', role: 'img', 'aria-label': '본문 구성 비율' }, KIND_ORDER.map((k) => h('i', { class: `s-${k}`, style: `width:${(sm.shares[k] * 100).toFixed(1)}%` }))),
      h('div', { class: 'legend' }, KIND_ORDER.map((k) => h('span', null, h('span', { class: `lg k-${k}` }, KIND[k].tag), ` ${KIND[k].label} ${pct(sm.shares[k])} (${sm.sentenceCounts[k]}문장)`))));
  }
  function howBox(doc) {
    return h('div', { class: 'how' },
      h('b', null, '어떻게 계산했나요? · 한계'),
      h('ul', null,
        h('li', null, `과제 본문의 문장마다 AI 답변과 글자·단어가 얼마나 겹치는지 봅니다. 의존도 = (그대로 반영한 글자 + 수정 반영한 글자의 절반) ÷ 전체 글자. 구간은 낮음 ${pct(Analyze.BAND_MID)} 미만, 높음 ${pct(Analyze.BAND_HIGH)} 이상입니다.`),
        h('li', null, '겹침으로 본 추정이라 AI 답변을 읽고 자기 말로 다시 쓴 내용은 잡지 못합니다. 그래서 실제 AI 영향보다 낮게 나올 수 있습니다.'),
        h('li', null, '대화 PDF는 학생이 제출한 파일이라, 원본인지 이 도구가 검증하지 못합니다.'),
        hasUnparsed(doc) ? h('li', null, UNPARSED_WARN) : null));
  }
  const NOT_JUDGE = '이 점수는 표절·부정행위를 판정하는 것이 아닙니다. 글자·단어 겹침을 근거로 한 참고용 추정입니다.';

  // ------------------------------------------------------------ 3단계
  function step3() {
    const doc = S.doc;
    const R = result();
    const unp = hasUnparsed(doc);
    return [
      h('h2', null, '3. 분석 결과'),
      T.deleteNote ? h('div', { class: 'notice ok no-print', role: 'status' }, T.deleteNote) : null,
      meters(R, doc),
      unp ? h('div', { class: 'notice warn', role: 'alert' }, UNPARSED_WARN) : null,
      breakdown(R),
      h('div', { class: 'notice', id: 'notJudge' }, NOT_JUDGE),
      howBox(doc),
      h('h3', null, '한눈에 보는 요약'),
      h('div', { class: 'narrative', id: 'narrative' }, R.narrative.map((p) => h('p', null, p))),
      h('h3', null, '과제 본문에서 AI 반영 부분 보기'),
      bodyViewer(R, doc, false),
      h('h3', null, `AI와 나눈 대화 (연관도 높은 순) `, h('span', { class: 'count' }, `${R.turns.length}개`)),
      h('p', { class: 'hint' }, '연관도가 낮은 대화(삭제 가능 표시)만 삭제할 수 있습니다. 연관도가 높은 대화는 삭제 버튼을 눌러도 삭제되지 않습니다.'),
      h('div', { id: 'turnCards' }, R.turns.length ? R.turns.map((tr) => turnCard(tr, doc, { editable: true })) : h('p', { class: 'empty' }, '분석할 대화가 없습니다.')),
      stepNav(true, true),
    ];
  }

  // ------------------------------------------------------------ 내역서
  const LIMITS = [
    '이 수치는 글자·단어 겹침에 기반한 추정입니다. AI 탐지기가 아니며, AI 답변을 읽고 자기 말로 다시 쓴 내용은 잡지 못해 하한에 가깝습니다.',
    '대화 PDF는 학생이 제출한 파일이라, 원본인지 여부를 이 도구가 검증하지 못합니다.',
    '대화에서 "내 질문"과 "AI 답변"을 구분하지 못한 경우, 학생이 AI에게 보낸 자기 글도 응답 쪽으로 세어져 의존도가 실제보다 높게 나올 수 있습니다(상한 추정).',
    '이 내역서는 표절·부정행위를 판정하지 않으며, 판단의 참고 자료입니다.',
  ];
  function buildReport(doc, R, o) {
    const m = doc.meta, sm = R.summary;
    const codeEl = h('code', { id: 'reportCode' }, o.code || '계산 중…');
    const del = doc.deletions || [];
    const rows = [['제출자', `${m.student} (${m.studentId})`], ['과목', m.course], ['담당 교수', m.professor || '-'], ['과제명', m.assignment]];
    const art = h('article', { class: 'report', id: o.id || 'report' },
      h('img', { class: 'report-logo', src: LOGO, alt: '명지대학교', width: '210', height: '54' }),
      h('h1', null, '생성형 AI 사용 내역서'),
      h('p', { class: 'sub' }, `${m.course || '과목명 미입력'} · ${m.assignment || '과제명 미입력'}`),
      h('table', null, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v))), m.assignmentBrief ? h('tr', null, h('th', null, '과제 안내문'), h('td', null, m.assignmentBrief)) : null)),
      h('h3', null, '1. AI 의존도와 학생 주체성 (추정)'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, '의존도', h('b', null, pct(sm.dependency)), h('div', { class: 'track' }, h('i', { style: `width:${Math.round(sm.dependency * 100)}%` })), h('span', { class: 'badge info' }, `구간: ${BAND_LABEL[sm.band]}`), hasUnparsed(doc) ? h('span', { class: 'badge warn' }, ' 상한 추정') : null),
        h('div', { class: 'stat aut' }, '주체성', h('b', null, pct(sm.autonomy)), h('div', { class: 'track' }, h('i', { style: `width:${Math.round(sm.autonomy * 100)}%` })))),
      breakdown(R),
      h('p', { class: 'meta-note' }, `계산: 본문 문장별로 AI 답변과의 겹침을 보고, 의존도 = (그대로 반영 글자 + 수정 반영 글자의 절반) ÷ 전체 글자. 낮음 ${pct(Analyze.BAND_MID)} 미만 · 높음 ${pct(Analyze.BAND_HIGH)} 이상.`),
      hasUnparsed(doc) ? h('div', { class: 'notice warn' }, UNPARSED_WARN) : null,
      h('div', { class: 'notice' }, NOT_JUDGE),
      h('h3', null, '2. 요약'),
      R.narrative.map((p) => h('p', null, p)),
      h('h3', null, '3. AI와 나눈 대화 (연관도 높은 순)'),
      R.turns.length ? R.turns.map((tr) => turnCard(tr, doc, { editable: false })) : h('p', null, '첨부된 대화가 없습니다.'),
      h('h3', null, '4. 과제 본문 (AI 반영 부분 표시)'),
      bodyViewer(R, doc, true),
      h('h3', null, '5. 삭제 기록'),
      del.length
        ? [h('p', { id: 'delSummary' }, `연관도가 낮아 학생이 삭제한 대화 ${del.length}건 (글자 수 합계 ${del.reduce((a, d) => a + d.chars, 0).toLocaleString()}자). 삭제된 대화의 내용은 남기지 않았습니다.`),
          h('table', { class: 'del-table' }, h('thead', null, h('tr', null, h('th', null, '번호'), h('th', null, '연관도'), h('th', null, '글자 수'))),
            h('tbody', null, del.map((d, i) => h('tr', null, h('td', null, String(i + 1)), h('td', null, pct(d.relevance)), h('td', null, d.chars.toLocaleString())))))]
        : h('p', { id: 'delSummary' }, '삭제한 대화가 없습니다.'),
      h('h3', null, '6. 학생 성찰'),
      h('p', { style: 'white-space:pre-wrap' }, doc.reflection || '(작성하지 않음)'),
      h('p', { style: 'margin-top:16px' }, '위 내용은 사실과 다르지 않음을 확인합니다.'),
      h('div', { class: 'sign' }, h('div', null, `제출일: ${new Date().toISOString().slice(0, 10)}`), h('div', null, `학생 ${m.student} (서명)`)),
      h('div', { class: 'seal' }, '문서 확인 코드: ', codeEl, o.codeNote ? h('div', null, o.codeNote) : null,
        h('div', null, '교수님은 학생이 함께 제출한 .json 파일을 이 서비스의 "교수용 확인" 탭에 올려, 이 코드와 일치하는지 확인할 수 있습니다. 서명이 아니므로 인쇄된 코드와 대조해야 의미가 있습니다.')),
      h('h3', null, '한계'),
      h('ul', { class: 'limits' }, LIMITS.map((l) => h('li', null, l))));
    return art;
  }

  // ------------------------------------------------------------ 4단계
  let sealToken = 0;
  function step4() {
    const doc = S.doc;
    const R = result();
    const reportHolder = h('div', { id: 'reportHolder' });
    let t = null;
    const refresh = () => {
      const tok = ++sealToken;
      const art = buildReport(S.doc, result(), { code: null });
      reportHolder.replaceChildren(art);
      Core.seal(S.doc, Analyze).then((sealed) => { if (tok === sealToken) { const el = $('#reportCode', reportHolder); if (el) el.textContent = sealed.code; } });
    };
    refresh();
    void doc; void R;
    return [
      h('h2', null, '4. 제출'),
      h('div', { class: 'no-print' },
        h('ol', { class: 'guide' },
          h('li', null, '아래 성찰을 적습니다(선택).'),
          h('li', null, h('b', null, '"인쇄 / PDF 저장"'), '을 눌러 내역서를 PDF로 저장합니다.'),
          h('li', null, h('b', null, '"제출 파일 저장"'), '으로 .json 파일을 저장합니다.'),
          h('li', null, 'PDF와 .json 두 파일을 교수님이 안내한 방법으로 함께 제출합니다. 교수님은 .json으로 내용이 바뀌지 않았는지 확인합니다.')),
        h('label', null, '학생 성찰 (선택): 이번 과제에서 AI가 도움이 된 점, 한계라고 느낀 점, 앞으로 달리 쓰고 싶은 방식',
          h('textarea', { id: 'reflection', rows: 4, value: S.doc.reflection, oninput: (e) => { S.doc.reflection = e.target.value; save(); clearTimeout(t); t = setTimeout(refresh, 250); } })),
        h('div', { class: 'actions' },
          h('button', { type: 'button', id: 'btnPrint', class: 'primary', onclick: () => window.print() }, '인쇄 / PDF 저장'),
          h('button', { type: 'button', id: 'btnSave', onclick: saveJson }, '제출 파일(.json) 저장')),
        h('div', { id: 'saveMsg', role: 'status', 'aria-live': 'polite' })),
      reportHolder,
      stepNav(true, false),
    ];
  }
  async function saveJson() {
    const msg = $('#saveMsg');
    try {
      const sealed = await Core.seal(S.doc, Analyze);
      const url = URL.createObjectURL(new Blob([JSON.stringify(sealed, null, 2)], { type: 'application/json' }));
      const a = h('a', { href: url, download: `AI사용내역_${S.doc.meta.studentId || 'draft'}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      msg.replaceChildren(h('div', { class: 'notice ok' }, `제출 파일을 저장했습니다. 확인 코드 ${sealed.code}`));
    } catch (e) {
      msg.replaceChildren(h('div', { class: 'notice high', role: 'alert' }, '제출 파일을 만들지 못했습니다. 다시 시도해 주세요.'));
    }
  }

  // ------------------------------------------------------------ 교수용
  function renderProf(content) {
    const stage = $('#profStage');
    fill(stage,
      h('h2', null, '제출된 파일 확인'),
      h('p', { class: 'hint' }, '학생이 제출한 .json 파일을 올리면 내용이 확인 코드와 일치하는지 검사하고, 학생 화면과 같은 내역서를 보여 줍니다. 파일은 이 브라우저 안에서만 처리됩니다.'),
      h('label', null, '.json 제출 파일', h('input', { type: 'file', id: 'profFile', accept: 'application/json,.json', onchange: onProfFile })),
      h('div', { id: 'profOut', 'aria-live': 'polite' }, content));
  }
  async function onProfFile(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const out = $('#profOut');
    out.replaceChildren(h('p', null, '확인 중…'));
    try {
      let doc;
      try { doc = JSON.parse(await file.text()); } catch (e) { throw new Error('JSON 형식이 아닙니다.'); }
      const v = await Core.verifyDoc(doc, Analyze);
      if (!doc || doc.version !== 2 || !Array.isArray(doc.conversations)) {
        out.replaceChildren(verdictBox(v, false));
        return;
      }
      const R = Analyze.run(doc);
      const nodes = [verdictBox(v, true), buildReport(doc, R, { id: 'profReport', code: v.code, codeNote: doc.code && doc.code !== v.code ? `파일에 적힌 코드: ${doc.code} (불일치)` : null })];
      out.replaceChildren(...nodes);
      live(v.ok ? '일치합니다' : '불일치합니다');
    } catch (e) {
      out.replaceChildren(h('div', { class: 'verdict high', role: 'alert' }, h('div', { class: 'big' }, '파일을 읽을 수 없습니다'), e.message || '알 수 없는 오류'));
    }
  }
  function verdictBox(v, show) {
    void show;
    return h('div', { class: `verdict no-print ${v.ok ? 'ok' : 'high'}`, id: 'verdict', role: 'status' },
      h('div', { class: 'big' }, v.ok ? '일치합니다' : '불일치합니다'),
      v.ok ? '파일 내용이 확인 코드와 같고, 적힌 점수가 본문·대화로 다시 계산한 값과 같습니다.' : '아래 이유를 확인하세요. 이 도구는 위조를 막는 서명이 아니므로, 인쇄된 PDF의 확인 코드와도 대조해 주세요.',
      h('ul', null,
        h('li', null, `내용과 확인 코드: ${v.codeOk ? '일치' : '불일치'}`),
        h('li', null, `점수 재계산: ${v.claimOk ? '일치' : '불일치'}`),
        ...v.problems.map((p) => h('li', null, p)),
        v.code ? h('li', null, `다시 계산한 확인 코드: ${v.code}`) : null));
  }

  // ------------------------------------------------------------ 탭·머리 버튼
  function showTab(name) {
    T.tab = name;
    document.querySelectorAll('.tabs button').forEach((b) => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $('#view-student').hidden = name !== 'student';
    $('#view-prof').hidden = name !== 'prof';
    if (name === 'prof' && !$('#profFile')) renderProf();
  }
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = b.dataset.tab === 'student' ? 'prof' : 'student';
      showTab(next); $(`#tabbtn-${next}`).focus();
    });
  });

  function resetAll() {
    S = { doc: Core.blankDoc(), step: 1, ui: blankUi() };
    T.busy = []; T.errors = []; T.assignMsg = null; T.assignBusy = null; T.confirmDel = null; T.refusal = {}; T.valErrs = null; T.deleteNote = '';
    save(); renderStage(true); live('처음부터 다시 시작합니다');
  }
  $('#btnReset').addEventListener('click', () => askConfirm('처음부터 다시 할까요? 입력한 내용과 올린 대화가 모두 지워집니다.', '예, 지우기', resetAll));
  $('#btnDemo').addEventListener('click', () => {
    const load = () => {
      S = { doc: Sample.doc(), step: 3, ui: { ...blankUi(), pages: { ...Sample.pages }, guessed: {} } };
      T.errors = []; T.refusal = {}; T.confirmDel = null; T.valErrs = null; T.deleteNote = '';
      showTab('student'); save(); renderStage(true); live('예시 데이터를 불러왔습니다. 이름은 허구입니다.');
    };
    const dirty = S.doc.meta.student || S.doc.submission.text || S.doc.conversations.length;
    if (dirty) askConfirm('지금 입력한 내용이 예시 데이터로 바뀝니다. 계속할까요?', '예시로 바꾸기', load); else load();
  });

  loadState();
  renderStage();
})();
