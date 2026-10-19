'use strict';
/**
 * parse.js — 공유 링크 판별과 붙여넣은 대화 파싱 (브라우저/Node 공용)
 * 계약은 docs/spec-v2.md 의 `Parse` 절. 이 모듈은 DOM·네트워크를 쓰지 않는다.
 */
(function (root) {
  const INVISIBLE = /[\u200b\u2060\ufeff]/g; // 표지 인식과 비교를 깨뜨리는 보이지 않는 문자

  /* ───────────────────────── 링크 ───────────────────────── */

  const MAX_URL_LENGTH = 2048;
  const PROVIDER_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', other: '기타' };

  // 공유 링크 모양. 호스트·경로는 과제 요청문에 적힌 형식을 그대로 옮긴 것이다.
  // 이 환경에서는 각 서비스 페이지를 열어 보지 못해(DNS 차단) 실제 URL 모양은 확인하지 못했다 = 추정.
  // 검색 결과로는 'g.co/gemini/share' 가 Gemini 공유 링크라는 제3자 글 제목과,
  // OpenAI 도움말에 ChatGPT 공유 링크 문서가 있다는 것만 확인했다.
  // 호스트는 정확히 일치할 때만 인정한다(chatgpt.com.evil.com 같은 이름 방지).
  const SHARE_RULES = [
    { provider: 'chatgpt', hosts: ['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'], share: /^\/share\/[^\/]+/ },
    { provider: 'claude', hosts: ['claude.ai', 'www.claude.ai'], share: /^\/share\/[^\/]+/ },
    { provider: 'gemini', hosts: ['gemini.google.com'], share: /^\/share\/[^\/]+/ },
    // g.co 는 구글 단축 도메인이라 /gemini/ 아래만 Gemini 로 본다.
    { provider: 'gemini', hosts: ['g.co'], scope: /^\/gemini\//, share: /^\/gemini\/share\/[^\/]+/ },
  ];

  // 화면에 링크로 렌더링되는 값이라, 정규화 뒤에도 남을 수 있는 HTML 속성 구분 문자를 한 번 더 인코딩한다.
  function safeHref(href) {
    return href.replace(/["'<>`\\]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  function detectProvider(input) {
    const none = { provider: 'other', label: '', valid: false, url: '' };
    try {
      if (typeof input !== 'string') return none;
      const s = input.replace(INVISIBLE, '').trim();
      // 안쪽 공백·제어문자가 있으면 링크 하나가 아니다. 'java\tscript:' 같은 우회도 여기서 막힌다.
      // 역슬래시는 파서가 슬래시로 바꿔 'evil.com\@chatgpt.com' 처럼 눈속임이 되므로 받지 않는다.
      if (!s || s.length > MAX_URL_LENGTH || /[\s\u0000-\u001f\u007f\\]/.test(s)) return none;

      let candidate;
      if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) {
        if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(s)) candidate = s;
        else if (/^[^\/?#:]+:\d+(?:[\/?#]|$)/.test(s)) candidate = 'https://' + s; // 스킴이 아니라 host:port
        else return none; // javascript:, data:, mailto: 등
      } else if (s.startsWith('//')) {
        candidate = 'https:' + s;
      } else {
        candidate = 'https://' + s;
      }

      // 빈 사용자정보(https://@host)까지 거절하려고 파서가 정규화하기 전의 원문 권한부를 본다.
      const authority = /^[a-z][a-z0-9+.\-]*:\/*([^\/?#]*)/i.exec(candidate);
      if (authority && authority[1].includes('@')) return none;

      let u;
      try { u = new URL(candidate); } catch (e) { return none; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return none;
      if (u.username || u.password) return none;

      const host = u.hostname.replace(/\.$/, '');
      // 공개 도메인이 아니면(점 없음, IP, localhost) 교수가 열 수 없는 값이라 링크로 쓰지 않는다.
      if (!host.includes('.') || /^[\d.]+$/.test(host)) return none;

      const url = safeHref(u.href);
      const path = u.pathname;
      if (!u.port) {
        for (const rule of SHARE_RULES) {
          if (!rule.hosts.includes(host)) continue;
          if (rule.scope && !rule.scope.test(path)) continue;
          return { provider: rule.provider, label: PROVIDER_LABELS[rule.provider], valid: rule.share.test(path), url };
        }
      }
      // 알려진 서비스가 아니면 공유 링크인지 알 수 없다. 최소한 홈페이지가 아니라 어떤 페이지를 가리키는지만 본다.
      return { provider: 'other', label: PROVIDER_LABELS.other, valid: path.length > 1 || u.search.length > 1, url };
    } catch (e) {
      return none;
    }
  }

  /* ───────────────────────── 대화 ───────────────────────── */

  // 역할 표지 목록. 새 표기를 지원하려면 이 배열에 항목을 더하면 된다.
  //  - bare: 콜론 없이 줄에 표지만 있어도 인정 (나머지는 콜론이 있어야 한다)
  //  - weak: 본문 속 문장과 구분하기 어려운 관례 표기. 아래 chooseMarkers 참고
  //
  // 출처 확인 상태 (2026-10-16). 검색 요약만 읽었고 원문 페이지는 이 환경에서 열리지 않았다.
  //  - '나의 말' / 'ChatGPT의 말': 한국어 ChatGPT 화면을 붙여 넣은 글(m.cafe.daum.net/jkdavid/Ue9A/46)이
  //    두 문구를 쓴다고 검색 요약에 나왔다. 원문은 열어 보지 못했다. 줄바꿈 위치도 확인하지 못했다.
  //  - 'You said' / 'ChatGPT said': 위 한국어 문구의 영어 UI 대응으로 추정. 검색으로 확인하지 못했다.
  //  - 'Gemini said' / 'Gemini의 말': 추정. 검색으로 확인하지 못했다.
  //    (제3자 북마클릿이 'User'/'Gemini' 제목으로 내보낸다는 검색 요약만 있고, Gemini 자체 형식은 아니다.)
  //  - '내가 한 말' / 'ChatGPT 답변': 확인됨 (2026-10-16). 사용자가 올린 실제 ChatGPT(chatgpt.com/c/...) 대화를 Chrome 154에서
  //    Ctrl+P로 저장한 14쪽 PDF에서 관찰했다. 표지는 따로 한 줄에 "내가 한 말:" / "ChatGPT 답변:" 으로 있고 본문은 다음 줄부터
  //    시작한다. 위 '나의 말' / 'ChatGPT의 말' 추정과는 달랐다(그 표기가 다른 화면 버전의 것인지는 모른다).
  //    영어 화면의 표지는 확인하지 못했다.
  //  - 'HUMAN' / 'ASSISTANT': 확인됨 (2026-10-19). Claude Exporter(Chrome 확장)의 "PDF (via print)"로 만든 실제 13쪽 PDF에서 관찰했다.
  //    대문자 표지가 콜론 없이 한 줄씩 있고, 맨 위에 제목과 "Created <ISO 시각>" 줄, 사용자 블록 안에 "ATTACHMENTS" 목록이 있다.
  //    Claude 화면 자체의 인쇄본이나 다른 내보내기 도구의 모양은 확인하지 못했다.
  //  - 'User prompt' / 'Response': 확인됨 (2026-10-16). 사용자가 올린 실제 Gemini(gemini.google.com/app) 대화를
  //    Chrome 154에서 Ctrl+P로 저장한 PDF에서 관찰했다. 한국어 화면(hl=ko)인데도 표지는 영어로 나왔고, 표지 뒤 같은 줄에
  //    본문이 이어진다(예: "User prompt: 질문", "Response: 답변"). 대화가 여러 턴일 때의 모양은 한 턴짜리 파일만 봐서 모른다.
  //  - Claude 공유 페이지를 복사했을 때의 모양은 확인하지 못했다. 'Human'/'Claude' 는 일반적인 수동 표기(추정).
  //  - 그 밖의 User/Assistant/AI/사용자/Q/A 등은 사람이 직접 붙이는 관례 표기이며 서비스 형식이 아니다.
  const MARKERS = [
    { role: 'user', bare: true, labels: ['나의 말', '사용자의 말', 'You said'] },
    { role: 'assistant', bare: true, labels: ['ChatGPT의 말', 'ChatGPT said', 'Gemini의 말', 'Gemini said'] },
    { role: 'user', bare: true, labels: ['사용자', 'User', 'Human'] },
    { role: 'user', labels: ['You', 'User prompt', '내가 한 말'] },
    { role: 'assistant', bare: true, labels: ['어시스턴트', 'Assistant'] },
    { role: 'assistant', labels: ['Response', 'ChatGPT 답변'] },
    // 이름만 있는 줄('ChatGPT', 'Claude')은 공유 페이지 머리글일 수 있어 콜론이 있을 때만 표지로 본다.
    { role: 'assistant', labels: ['AI', 'ChatGPT', 'GPT', 'Claude', 'Gemini'] },
    { role: 'user', weak: true, labels: ['Q'] },
    { role: 'assistant', weak: true, labels: ['A'] },
  ];

  const SP = '[ \\t\\u00a0\\u3000]'; // 전각 공백, NBSP 포함
  const DECO = '(?:\\*{1,3}|_{1,3})'; // **굵게**, __굵게__
  const norm = (s) => s.toLowerCase().replace(/[ \t\u00a0\u3000]+/g, ' ');
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/\-]/g, '\\$&');

  const BY_LABEL = new Map();
  const ALL_LABELS = [];
  for (const g of MARKERS) {
    for (const label of g.labels) {
      BY_LABEL.set(norm(label), { role: g.role, bare: !!g.bare, weak: !!g.weak });
      ALL_LABELS.push(label);
    }
  }
  ALL_LABELS.sort((a, b) => b.length - a.length);

  // 공백 반복에는 방어적으로 상한을 둔다(상한이 없어도 느려지는 입력은 찾지 못했다).
  // 라벨 앞의 장식(#, **)은 라벨에 붙어 있을 때만 받는다. '* User:' 같은 목록 항목과 '> Q:' 인용은 본문이다.
  const MARKER_LINE = new RegExp(
    '^' + SP + '{0,8}(?:#{1,6}' + SP + '{1,4})?'
    + '(' + DECO + ')?'
    + '(' + ALL_LABELS.map((l) => escapeRe(l).replace(/ /g, SP + '{1,8}')).join('|') + ')'
    + '(' + DECO + ')?' + SP + '{0,8}'
    + '(?:([:：])([\\s\\S]*))?$',
    'i'
  );

  function matchMarker(line) {
    const m = MARKER_LINE.exec(line);
    if (!m) return null;
    const entry = BY_LABEL.get(norm(m[2]));
    if (!entry) return null;
    let body = '';
    if (m[4]) {
      body = m[5];
      // '**User:** 질문' 처럼 라벨 앞에서 연 장식이 콜론 뒤에서 닫히면 그 장식만 걷어 낸다. 본문의 굵게 표시는 건드리지 않는다.
      if (m[1] && !m[3]) {
        const t = body.replace(/^[ \t\u00a0\u3000]+/, '');
        if (t.startsWith(m[1])) body = t.slice(m[1].length);
      }
    } else if (!entry.bare || (m[1] || '') !== (m[3] || '')) {
      return null;
    }
    return { role: entry.role, weak: entry.weak, body };
  }

  /**
   * 어떤 표지를 쓸지 정한다.
   * Q:/A: 는 FAQ·퀴즈 답변처럼 AI 응답 본문에도 자주 나온다. 그래서 그 밖의 표지로 사용자·AI 양쪽이 모두 확인되면
   * Q:/A: 줄은 본문으로 두고, 그렇지 않을 때만(= Q:/A: 가 대화 표기일 가능성이 클 때) 표지로 쓴다.
   * 한계: User:/Assistant: 처럼 화자 이름 표지가 본문 속 예시 대화에 나오면 구분하지 못한다.
   */
  function chooseMarkers(found) {
    const strong = found.filter((m) => !m.weak);
    const both = strong.some((m) => m.role === 'user') && strong.some((m) => m.role === 'assistant');
    return both ? strong : found;
  }

  /**
   * 연달아 나온 두 사용자 메시지가 '고쳐서 다시 보낸 질문'인가.
   * 실제 ChatGPT 인쇄본에서 수정 전 질문과 수정 후 질문이 둘 다 나왔고(사이에 AI 응답 없음), 수정본은 원본 내용을 대부분 포함했다.
   * 줄바꿈 위치가 수정 때문에 달라지므로 공백을 모두 지우고 글자 2-gram 포함도로 비교한다.
   * 한계: 한 가지 사례로 정한 기준(0.6)이다. 서로 다른 질문이 연달아 나온 경우는 합쳐서 보존한다.
   */
  function isRevision(a, b) {
    const grams = (t) => {
      const c = t.replace(/\s+/g, '');
      const set = new Set();
      for (let i = 0; i + 1 < c.length; i++) set.add(c.slice(i, i + 2));
      return set;
    };
    const ga = grams(a), gb = grams(b);
    const [small, large] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
    if (small.size < 20) return false; // 너무 짧으면 우연히 겹친다
    let hit = 0;
    for (const g of small) if (large.has(g)) hit++;
    return hit / small.size >= 0.6;
  }

  function parseTranscript(text) {
    try {
      if (typeof text !== 'string') {
        return { turns: [], ok: false, notes: ['대화 내용이 문자열이 아닙니다.'] };
      }
      const clean = text.replace(INVISIBLE, '').replace(/\r\n?/g, '\n');
      const whole = clean.trim();
      if (!whole) return { turns: [], ok: false, notes: ['붙여넣은 내용이 비어 있습니다.'] };

      const lines = clean.split('\n');
      const found = [];
      for (let i = 0; i < lines.length; i++) {
        const mk = matchMarker(lines[i]);
        if (mk) { mk.line = i; found.push(mk); }
      }
      const markers = chooseMarkers(found);

      if (!markers.length) {
        return {
          turns: [{ prompt: '', response: whole }],
          ok: false,
          notes: [
            '역할 표지(예: "나의 말:", "You said:", "User:", "AI:")를 찾지 못해 전체를 하나의 응답으로 보존했습니다.',
            '각 발화 앞에 표지를 붙여 다시 붙여넣으면 질문과 답변을 나눌 수 있습니다.',
          ],
        };
      }

      const notes = [];
      const lead = lines.slice(0, markers[0].line).join('\n').trim();
      if (lead) notes.push(`첫 표지 앞의 ${lead.length}자(제목·안내 문구로 보이는 내용)는 버렸습니다.`);

      const segments = [];
      let skipped = 0;
      let revised = 0;
      for (let k = 0; k < markers.length; k++) {
        const mk = markers[k];
        const end = k + 1 < markers.length ? markers[k + 1].line : lines.length;
        const parts = [mk.body];
        for (let i = mk.line + 1; i < end; i++) parts.push(lines[i]);
        const body = parts.join('\n').trim();
        if (!body) { skipped++; continue; }
        const last = segments[segments.length - 1];
        if (last && last.role === mk.role) {
          if (mk.role === 'user' && isRevision(last.text, body)) { last.text = body; revised++; }
          else last.text += '\n\n' + body; // 같은 역할이 이어지면 합친다
        } else segments.push({ role: mk.role, text: body });
      }
      if (skipped) notes.push(`본문이 빈 표지 ${skipped}개는 건너뛰었습니다.`);
      if (revised) notes.push(`질문을 고쳐서 다시 보낸 것으로 보이는 연속된 질문 ${revised}건은 마지막 것만 남겼습니다.`);

      if (!segments.length) {
        return { turns: [], ok: false, notes: ['역할 표지는 찾았지만 표지 뒤에 내용이 없습니다.'] };
      }

      const turns = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.role === 'user') {
          const next = segments[i + 1];
          if (next && next.role === 'assistant') { turns.push({ prompt: seg.text, response: next.text }); i++; }
          else turns.push({ prompt: seg.text, response: '' });
        } else {
          turns.push({ prompt: '', response: seg.text }); // 첫 발화가 AI 쪽인 경우
        }
      }

      const hasUser = segments.some((s) => s.role === 'user');
      const hasAssistant = segments.some((s) => s.role === 'assistant');
      if (!hasAssistant) notes.push('AI 응답 표지를 찾지 못했습니다. 질문만 있는 대화로 처리했습니다.');
      else if (!hasUser) notes.push('사용자 질문 표지를 찾지 못했습니다. 응답만 있는 대화로 처리했습니다.');
      else if (turns[turns.length - 1].response === '') notes.push('마지막 질문에는 응답이 없어 질문만 보존했습니다.');

      return { turns, ok: true, notes };
    } catch (e) {
      return { turns: [], ok: false, notes: ['대화를 읽는 중 오류가 발생했습니다: ' + (e && e.message ? e.message : String(e))] };
    }
  }

  const api = { detectProvider, parseTranscript };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parse = api;
})(typeof self !== 'undefined' ? self : globalThis);
