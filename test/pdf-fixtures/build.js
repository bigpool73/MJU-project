'use strict';
/**
 * 테스트용 PDF 생성기: node test/pdf-fixtures/build.js
 * Playwright Chromium 의 page.pdf() 로 만든다. 결과(.pdf)와 기대값(manifest.json)을 이 폴더에 쓴다.
 *
 * 중요한 한계: 아래 HTML 은 실제 서비스 화면을 베낀 것이 아니라 "있을 법한 모양"을 모사한 것이다. 내용은 모두 지어낸 글이다.
 *  - 'chatgpt-real-style', 'gemini-real-style' 은 2026-10-16 에 확보한 실제 Chrome 154 인쇄 PDF 두 건(Gemini 1건, ChatGPT 1건,
 *    둘 다 한국어 화면)에서 관찰한 구조만 옮긴 것이다: 머리글(날짜+제목)·바닥글(URL+n/m), 표지 문구와 위치, 도형 글머리, 오른쪽으로 치우친 사용자 블록.
 *    원본 파일과 그 내용은 저장소에 없다.
 *  - 'a-ko-labels'("나의 말:", "ChatGPT의 말:"), 'a-en-labels'("You said:", "ChatGPT said:") 의 표지 문구는 실제 PDF에서 확인하지 못한 가정이다.
 *  - Claude 등 그 밖의 서비스와 영어 화면의 실제 인쇄 PDF는 확인하지 못했다.
 * 이 환경의 headless Chromium 이 만드는 PDF는 실제 Windows Chrome 의 PDF와 글꼴(WenQuanYi Zen Hei 대체)이 다르다.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OUT = __dirname;
const PW_PATHS = [process.env.PLAYWRIGHT_DIR, '/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node-tools/node_modules'].filter(Boolean);
function loadPlaywright() {
  const errs = [];
  for (const p of PW_PATHS) {
    try { return require(require.resolve('playwright', { paths: [p] })); } catch (e) { errs.push(p); }
  }
  throw new Error('playwright 를 찾지 못했습니다. 탐색 경로: ' + errs.join(', '));
}
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = '"WenQuanYi Zen Hei","Liberation Sans",sans-serif';
const MONO = '"DejaVu Sans Mono","Liberation Mono",monospace';

/* ───────────────────────── 지어낸 내용 ───────────────────────── */

const KO = {
  q1: '대학 동아리 축제 부스를 운영하려고 해. 준비 순서를 알려줘.',
  a1: [
    '축제 부스를 준비할 때는 먼저 목적과 예산을 정하고, 그다음에 역할을 나누는 순서로 진행하면 좋습니다. 처음부터 모든 것을 한꺼번에 정하려고 하면 일정이 밀리기 쉬우므로 단계별로 확인하는 것이 안전합니다.',
    '부스의 주제는 방문객이 짧은 시간에 이해할 수 있어야 합니다. 설명이 길어지면 대기 줄이 늘어나고 참여율이 떨어지기 때문에, 한 문장으로 소개할 수 있는 체험 활동을 중심으로 구성하는 것이 좋습니다.',
    '예산은 재료비, 대여료, 홍보물 제작비로 나누어 기록해 두세요. 행사 직전에 급하게 구입하면 가격이 오르는 경우가 많으니 최소 2주 전에는 구매 목록을 확정해야 합니다.',
    '마지막으로 행사 당일의 동선을 미리 그려 보면 좋습니다. 입구, 체험 공간, 정산 공간을 분리하면 혼잡을 줄일 수 있고 안전 문제도 예방할 수 있습니다.',
  ],
  q2: '예산 기록은 어떤 형식으로 하면 좋을까?',
  a2: [
    '간단한 표로 항목, 예상 금액, 실제 금액, 담당자를 적어 두면 충분합니다. 영수증은 사진으로 남기고 파일 이름에 날짜를 넣으면 나중에 정산할 때 찾기 쉽습니다.',
    '정산이 끝나면 예상 금액과 실제 금액의 차이를 계산해서 다음 행사의 기준으로 삼으세요. 차이가 큰 항목은 원인을 한 줄로 적어 두는 것이 도움이 됩니다.',
  ],
  q3: '홍보는 어떻게 하는 게 효과적이야?',
  a3: [
    '홍보는 행사 일주일 전부터 시작하되, 학교 게시판과 소셜 미디어를 함께 쓰는 것이 좋습니다. 포스터에는 날짜, 장소, 체험 내용을 한눈에 볼 수 있게 담아야 합니다.',
  ],
};

const EN = {
  q1: 'Can you explain how a binary search works and when I should use it?',
  a1: [
    'Binary search finds a target value in a sorted list by repeatedly halving the search range. Each comparison with the middle element lets you discard half of the remaining candidates, so the number of steps grows only logarithmically with the size of the list.',
    'You should use it when the data is already sorted and random access is cheap. For a small list, a simple linear scan is often just as fast, and it is much easier to get right, so the well-known advantage of binary search only matters at larger sizes.',
    'A common mistake is computing the midpoint carelessly, which can overflow in languages with fixed-size integers. Another is updating the bounds incorrectly, which produces an infinite loop on some inputs. A state-of-the-art library routine avoids both problems, so prefer it in production code.',
  ],
  q2: 'What is the time complexity?',
  a2: [
    'The time complexity is O(log n) comparisons in the worst case and O(1) extra memory for the iterative version. The recursive version uses O(log n) stack space, which is rarely a concern in practice.',
  ],
};

const REPORT = {
  title: '지역 도서관 이용 활성화 방안에 관한 연구',
  author: '가상대학교 사회학과 홍길동 (학번 20260000)',
  sections: [
    ['1. 서론', [
      '최근 지역 도서관의 이용률이 감소하는 추세에 대한 우려가 커지고 있다. 이 연구는 이용자 설문과 면담을 바탕으로 이용 활성화 방안을 제시하는 것을 목적으로 한다.',
      '연구의 범위는 가상의 A시에 있는 공공도서관 세 곳으로 한정하였다. 따라서 결과를 다른 지역에 그대로 적용하는 데에는 한계가 있다.',
    ]],
    ['2. 연구 방법', [
      '설문은 2026년 3월부터 4월까지 두 달 동안 진행하였으며, 응답자는 모두 120명이다. 면담은 사서와 이용자를 각각 다섯 명씩 선정하여 진행하였다.',
      '수집한 자료는 빈도 분석과 주제 분석으로 정리하였다. 면담 내용은 동의를 받은 뒤 기록하였고, 개인을 식별할 수 있는 정보는 제외하였다.',
    ]],
    ['3. 결과 및 논의', [
      '응답자의 과반수는 운영 시간이 생활 방식과 맞지 않는다고 답하였다. 특히 직장인과 학생은 저녁 시간의 운영 연장을 가장 많이 요구하였다.',
      '한편 프로그램에 대한 인지도는 낮은 편이었다. 홍보 채널을 다양화하고 이용자가 직접 참여하는 프로그램을 늘리는 것이 필요하다고 판단된다.',
      '이러한 결과는 선행 연구와 대체로 일치한다. 다만 표본의 크기가 작아 일반화하기에는 신중할 필요가 있다.',
    ]],
    ['4. 결론', [
      '본 연구는 운영 시간의 조정과 홍보 방식의 개선이 이용 활성화에 중요하다는 점을 확인하였다. 후속 연구에서는 표본을 넓혀 결과를 검증할 필요가 있다.',
    ]],
  ],
  refs: ['김가상, 이예시. (2024). 공공도서관 이용 행태 분석. 가상정보학회지, 12(3), 45-67.', '박모의. (2025). 지역 문화시설의 접근성 연구. 가상문화연구, 8(1), 101-120.'],
};

const MIXED = [
  '인공지능이 만든 글을 그대로 제출하는 것과 참고하여 자기 말로 다시 쓰는 것은 서로 다른 일이며, 그 차이를 스스로 설명할 수 있어야 한다는 점이 이번 수업에서 가장 중요하게 다뤄졌습니다.',
  'API를 호출할 때는 JSON 형식으로 응답을 받고, 응답 코드가 200이 아니면 재시도 로직(retry logic)을 실행합니다.',
  '프로젝트 일정은 ①요구 사항 정리 ②설계 ③구현 ④시험 순서로 진행하며, 각 단계가 끝날 때마다 팀원들과 검토 회의를 합니다.',
  '발표 연습을 하다가 너무 긴장해서 ㅋㅋㅋ 웃음이 나왔지만 😀 끝까지 잘 마쳤고 👍 교수님께서도 칭찬해 주셨습니다.',
  '이 문장은 한글과 English words가 섞여 있고, 숫자 2026과 기호 (괄호), "따옴표", 그리고 하이픈-연결어도 포함합니다.',
];

/* ───────────────────────── HTML 조각 ───────────────────────── */

const para = (t) => `<p>${esc(t)}</p>`;
function baseCss(extra) {
  return `<style>
  html,body{margin:0;padding:0}
  body{font-family:${FONT};font-size:11pt;line-height:1.5;color:#111}
  p{margin:0 0 9pt}
  .keep{word-break:keep-all}
  ${extra || ''}
  </style>`;
}
const doc = (title, css, body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>${baseCss(css)}</head><body>${body}</body></html>`;

/* ChatGPT 모양: 표지는 단독 줄, 사용자는 오른쪽으로 치우친 블록 */
function chatgptLike(opts) {
  const o = Object.assign({ userLabel: '내가 한 말:', aiLabel: 'ChatGPT 답변:', keep: true }, opts);
  const css = `.role{font-size:9pt;font-weight:bold;margin:14pt 0 6pt}
  .user{margin-left:163pt;width:320pt}
  .imgph{margin-left:163pt;width:200pt;height:70pt;margin-bottom:8pt}
  h4{font-size:12.9pt;margin:14pt 0 6pt}
  .num{font-weight:bold;margin:0 0 4pt}
  ul{margin:0 0 9pt;padding-left:34pt} li{margin:0}
  ul.loose li{margin-bottom:6pt}
  `;
  const cls = o.keep ? ' class="keep"' : '';
  return { css, cls, o };
}

/* 이미지(PNG, base64): 사용자가 첨부한 그림 자리 */
let IMG_DATA = '';

/* ───────────────────────── 픽스처 정의 ───────────────────────── */

function fixtures() {
  const list = [];
  const add = (f) => list.push(f);
  const flat = (a) => a.join(' ');

  /* (a) 역할 표지가 글자로 있는 대화 (표지 문구는 가정) */
  const labelled = (name, lang, userLabel, aiLabel, data, turns) => {
    const body = turns.map(([q, as]) => `<div class="role">${esc(userLabel)}</div><p>${esc(q)}</p><div class="role">${esc(aiLabel)}</div>${as.map(para).join('')}`).join('');
    add({
      name, hf: 'both', kind: 'chat', provider: 'chatgpt', exactSpaces: true,
      pdfOptions: { width: '210mm', height: '110mm' },
      html: doc(lang === 'ko' ? '대화 기록 사본' : 'Conversation copy', '.role{font-weight:bold;margin:12pt 0 4pt}', `<div class="keep">${body}</div>`),
      expect: { turns: turns.map(([q, as]) => ({ prompt: q, response: flat(as) })), parsed: 'ok' },
    });
  };
  labelled('a-ko-labels', 'ko', '나의 말:', 'ChatGPT의 말:', KO, [[KO.q1, KO.a1], [KO.q2, KO.a2], [KO.q3, KO.a3]]);
  labelled('a-en-labels', 'en', 'You said:', 'ChatGPT said:', EN, [[EN.q1, EN.a1], [EN.q2, EN.a2]]);

  /* ChatGPT 실제 구조 모사 (내용은 지어낸 글, 줄바꿈은 브라우저 기본 = 글자 중간에서도 끊김) */
  {
    const c = chatgptLike();
    const aiList = ['부스 이름과 한 줄 소개를 정한다', '체험 활동은 두 가지 이내로 줄인다', '예산표를 만들고 담당자를 적는다', '방문객이 줄을 서는 방향을 표시한다', '행사가 끝난 뒤 정산과 회고를 진행한다.'];
    const edited1 = '동아리 축제 부스를 하려는데 준비 순서 좀 알려줘.';
    const edited2 = '대학 동아리 축제 부스를 운영하려고 해. 준비 순서와 주의할 점을 알려줘.';
    const body = `
      <div class="role">${c.o.userLabel}</div>
      <img class="imgph" src="${IMG_DATA}">
      <div class="user"><p>${esc(edited1)}</p></div>
      <div class="role">${c.o.userLabel}</div>
      <div class="user"><p>${esc(edited2)}</p></div>
      <div class="role">${c.o.aiLabel}</div>
      <p>${esc(KO.a1[0])}</p>
      <h4>부스 준비 체크리스트</h4>
      <p>${esc(KO.a1[1])}</p>
      <div class="num">1. 기본 계획 세우기</div>
      <ul><li>${esc(aiList[0])}</li><li>${esc(aiList[1])}</li><li>${esc(aiList[2])}</li><li>${esc(aiList[3])}</li><li>${esc(aiList[4])}</li></ul>
      <div class="num">2. 예산 관리</div>
      <p>${esc(KO.a1[2])}</p>
      <p>**“영수증은 사진으로 남기기”**를 규칙으로 정하면 정산이 쉬워집니다.</p>
      <ul class="loose"><li>${esc('재료비는 행사 2주 전에 확정한다')}</li><li>${esc('대여료는 취소 규정을 먼저 확인한다')}</li></ul>
      <p>${esc(KO.a1[3])}</p>
      <div class="role">${c.o.userLabel}</div>
      <div class="user"><p>${esc(KO.q2)}</p></div>
      <div class="role">${c.o.aiLabel}</div>
      ${KO.a2.map(para).join('')}`;
    add({
      name: 'chatgpt-real-style', hf: 'both', kind: 'chat', provider: 'chatgpt', exactSpaces: false, realStyleChatGPT: true,
      pdfOptions: { width: '210mm', height: '150mm' },
      html: doc('동아리 부스 준비 대화', c.css, body),
      expect: {
        // 수정 전·후 질문이 연달아 나오면 Parse 가 같은 역할로 합친다(parse.js 담당 처리). 여기서는 턴 수와 AI 응답 글자만 본다.
        turnsMin: 2, userTextsPresent: [edited2, KO.q2], textHas: [edited1, edited2],
        responseParagraphs: [KO.a1[0], KO.a1[1], KO.a1[2], KO.a1[3], ...KO.a2],
        listItems: aiList, keepLiteral: ['**“영수증은 사진으로 남기기”**'],
        headings: ['부스 준비 체크리스트'],
      },
    });
  }

  /* Gemini 실제 구조 모사: 큰 제목 + URL, 같은 줄 표지, 도형 글머리, 넓은 항목 간격 */
  {
    const css = `h1{font-size:18pt;margin:0 0 4pt;font-weight:bold}
    .url{font-size:9.7pt;margin:0 0 14pt}
    .prompt{font-style:italic;margin:0 0 14pt}
    .h{font-weight:bold;margin:0 0 12pt}
    ul{margin:0 0 12pt;padding-left:30pt} li{margin:0 0 12pt}
    ul ul{margin-top:12pt;padding-left:30pt}
    body{font-size:12pt;line-height:1.31}
    .rule{position:fixed;left:0;right:0;bottom:6mm;border-top:1px solid #bbb}`;
    const exam = [
      '시험 형식: 교수님과 진행하는 짧은 대화 형식의 발표 시험입니다.',
      '시험 범위: 교재의 제1장부터 제3장까지입니다.',
      '제한 시간: 총 5분이며 초과하면 감점됩니다.',
    ];
    const sub = [
      '교수님이 각 장에서 하나씩 질문을 던집니다.',
      '학생은 두세 문장으로 대답해야 하며, 이어지는 후속 질문에도 관련 내용을 덧붙여 대답해야 합니다.',
    ];
    const rules = [
      '지각: 예약된 시간에 늦을 경우 점수가 감점됩니다.',
      '준비물: 휴대폰의 전원이 꺼져 있거나 사용하지 않더라도 교실에 반입하는 즉시 감점되니 미리 맡겨 두어야 합니다.',
      '결석: 시험에 결석하면 0점 처리되며 재시험은 불가합니다.',
    ];
    const resp1 = '요청하신 파일에 명시된 발표 시험에 대한 주요 정보는 다음과 같습니다. 아래 내용은 안내문에 적힌 대로 정리한 것입니다.';
    const q1 = '가상 수업 발표 시험에 대해 알려줘';
    const body = `<div class="rule"></div>
      <h1>가상 수업 발표 시험 안내</h1>
      <div class="url">https://gemini.example.invalid/app/0fed98e30f5789d3</div>
      <div class="prompt">User prompt: ${esc(q1)}</div>
      <p>Response: ${esc(resp1)}</p>
      <div class="h">시험 개요</div>
      <ul>${exam.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="h">시험 진행 방식</div>
      <ul><li>${esc('Part A (교수님이 질문하고 학생이 대답):')}<ul>${sub.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></li></ul>
      <div class="h">시험 규칙 및 감점 사항</div>
      <ul>${rules.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p>${esc('위 내용은 안내문의 일부이므로 정확한 기준은 공지를 다시 확인하시기 바랍니다.')}</p>`;
    add({
      name: 'gemini-real-style', hf: 'both', kind: 'chat', provider: 'gemini', exactSpaces: false, realStyleGemini: true,
      pdfOptions: { width: '210mm', height: '120mm' },
      html: doc('가상 수업 발표 시험 안내', css, body),
      expect: {
        turns: [{ prompt: q1, response: null }], parsed: 'ok',
        responseParagraphs: [resp1, ...exam, ...sub, ...rules, '위 내용은 안내문의 일부이므로 정확한 기준은 공지를 다시 확인하시기 바랍니다.'],
        headings: ['시험 개요', '시험 진행 방식', '시험 규칙 및 감점 사항'],
      },
    });
  }

  /* (b) 표지 없음, 말풍선(사용자는 오른쪽 정렬 회색 박스) */
  {
    const css = `.me{margin-left:35%;background:#e8e8e8;border-radius:8pt;padding:8pt 10pt;margin-bottom:12pt}
    .me p{margin:0}`;
    const turns = [[KO.q1, KO.a1], [KO.q2, KO.a2]];
    const body = `<div class="keep">${turns.map(([q, as]) => `<div class="me"><p>${esc(q)}</p></div>${as.map(para).join('')}`).join('')}</div>`;
    add({
      name: 'b-bubbles', hf: 'both', kind: 'chat', provider: 'other', exactSpaces: true,
      pdfOptions: { width: '210mm', height: '110mm' },
      html: doc('말풍선 대화', css, body),
      expect: { parsed: 'unparsed', allText: [KO.q1, ...KO.a1, KO.q2, ...KO.a2] },
    });
  }

  /* (c) 코드 블록·표·목록이 있는 긴 응답이 여러 쪽에 걸침 */
  {
    const code = [
      'def moving_average(values, window):',
      '    """이동 평균을 계산한다."""',
      '    result = []',
      '    for i in range(len(values)):',
      '        start = max(0, i - window + 1)',
      '        chunk = values[start:i + 1]',
      '        result.append(sum(chunk) / len(chunk))',
      '    return result',
      '',
      'data = [3, 5, 8, 13, 21, 34, 55]',
      'print(moving_average(data, 3))',
    ];
    const longCode = [];
    for (let k = 0; k < 4; k++) for (const l of code) longCode.push(l.replace('moving_average', 'moving_average' + (k ? k : '')));
    const tableRows = [['항목', '예상 금액', '담당자'], ['재료비', '120,000원', '김하나'], ['대여료', '80,000원', '이둘'], ['홍보물 제작', '45,000원', '박셋'], ['간식', '30,000원', '최넷'], ['예비비', '25,000원', '정다섯']];
    const intro = '아래는 이동 평균을 계산하는 예제와 예산 정리표입니다. 먼저 코드를 보고, 이어서 표와 목록을 확인해 주세요.';
    const bullets = ['데이터가 비어 있으면 빈 목록을 돌려준다', '창 크기가 데이터보다 크면 가능한 구간만 계산한다', '결과의 길이는 입력과 같다', '부동소수점 오차는 반올림으로 처리한다'];
    const outro = '정리하면, 이동 평균은 창 크기에 따라 변화가 부드러워지는 정도가 달라지므로 목적에 맞게 크기를 고르는 것이 중요합니다.';
    const css = `pre{font-family:${MONO};font-size:9.5pt;line-height:1.35;background:#f3f3f3;padding:8pt;margin:0 0 9pt;white-space:pre}
    table{border-collapse:collapse;margin:0 0 9pt} td,th{border:1px solid #888;padding:3pt 14pt;text-align:left}
    ul{margin:0 0 9pt;padding-left:30pt}`;
    const body = `<div class="keep"><div style="font-weight:bold;margin:0 0 6pt">나의 말:</div><p>이동 평균 예제와 예산 정리표를 보여줘.</p><div style="font-weight:bold;margin:0 0 6pt">ChatGPT의 말:</div>
      <p>${esc(intro)}</p>
      <pre>${esc(longCode.join('\n'))}</pre>
      <table>${tableRows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table>
      <ul>${bullets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p>${esc(outro)}</p></div>`;
    add({
      name: 'c-code-table-list', hf: 'both', kind: 'chat', provider: 'chatgpt', exactSpaces: true,
      pdfOptions: { width: '210mm', height: '120mm' },
      html: doc('코드와 표', css, body),
      expect: {
        parsed: 'ok', codeLines: longCode.filter(Boolean), tableRows: tableRows.map((r) => r.join(' | ')), listItems: bullets,
        responseParagraphs: [intro, outro],
      },
    });
  }

  /* (d) 문단이 쪽 경계에 걸림: 작은 쪽 크기로 경계를 자주 만든다 + 일부는 강제로 쪽 나눔 */
  {
    const koLong = KO.a1.concat(KO.a2);
    const enLong = EN.a1;
    const pA = '이 문단은 한 쪽의 맨 아래에서 끝나며 마침표로 마무리됩니다.';
    const pB = '이 문단은 다음 쪽의 맨 위에서 새로 시작하는 별개의 문단입니다.';
    const hd = '제목만 쪽 끝에 남는 경우';
    const pC = '제목 다음 쪽에 이어지는 본문이므로 제목과 합쳐지면 안 됩니다.';
    const body = `<div class="keep">${koLong.map(para).join('')}<p style="break-after:page">${esc(pA)}</p><p>${esc(pB)}</p>${enLong.map(para).join('')}<div style="font-weight:bold;font-size:13pt;break-after:page;margin:0 0 6pt">${esc(hd)}</div><p>${esc(pC)}</p>${koLong.map(para).join('')}</div>`;
    add({
      name: 'd-page-boundary', hf: 'both', kind: 'doc', provider: 'other', exactSpaces: true,
      pdfOptions: { width: '5.2in', height: '3.0in', margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' } },
      html: doc('쪽 경계 시험', 'body{font-size:10pt}', body),
      expect: { allParagraphs: [...koLong, pA, pB, ...enLong, pC], separate: [[pA, pB], [hd, pC]], minPages: 5 },
    });
  }

  /* (e) 한글 긴 문장, 한영 혼용, 이모지 */
  add({
    name: 'e-mixed', hf: 'both', kind: 'doc', provider: 'other', exactSpaces: true,
    html: doc('혼합 문장', '', `<div class="keep">${MIXED.map(para).join('')}</div>`),
    expect: { allParagraphs: MIXED, emojiInfo: ['😀', '👍', 'ㅋㅋㅋ', '①②③④'] },
  });

  /* (h) 과제 결과물: 제목 + 본문 보고서 */
  {
    const css = `h1{font-size:20pt;text-align:center;margin:0 0 6pt} .au{text-align:center;margin:0 0 20pt}
    h2{font-size:13pt;margin:14pt 0 6pt} p.ind{text-indent:1em;text-align:left;margin:0 0 9pt} .ref{margin:0 0 4pt;padding-left:1.5em;text-indent:-1.5em}`;
    const body = `<div class="keep"><h1>${esc(REPORT.title)}</h1><div class="au">${esc(REPORT.author)}</div>${REPORT.sections.map(([h, ps]) => `<h2>${esc(h)}</h2>${ps.map((t) => `<p class="ind">${esc(t)}</p>`).join('')}`).join('')}<h2>참고문헌</h2>${REPORT.refs.map((t) => `<div class="ref">${esc(t)}</div>`).join('')}</div>`;
    add({
      name: 'h-report', hf: 'both', kind: 'doc', provider: 'other', exactSpaces: true,
      pdfOptions: { width: '210mm', height: '150mm' },
      html: doc('보고서 사본', css, body),
      expect: { allParagraphs: REPORT.sections.flatMap(([, ps]) => ps), headings: [REPORT.title, ...REPORT.sections.map(([h]) => h)], refs: REPORT.refs },
    });
  }

  /* 기본 머리글/바닥글 템플릿(날짜·제목·URL·쪽번호)로 만든 문서: 견고성 확인용. 이 환경의 기본 템플릿은 일부 글리프가 빈 문자로 추출된다. */
  add({
    name: 'h-report-defaulthf', hf: 'default', kind: 'doc', provider: 'other', exactSpaces: true,
    html: doc('기본 템플릿 보고서', css0(), `<div class="keep">${REPORT.sections.flatMap(([h, ps]) => [`<h2>${esc(h)}</h2>`, ...ps.map(para)]).join('')}</div>`),
    expect: { allParagraphs: REPORT.sections.flatMap(([, ps]) => ps), noHeaderFooterText: ['기본 템플릿 보고서'] },
  });

  /* (f) 글자 없는 이미지 PDF (스캔본 모사): 글자를 그린 화면을 PNG 로 찍어 이미지로만 넣는다 */
  add({ name: 'f-scan', hf: false, kind: 'scan', provider: 'other', exactSpaces: true, html: null, expect: { ok: false } });

  return list;
}
const css0 = () => 'h2{font-size:13pt;margin:12pt 0 6pt}';

/* ───────────────────────── 실행 ───────────────────────── */

function hfTemplates(meta) {
  const css = 'font-size:10.7px;width:100%;padding:0 32px;display:flex;justify-content:space-between;font-family:' + FONT.replace(/"/g, "'");
  return {
    headerTemplate: `<div style="${css}"><span>${esc(meta.date)}</span><span>${esc(meta.title)}</span></div>`,
    footerTemplate: `<div style="${css}"><span>${esc(meta.url)}</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
  };
}

async function main() {
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--disable-background-networking'] });
  const manifest = { generatedBy: 'test/pdf-fixtures/build.js', note: '내용은 모두 지어낸 글이며 실제 서비스 화면을 베낀 것이 아니다.', fixtures: [] };

  // 그림 자리용 PNG
  {
    const p = await browser.newPage({ viewport: { width: 400, height: 140 } });
    await p.setContent('<body style="margin:0;background:linear-gradient(135deg,#9bd,#fd9)"></body>');
    IMG_DATA = 'data:image/png;base64,' + (await p.screenshot({ type: 'png' })).toString('base64');
    await p.close();
  }

  const margin = { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' };
  const hfMeta = (f) => {
    if (f.name.startsWith('gemini')) return { date: '26. 10. 16. 오후 4:57', title: '가상 수업 발표 시험 안내(사본)', url: 'https://gemini.example.invalid/app/0fed98e30f5789d3?hl=ko' };
    if (f.name.startsWith('chatgpt')) return { date: '26. 10. 16. 오후 5:00', title: '동아리 부스 준비 대화(사본)', url: 'https://chatgpt.example.invalid/c/6abda108-d0e4-83ee' };
    return { date: '26. 10. 16. 오후 3:12', title: '시험용 문서 사본', url: 'https://example.invalid/doc/abc123' };
  };

  async function render(file, html, pdfOptions, hf, meta) {
    const p = await browser.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    const opt = Object.assign({ format: 'A4', margin, printBackground: true }, pdfOptions || {});
    if (opt.width || opt.height) delete opt.format; // Playwright 는 format 이 있으면 width/height 를 무시한다
    if (hf === true) Object.assign(opt, { displayHeaderFooter: true }, hfTemplates(meta));
    else if (hf === 'default') Object.assign(opt, { displayHeaderFooter: true });
    else opt.displayHeaderFooter = false;
    const buf = await p.pdf(opt);
    await p.close();
    fs.writeFileSync(path.join(OUT, file), buf);
    return buf;
  }

  for (const f of fixtures()) {
    if (f.kind === 'scan') {
      const p = await browser.newPage({ viewport: { width: 760, height: 1000 } });
      await p.setContent(`<body style="margin:30px;font:20px/1.8 ${FONT}">${KO.a1.concat(KO.a2).map(para).join('')}</body>`);
      const png = (await p.screenshot({ type: 'png' })).toString('base64');
      await p.close();
      const imgs = [png, png].map((d) => `<div style="break-after:page"><img src="data:image/png;base64,${d}" style="width:100%"></div>`).join('');
      await render('f-scan.pdf', `<!doctype html><meta charset=utf-8><body style="margin:0">${imgs}</body>`, { margin: { top: '0', bottom: '0', left: '0', right: '0' } }, false);
      manifest.fixtures.push({ file: 'f-scan.pdf', name: f.name, kind: 'scan', hf: false, expect: f.expect });
      continue;
    }
    const meta = hfMeta(f);
    const variants = f.hf === 'both' ? [[true, ''], [false, '-nohf']] : [[f.hf, '']];
    for (const [hf, suffix] of variants) {
      const file = f.name + suffix + '.pdf';
      await render(file, f.html, f.pdfOptions, hf, meta);
      manifest.fixtures.push({
        file, name: f.name, kind: f.kind, hf, provider: f.provider, exactSpaces: f.exactSpaces, expect: f.expect,
        headerFooter: hf === true ? meta : null,
      });
    }
  }

  // (i) 100쪽
  {
    const pages = [];
    for (let n = 1; n <= 100; n++) {
      const marker = `이 문서의 ${n}번째 쪽 첫 문단입니다. 번호를 확인하기 위한 문장이며 내용은 가상입니다.`;
      const rest = KO.a1.concat(KO.a2).map(para).join('');
      pages.push(`<div style="break-after:page"><p>${esc(marker)}</p>${rest}</div>`);
    }
    await render('i-100pages.pdf', doc('백 쪽 문서', '', `<div class="keep">${pages.join('')}</div>`), {}, true, { date: '26. 10. 16. 오후 3:12', title: '백 쪽 시험 문서', url: 'https://example.invalid/doc/hundred' });
    manifest.fixtures.push({ file: 'i-100pages.pdf', name: 'i-100pages', kind: 'perf', hf: true, expect: { pages: 100, markers: [1, 50, 100] }, headerFooter: { date: '26. 10. 16. 오후 3:12', title: '백 쪽 시험 문서', url: 'https://example.invalid/doc/hundred' } });
  }

  await browser.close();

  /* (g) 손상·빈 파일·PDF 아님·암호화 */
  const good = fs.readFileSync(path.join(OUT, 'a-ko-labels.pdf'));
  fs.writeFileSync(path.join(OUT, 'g-truncated.pdf'), good.subarray(0, Math.floor(good.length * 0.55)));
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed & 255; };
  fs.writeFileSync(path.join(OUT, 'g-garbage.pdf'), Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(Array.from({ length: 4000 }, rnd))]));
  fs.writeFileSync(path.join(OUT, 'g-zero.pdf'), Buffer.alloc(0));
  fs.writeFileSync(path.join(OUT, 'g-notpdf.pdf'), '안녕하세요. 이 파일은 확장자만 pdf 이고 내용은 그냥 글입니다.\n', 'utf8');
  manifest.fixtures.push(
    { file: 'g-truncated.pdf', name: 'g-truncated', kind: 'bad', expect: { ok: false } },
    { file: 'g-garbage.pdf', name: 'g-garbage', kind: 'bad', expect: { ok: false } },
    { file: 'g-zero.pdf', name: 'g-zero', kind: 'bad', expect: { ok: false } },
    { file: 'g-notpdf.pdf', name: 'g-notpdf', kind: 'bad', expect: { ok: false } },
  );
  // 암호화: pypdf 가 있을 때만 새로 만든다. 없으면 저장소에 있는 기존 파일을 그대로 쓴다.
  const enc = spawnSync('python3', ['-I', '-c', [
    'import sys', 'from pypdf import PdfReader, PdfWriter',
    'r = PdfReader(sys.argv[1]); w = PdfWriter()',
    '[w.add_page(p) for p in r.pages]',
    'w.encrypt(user_password="secret", owner_password="owner", algorithm="RC4-128")',
    'w.write(sys.argv[2])',
  ].join('\n'), path.join(OUT, 'a-ko-labels.pdf'), path.join(OUT, 'g-encrypted.pdf')], { encoding: 'utf8' });
  if (enc.status !== 0) console.warn('암호화 PDF를 새로 만들지 못했습니다(pypdf 없음?). 기존 g-encrypted.pdf 를 유지합니다.', (enc.stderr || '').split('\n').slice(-3).join(' '));
  if (fs.existsSync(path.join(OUT, 'g-encrypted.pdf'))) manifest.fixtures.push({ file: 'g-encrypted.pdf', name: 'g-encrypted', kind: 'bad', expect: { ok: false, password: true } });

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('생성한 PDF:', manifest.fixtures.length + '개');
}

main().catch((e) => { console.error(e); process.exit(1); });
