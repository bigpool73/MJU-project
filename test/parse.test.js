'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Parse = require('../src/parse.js');

const parse = Parse.parseTranscript;
const detect = Parse.detectProvider;
const NONE = { provider: 'other', label: '', valid: false, url: '' };

/* ───────────────────────── 링크 ───────────────────────── */

test('ChatGPT 공유 링크(chatgpt.com, chat.openai.com)를 알아본다', () => {
  assert.deepStrictEqual(detect('https://chatgpt.com/share/68a1b2c3-0000-1111-2222-333344445555'), {
    provider: 'chatgpt', label: 'ChatGPT', valid: true, url: 'https://chatgpt.com/share/68a1b2c3-0000-1111-2222-333344445555',
  });
  const old = detect('https://chat.openai.com/share/abc-123');
  assert.strictEqual(old.provider, 'chatgpt');
  assert.strictEqual(old.valid, true);
});

test('Claude·Gemini 공유 링크(gemini.google.com, g.co/gemini/share)를 알아본다', () => {
  const c = detect('https://claude.ai/share/0f1e2d3c');
  assert.strictEqual(c.provider, 'claude');
  assert.strictEqual(c.label, 'Claude');
  assert.strictEqual(c.valid, true);
  for (const u of ['https://gemini.google.com/share/6d2f9a', 'https://g.co/gemini/share/6d2f9a']) {
    const g = detect(u);
    assert.strictEqual(g.provider, 'gemini', u);
    assert.strictEqual(g.valid, true, u);
  }
});

test('그 밖의 https 주소는 other. 페이지를 가리키면 valid, 홈페이지면 아니다', () => {
  const r = detect('https://www.perplexity.ai/search/abc');
  assert.deepStrictEqual(r, { provider: 'other', label: '기타', valid: true, url: 'https://www.perplexity.ai/search/abc' });
  const home = detect('https://example.com');
  assert.strictEqual(home.provider, 'other');
  assert.strictEqual(home.valid, false);
  // 홈페이지는 링크로 쓸 수는 있으므로 안전한 값이면 url 은 남긴다.
  assert.strictEqual(home.url, 'https://example.com/');
});

test('스킴이 없으면 https로 보정하고, 앞뒤 공백·줄바꿈은 지운다', () => {
  assert.strictEqual(detect('chatgpt.com/share/abc').url, 'https://chatgpt.com/share/abc');
  assert.strictEqual(detect('claude.ai/share/abc').provider, 'claude');
  assert.strictEqual(detect('//gemini.google.com/share/abc').url, 'https://gemini.google.com/share/abc');
  assert.strictEqual(detect('  \n\thttps://claude.ai/share/abc \r\n').url, 'https://claude.ai/share/abc');
  assert.strictEqual(detect('chatgpt.com:443/share/abc').provider, 'chatgpt'); // 포트는 스킴이 아니다
  assert.strictEqual(detect('http://claude.ai/share/abc').url, 'http://claude.ai/share/abc'); // 명시한 http는 그대로
});

test('보안: http/https 이외 스킴은 valid:false, url은 빈 문자열', () => {
  const bad = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'javascript://example.com/%0Aalert(1)',
    'data:text/html,<script>alert(1)</script>', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)',
    'file:///etc/passwd', 'ftp://chatgpt.com/share/x', 'mailto:a@b.com', 'blob:https://chatgpt.com/abc',
    'java\tscript:alert(1)', ' javascript:alert(1) ',
  ];
  for (const u of bad) assert.deepStrictEqual(detect(u), NONE, JSON.stringify(u));
});

test('보안: 사용자정보(user:pass@, 빈 @ 포함)가 들어간 URL은 거절한다', () => {
  const bad = [
    'https://user:pw@chatgpt.com/share/abc',
    'https://chatgpt.com@evil.com/share/abc',
    'https://evil.com@chatgpt.com/share/abc',
    'https://@chatgpt.com/share/abc',
    'evil@chatgpt.com/share/abc',
    'https://evil.com\\@chatgpt.com/share/abc',
  ];
  for (const u of bad) assert.deepStrictEqual(detect(u), NONE, u);
});

test('보안: 돌려주는 url은 HTML 속성을 깨는 문자를 담지 않는다', () => {
  const hostile = [
    'https://example.com/a"onmouseover="alert(1)',
    "https://example.com/a'b<script>alert(1)</script>",
    'https://example.com/?q="><img src=x onerror=alert(1)>',
    "https://example.com/#'\"<>`",
    'https://chatgpt.com/share/a`b',
  ];
  for (const u of hostile) {
    const r = detect(u);
    assert.ok(r.url === '' || /^https?:\/\/[^\s"'<>`\\]+$/.test(r.url), `${u} -> ${r.url}`);
  }
  assert.ok(detect(hostile[0]).url.includes('%22'));
});

test('안쪽 공백이 있거나 URL이 아닌 입력은 거절하고 예외를 던지지 않는다', () => {
  const bad = ['', '   ', 'hello', '그냥 문장입니다', 'https://chatgpt.com/share/a b', 'chatgpt.com 공유 링크',
    'https://', 'https://.', 'https:\\\\chatgpt.com\\share\\abc', 'http://localhost:3000/share/x', 'http://127.0.0.1/share/x', 'https://[::1]/share/x',
    'https://' + 'a'.repeat(3000) + '.com/x', null, undefined, 123, {}, [], true];
  for (const u of bad) assert.deepStrictEqual(detect(u), NONE, String(u).slice(0, 40));
});

test('비슷한 이름의 호스트는 서비스로 인정하지 않는다', () => {
  const fake = ['https://chatgpt.com.evil.com/share/abc', 'https://evil-chatgpt.com/share/abc',
    'https://notclaude.ai/share/abc', 'https://claude.ai.evil.com/share/abc', 'https://g.co.evil.com/gemini/share/x',
    'https://chatgpt.com:8443/share/abc'];
  for (const u of fake) assert.strictEqual(detect(u).provider, 'other', u);
  assert.strictEqual(detect('HTTPS://ChatGPT.COM/share/Abc').provider, 'chatgpt'); // 호스트 대소문자는 무관
});

test('알려진 서비스라도 공유 링크가 아닌 주소(비공개 대화·빈 id)는 valid:false', () => {
  const cases = [
    ['https://chatgpt.com/c/68a1b2c3', 'chatgpt'],
    ['https://chatgpt.com/share/', 'chatgpt'],
    ['https://claude.ai/chat/0f1e2d3c', 'claude'],
    ['https://gemini.google.com/app/6d2f9a', 'gemini'],
  ];
  for (const [u, provider] of cases) {
    const r = detect(u);
    assert.strictEqual(r.provider, provider, u);
    assert.strictEqual(r.valid, false, u);
    assert.strictEqual(r.url, u, u);
  }
  // g.co 의 다른 단축 주소는 Gemini 가 아니다
  assert.strictEqual(detect('https://g.co/kgs/abc').provider, 'other');
});

/* ───────────────────────── 대화 ───────────────────────── */

test('한국어 UI 복사본: 나의 말 / ChatGPT의 말, 본문은 다음 줄부터', () => {
  const text = [
    '나의 말:',
    '조선시대 신분제에 대해 설명해줘',
    '',
    'ChatGPT의 말:',
    '조선시대 신분제는 양반, 중인, 상민, 천민으로 나뉩니다.',
    '',
    '- 양반: 지배층',
    '- 중인: 기술직',
    '',
    '나의 말:',
    '중인을 더 자세히',
    '',
    'ChatGPT의 말:',
    '중인은 역관, 의관 등 전문직 계층입니다.',
  ].join('\n');
  const r = parse(text);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.turns.length, 2);
  assert.strictEqual(r.turns[0].prompt, '조선시대 신분제에 대해 설명해줘');
  assert.strictEqual(r.turns[0].response, '조선시대 신분제는 양반, 중인, 상민, 천민으로 나뉩니다.\n\n- 양반: 지배층\n- 중인: 기술직');
  assert.strictEqual(r.turns[1].prompt, '중인을 더 자세히');
  assert.strictEqual(r.turns[1].response, '중인은 역관, 의관 등 전문직 계층입니다.');
  assert.deepStrictEqual(r.notes, []);
});

test('영어 UI 복사본: You said / ChatGPT said (콜론 있음·없음 모두)', () => {
  const withColon = 'You said:\nExplain photosynthesis\nChatGPT said:\nPlants convert light into energy.\nYou said:\nShorter\nChatGPT said:\nLight to sugar.';
  const r1 = parse(withColon);
  assert.strictEqual(r1.ok, true);
  assert.deepStrictEqual(r1.turns, [
    { prompt: 'Explain photosynthesis', response: 'Plants convert light into energy.' },
    { prompt: 'Shorter', response: 'Light to sugar.' },
  ]);
  // 콜론 없이 표지만 한 줄에 있는 형태(추정)도 받는다
  const r2 = parse('You said\nHello\nGemini said\nHi there');
  assert.deepStrictEqual(r2.turns, [{ prompt: 'Hello', response: 'Hi there' }]);
});

test('두 서비스 형식이 섞여도 하나의 흐름으로 읽는다', () => {
  const text = [
    '나의 말:', '첫 질문', 'ChatGPT의 말:', '첫 답',
    'Human: 둘째 질문', 'Claude: 둘째 답',
    'You said:', 'third question', 'Gemini said:', 'third answer',
  ].join('\n');
  const r = parse(text);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.turns, [
    { prompt: '첫 질문', response: '첫 답' },
    { prompt: '둘째 질문', response: '둘째 답' },
    { prompt: 'third question', response: 'third answer' },
  ]);
});

test('표지와 같은 줄에 본문이 오는 경우', () => {
  const r = parse('User: 서론을 써줘\nAssistant: 서론 초안입니다.\n둘째 줄도 응답입니다.\nUser: 고마워\nAssistant: 천만에요');
  assert.deepStrictEqual(r.turns, [
    { prompt: '서론을 써줘', response: '서론 초안입니다.\n둘째 줄도 응답입니다.' },
    { prompt: '고마워', response: '천만에요' },
  ]);
});

test('같은 역할이 연속되면 하나로 합친다', () => {
  const r = parse('User: 질문 하나\nUser: 질문 둘\nAI: 답 하나\nAI: 답 둘\n사용자\n다음 질문\nAI: 마지막 답');
  assert.strictEqual(r.turns.length, 2);
  assert.strictEqual(r.turns[0].prompt, '질문 하나\n\n질문 둘');
  assert.strictEqual(r.turns[0].response, '답 하나\n\n답 둘');
  assert.deepStrictEqual(r.turns[1], { prompt: '다음 질문', response: '마지막 답' });
});

test('표지가 없으면 ok:false, 전체를 하나의 응답으로 보존하고 사유를 남긴다', () => {
  const r = parse('  그냥 복사한 글입니다.\n표지가 없습니다.  ');
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.turns, [{ prompt: '', response: '그냥 복사한 글입니다.\n표지가 없습니다.' }]);
  assert.ok(r.notes.length >= 1);
  assert.ok(r.notes.every((n) => typeof n === 'string' && n.length > 0));
  assert.match(r.notes[0], /표지/);
});

test('빈 문자열·공백·문자열이 아닌 입력은 ok:false이고 예외가 없다', () => {
  for (const v of ['', '   \n\t \r\n', null, undefined, 42, {}, ['User: a'], true]) {
    const r = parse(v);
    assert.strictEqual(r.ok, false, String(v));
    assert.deepStrictEqual(r.turns, [], String(v));
    assert.ok(r.notes.length >= 1);
  }
});

test('앞쪽 제목·안내 문구는 버리고 알려 준다', () => {
  const r = parse('ChatGPT 공유 대화\n2025년 3월 2일\n\n나의 말:\n질문\nChatGPT의 말:\n답');
  assert.deepStrictEqual(r.turns, [{ prompt: '질문', response: '답' }]);
  assert.ok(r.notes.some((n) => /버렸/.test(n)));
  assert.ok(!r.turns[0].prompt.includes('공유 대화'));
});

test('이름만 있는 머리글 줄(ChatGPT, Claude)은 표지가 아니다', () => {
  const r = parse('ChatGPT\n공유된 대화\nUser: 질문\nAssistant: 답');
  assert.deepStrictEqual(r.turns, [{ prompt: '질문', response: '답' }]);
});

test('응답 없이 질문만 있는 마지막 턴도 보존한다', () => {
  const r = parse('Q: 첫 질문\nA: 첫 답\nQ: 아직 답이 없는 질문');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.turns, [
    { prompt: '첫 질문', response: '첫 답' },
    { prompt: '아직 답이 없는 질문', response: '' },
  ]);
  assert.ok(r.notes.some((n) => /응답이 없어/.test(n)));
});

test('Windows 줄바꿈(CRLF)과 옛 Mac 줄바꿈(CR)', () => {
  const crlf = parse('나의 말:\r\n질문\r\n\r\nChatGPT의 말:\r\n답\r\n둘째 줄\r\n');
  assert.deepStrictEqual(crlf.turns, [{ prompt: '질문', response: '답\n둘째 줄' }]);
  assert.ok(!JSON.stringify(crlf).includes('\\r'));
  const cr = parse('User: a\rAssistant: b');
  assert.deepStrictEqual(cr.turns, [{ prompt: 'a', response: 'b' }]);
});

test('대소문자, 전각 콜론, 콜론 앞 공백, 앞뒤 공백', () => {
  const r = parse([
    '  YOU SAID：', '  질문 하나  ',
    '\tchatgpt said :', '답 하나',
    'user：질문 둘',
    '나의 말 :  질문 셋',
    '  ASSISTANT:   답 둘   ',
  ].join('\n'));
  assert.deepStrictEqual(r.turns, [
    { prompt: '질문 하나', response: '답 하나' },
    { prompt: '질문 둘\n\n질문 셋', response: '답 둘' },
  ]);
});

test('마크다운 장식이 붙은 표지(**User:**, ## Assistant)와 본문 속 굵게 표시', () => {
  const r = parse('**User:** 이 부분은 **중요** 합니다\n## Assistant\n네.\n**You said:**\n다음\n__ChatGPT said__:\n끝');
  assert.deepStrictEqual(r.turns, [
    { prompt: '이 부분은 **중요** 합니다', response: '네.' },
    { prompt: '다음', response: '끝' },
  ]);
});

test('표지 뒤 본문의 빈 줄·목록·코드는 그대로 두고 바깥 공백만 지운다', () => {
  const body = '첫 문단\n\n    들여쓴 코드\n- 목록\n\n마지막';
  const r = parse('User: 질문\n\n\nAssistant:\n\n\n' + body + '\n\n\n');
  assert.strictEqual(r.turns[0].response, body);
});

test('보이지 않는 문자(BOM, 영폭 공백)가 표지를 가리지 않는다', () => {
  const r = parse('\ufeffUser:\u200b 질문\nAssistant:\u2060 답');
  assert.deepStrictEqual(r.turns, [{ prompt: '질문', response: '답' }]);
});

test('본문이 빈 표지는 건너뛰고, 첫 발화가 AI인 대화는 prompt가 빈 턴이 된다', () => {
  const empty = parse('You said:\n\nChatGPT said:\n답만 있음\nYou said:\n질문');
  assert.strictEqual(empty.ok, true);
  assert.deepStrictEqual(empty.turns, [{ prompt: '', response: '답만 있음' }, { prompt: '질문', response: '' }]);
  assert.ok(empty.notes.some((n) => /빈 표지 1개/.test(n)));
  const onlyMarkers = parse('User:\nAssistant:');
  assert.strictEqual(onlyMarkers.ok, false);
  assert.deepStrictEqual(onlyMarkers.turns, []);
});

test('한쪽 역할 표지만 있으면 ok:true이되 알려 준다', () => {
  const onlyUser = parse('User: 질문 하나\nUser: 질문 둘');
  assert.strictEqual(onlyUser.ok, true);
  assert.deepStrictEqual(onlyUser.turns, [{ prompt: '질문 하나\n\n질문 둘', response: '' }]);
  assert.ok(onlyUser.notes.some((n) => /AI 응답 표지/.test(n)));
  const onlyAi = parse('AI: 답 하나\nAI: 답 둘');
  assert.deepStrictEqual(onlyAi.turns, [{ prompt: '', response: '답 하나\n\n답 둘' }]);
  assert.ok(onlyAi.notes.some((n) => /사용자 질문 표지/.test(n)));
});

test('Q:/A: 만 있는 대화는 Q:/A: 로 나눈다', () => {
  const r = parse('Q: 서론은?\nA: 이렇게 씁니다.\nQ: 결론은?\nA: 이렇게 씁니다.');
  assert.strictEqual(r.turns.length, 2);
  assert.strictEqual(r.turns[1].prompt, '결론은?');
});

test('본문 속 "Q: 이 질문은..." 인용: 서비스 표지가 있으면 Q:/A: 는 본문으로 남는다', () => {
  const text = [
    'You said:', 'FAQ 예시를 써줘',
    'ChatGPT said:', '다음은 예시입니다.', 'Q: 이 질문은 자주 나옵니다.', 'A: 이렇게 답하면 됩니다.',
    'You said:', '고마워',
    'ChatGPT said:', '천만에요.',
  ].join('\n');
  const r = parse(text);
  assert.strictEqual(r.turns.length, 2);
  assert.ok(r.turns[0].response.includes('Q: 이 질문은 자주 나옵니다.'));
  assert.ok(r.turns[0].response.includes('A: 이렇게 답하면 됩니다.'));
  assert.deepStrictEqual(r.turns[1], { prompt: '고마워', response: '천만에요.' });
});

test('줄 중간·인용(>)·목록(*) 안의 표지 모양 문장은 표지가 아니다', () => {
  const text = [
    'User: 질문입니다',
    'Assistant: 설명합니다. 예를 들어 User: 라고 쓰면 됩니다.',
    '> Q: 인용된 질문',
    '* User: 목록 항목',
    '1. Assistant: 번호 목록',
    'The AI: said nothing',
    '사용자는 중요합니다',
    'AI는 도구입니다',
  ].join('\n');
  const r = parse(text);
  assert.strictEqual(r.turns.length, 1);
  assert.strictEqual(r.turns[0].prompt, '질문입니다');
  for (const s of ['> Q: 인용된 질문', '* User: 목록 항목', '1. Assistant: 번호 목록', 'The AI: said nothing', 'AI는 도구입니다']) {
    assert.ok(r.turns[0].response.includes(s), s);
  }
});

test('한계: 본문 속 예시 대화가 줄 맨 앞 "User:/Assistant:"이면 실제 턴과 구분하지 못한다', () => {
  // 실제로는 한 턴(질문 1 + 예시 대화를 담은 응답 1)이지만, 줄 모양만으로는 같은 형식이라 4개 발화로 읽힌다.
  const text = 'User: 대화 예시를 보여줘\nAssistant: 다음은 예시입니다.\nUser: 안녕하세요\nAssistant: 안녕하세요, 무엇을 도와드릴까요?';
  const r = parse(text);
  assert.strictEqual(r.turns.length, 2); // 의도한 구조(1턴)가 아니다. 알려진 한계.
  assert.strictEqual(r.turns[1].prompt, '안녕하세요');
});

test('수백 KB 입력도 빠르게 처리한다', () => {
  const unit = (i) => `You said:\n질문 ${i} ${'가'.repeat(80)}\nChatGPT said:\n답변 ${i} ${'나'.repeat(120)}\n\n`;
  let text = '';
  for (let i = 0; i < 3000; i++) text += unit(i);
  assert.ok(text.length > 500000);
  const t0 = process.hrtime.bigint();
  const r = parse(text);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.turns.length, 3000);
  assert.ok(r.turns[2999].response.startsWith('답변 2999'));
  assert.ok(ms < 1500, `처리 시간 ${ms}ms`);
});

test('정규식이 느려질 만한 입력(긴 공백·긴 한 줄·표지만 수십만 줄)도 빠르다', () => {
  const inputs = [
    'User' + ' '.repeat(500000) + 'x',
    'User' + ' '.repeat(500000) + ':',
    '\n'.repeat(300000),
    'Q:\n'.repeat(150000),
    'User: ' + 'a'.repeat(500000),
    '가'.repeat(500000),
    '**'.repeat(250000) + 'User:',
    '#'.repeat(300000) + ' User:',
    '나의 말' + '\u3000'.repeat(300000),
  ];
  for (const input of inputs) {
    const t0 = process.hrtime.bigint();
    const r = parse(input);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.strictEqual(typeof r.ok, 'boolean');
    assert.ok(ms < 1500, `처리 시간 ${ms}ms: ${input.slice(0, 12)}`);
  }
  const t0 = process.hrtime.bigint();
  detect('https://example.com/' + 'a'.repeat(1900));
  detect('a'.repeat(1000000));
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 500);
});

test('아무 문자열이나 넣어도 예외 없이 계약된 모양을 돌려준다 (고정 시드 무작위 입력)', () => {
  let seed = 20251016;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pieces = ['User:', 'You said', 'ChatGPT의 말', '나의 말：', 'Q:', 'A:', 'AI', '**', '##', '\n', '\r\n', ' ', '\t', '본문', 'text', '\u200b', '：', ':', '> ', '* ', '\u3000'];
  for (let n = 0; n < 400; n++) {
    let s = '';
    const len = rnd(40);
    for (let i = 0; i < len; i++) s += pieces[rnd(pieces.length)];
    const r = parse(s);
    assert.strictEqual(typeof r.ok, 'boolean');
    assert.ok(Array.isArray(r.turns) && Array.isArray(r.notes));
    for (const t of r.turns) {
      assert.deepStrictEqual(Object.keys(t).sort(), ['prompt', 'response']);
      assert.strictEqual(typeof t.prompt, 'string');
      assert.strictEqual(typeof t.response, 'string');
      assert.ok(t.prompt.length + t.response.length > 0);
    }
    if (r.ok) assert.ok(r.turns.length > 0);
    assert.deepStrictEqual(parse(s), r); // 결정적
  }
});

// 실제 Gemini 대화를 Chrome 154에서 Ctrl+P로 저장한 PDF(2026-10-16)에서 관찰한 구조를 따른다.
// 내용은 지어낸 것이다. 제목 줄과 대화 URL 줄이 앞에 오고, 표지는 한국어 화면에서도 영어("User prompt:", "Response:")이며
// 표지 뒤 같은 줄에 본문이 이어진다. 확인한 것은 한 턴짜리 파일뿐이라 여러 턴의 모양은 모른다.
test('실제 Gemini 인쇄 PDF 구조: User prompt / Response', () => {
  const text = [
    '도서관 이용 안내',
    'https://gemini.google.com/app/0000000000000000',
    '',
    'User prompt: 도서관 대출 규정을 알려줘',
    '',
    'Response: 요청하신 규정의 주요 내용은 다음과 같습니다.',
    '',
    '대출 기간',
    '',
    '일반 도서는 14일 동안 대출할 수 있습니다.',
  ].join('\n');
  const r = Parse.parseTranscript(text);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.turns.length, 1);
  assert.strictEqual(r.turns[0].prompt, '도서관 대출 규정을 알려줘');
  assert.match(r.turns[0].response, /^요청하신 규정의 주요 내용은/);
  assert.match(r.turns[0].response, /14일 동안 대출/);
  assert.ok(!r.turns[0].response.includes('gemini.google.com'));
});

test('Gemini 형식: 여러 턴이 이어지는 경우 턴별로 나뉜다 (여러 턴 모양은 추정)', () => {
  const text = [
    'User prompt: 첫 질문', 'Response: 첫 답변',
    'User prompt: 두 번째 질문', 'Response: 두 번째 답변',
  ].join('\n');
  const r = Parse.parseTranscript(text);
  assert.deepStrictEqual(r.turns.map((t) => [t.prompt, t.response]), [['첫 질문', '첫 답변'], ['두 번째 질문', '두 번째 답변']]);
});
