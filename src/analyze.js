'use strict';
/**
 * analyze.js — 과제 본문과 AI 대화의 겹침 분석 (브라우저/Node 공용)
 * 계약은 docs/spec-v2.md. 형태소 분석기 없이 한글은 글자 2-gram, 영문은 단어(+인접 단어쌍)로 센다.
 * 모든 점수는 글자·단어 겹침에 기반한 추정이며, 난수·시간을 쓰지 않는다.
 */
(function (root) {
  const DELETE_THRESHOLD = 0.15;
  const HIGH_THRESHOLD = 0.30;
  const REFUSAL_MESSAGE = '해당 대화는 과제와 연관도가 높아, 삭제가 불가합니다.';
  const BAND_MID = 0.2;
  const BAND_HIGH = 0.5;

  // 문장 정렬 임계값은 test/fixtures 4벌(문장 57개)로 보정했다. 근거는 임계값 옆 한 줄.
  const VERBATIM_T = 0.80;   // 고쳐 쓴 문장 최대 0.67, 어미·한두 단어만 고친 문장 최소 0.87 → 그 사이
  const ADAPTED_T = 0.45;    // 고쳐 쓴 문장 최소 0.49 (직접 쓴 문장은 아래 MIN_MASS에서 이미 걸러진다)
  const ORIGIN_TIE = 0.05;   // 학생 원문(프롬프트)과 AI 응답 점수 차가 이 안이면 동률로 보고 먼저 나온 프롬프트를 출처로 본다
  // 우연한 일치를 막는 최소 증거. 거의 통째로 들어 있는(그대로) 경우만 더 짧은 문장을 인정한다.
  const MIN_STRONG = 5;      // 문장의 내용어 조각이 이보다 적으면 부분 겹침은 판단하지 않는다
  const MIN_SHARED = 4;
  const MIN_MASS = 4.3;      // 공유 가중치 합: 직접 쓴 문장 최대 3.86, 고쳐 쓴 문장 최소 4.68 → 그 사이
  const SHORT_STRONG = 3;
  const SHORT_SHARED = 3;
  const SHORT_MASS = 2;

  const REL_GAIN = 2.6;
  const REUSE_MIN = 0.45;    // 턴의 문장이 본문 문장에 이만큼 이상 들어 있으면 옮겨 쓴 것으로 보고 연관도의 바닥을 올린다
  const REUSE_CAP = 0.6;     // 옮겨 쓴 흔적만으로 올릴 수 있는 연관도의 상한: 주제어 점수가 더 높으면 그쪽이 순위를 가른다
  const REL_SMOOTH = 2;
  const WEAK = 0.35;
  const MIN_SENT = 8;        // 이보다 짧은 조각은 앞 문장에 붙인다 (글자·숫자 개수)
  const MAX_PIECE = 400;
  const MAX_TEXT = 200000;   // 한 프롬프트/응답에서 분석하는 최대 글자 수 (시간 상한)
  const POSTING_CAP = 300;
  const TOP_CAND = 8;
  const Q = 65536;           // 비율을 2^-16 격자에 맞춰 부동소수 오차 없이 합이 1이 되게 한다

  // ---------------------------------------------------------------- 어휘 자원
  const words = (s) => s.split(/\s+/).filter(Boolean);

  // 조사·어미에서 생기는 2-gram. 내용 정보가 없으므로 아예 뺀다.
  const KO_STOP = new Set(words(`
    니다 입니 합니 습니 됩니 있습 없습 겠습 었습 았습 였습 했습 했다 였다 었다 았다 겠다 한다 된다 있다 없다 이다 하다 되다 인다 는다 린다 진다 같다 않다
    아니 아닌 그렇 이렇 저렇 어떻 어떤 하는 되는 있는 없는 하고 되고 있고 없고 하며 되며 하여 되어 하게 되게 하지 되지 하기 되기 하면 되면
    않는 않은 않고 않아 있으 없으 있어 없어 해서 되서 해야 되야 해도
    에서 에는 에도 에게 에선 으로 으며 으나 로서 로써 까지 부터 처럼 보다 마다 이나 이란 이라 라는 라고 라며 이며 이고
    와의 과의 에의 로의 에만 도록 더라 라도 인데 은데 는데 지만 면서 으면 으니 니까 므로 려고 으려
    것이 것은 것을 것도 것에 것으 수는 수가 수를 수있 때문 문에 대한 대해 대하 통해 통한 통하 위해 위한 위하 관한 관해 관하 따른 따라 라서 에대 에따
    그리 리고 그러 러나 러므 그래 래서 그런 이런 저런 이를 이에 그를 그에 이와 그와 이는 그는 이가 그가 이도 그도 이로 그로 이것 그것 저것 이러 우리
    만약 만일 알려 려줘 해줘 써줘 줘요 주세 세요 부탁 탁해 해주 주실 실래 줄래 볼까 할까 될까 있을 을까 는지 인지 할지 을지 는가 인가
    해요 어요 아요 에요 예요 나요 까요 네요 군요 거든 잖아
    론적 적인 적이 뭐야 뭔가 뭘까 무엇 어디 언제 누구 얼마 하므 되므 하시 되시 다고 다는 다면 다가 다며 럽게 스럽 연스 럽다 함으 됨으 아진 어진 해진
    겠지 하겠 이었 하였 되었 하자 하도 하든 하던 들이 들은 들의 들을 들도 라면 거나 으면 보면 보니 싶은 싶다 싶어 같이 같은 같아 보인 보이 러한
  `));
  // 글쓰기·과제에서 어디서나 나오는 일반 어휘. 주제 판단에는 약하게만 쓴다.
  const KO_WEAK = new Set(words(`
    문제 경우 사용 이용 가능 필요 중요 방법 결과 과정 내용 관련 생각 다양 여러 하나 사람 사회 정도 부분 이상 현재 최근 기본 주요 대표 일반 전체
    정보 자료 분야 활동 목적 목표 효과 영향 변화 발전 증가 감소 제공 설명 소개 정리 분석 연구 조사 평가 수행 진행 구성 구조 기능 특징 장점 단점
    차이 비교 사례 예시 원인 대상 수준 상황 관계 역할 시간 의미 개념 이해 확인 선택 결정 판단 주장 근거 의견 입장 논리 관점 측면 요소 요인
    한편 또한 결론 서론 본론 마지막 먼저 우선 다음 이후 이전 동안 가장 매우 훨씬 더욱 계속 항상 대부분 일부 모든 각각 서로 스스 함께 이미 아직 다시
    바로 직접 실제 구체 자신 과제 보고 작성 제시 포함 정확 자세 간단 추가 도움 가지 관한 주제 방향 부족 개선 중심 기준 단계 형태 유형 종류
    이어 들어 걱정 수도 모두 어렵 정하 만들 만든 상태 모습 대로 아무 어떻 여기 거기 저기 오늘 요즘 지금 아주 정말 조금 많이 너무
  `));
  const EN_STOP = new Set(words(`
    a an the and or but if then else so as at by for from in into of on onto to with without within about above after again against all am are be been being before below
    between both can could did do does doing down during each few further had has have having he her here hers him his how i is it its itself just me more most my no nor not
    now off once only other our out over own same she should some such than that their theirs them there these they this those through too under until up very was we were
    what when where which while who whom why will would you your yours also may might must shall us via per vs etc however therefore thus hence moreover furthermore
    additionally though although whether yet still even much many any every another others else rather quite really don doesn didn isn aren wasn weren won wouldn couldn
    shouldn haven hasn hadn ll ve re
  `));
  const EN_WEAK_RAW = words(`
    use used using important different way ways make makes made making help helps helped provide provides provided example examples include includes including various
    several possible general generally overall often people one two three first second third new good great well like thing things time need needs needed get gets got want
    lot lots able case approach factor aspect issue impact effect result results role level number part form type kind
  `);

  /** dropping → dropp → drop (l·s·z·모음은 제외: falling → fall) */
  const undouble = (w) => (/([^aeiouls])\1$/.test(w) ? w.slice(0, -1) : w);

  function stem(w) {
    if (w.length <= 3 || (w.charCodeAt(0) >= 48 && w.charCodeAt(0) <= 57)) return w;
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (w.endsWith('ing') && w.length > 5) w = undouble(w.slice(0, -3));
    else if (w.endsWith('ed') && w.length > 4) w = undouble(w.slice(0, -2));
    else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    // 'cause'와 'causes/caused/causing'이 같은 어간이 되도록 끝의 e를 뗀다
    if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1);
    return w;
  }
  const EN_WEAK = new Set(EN_WEAK_RAW.map(stem));

  // 한글 단어 끝의 조사·어미. 어간이 2자 이상 남을 때만 떼어, '정도'·'결과' 같은 2자 단어는 건드리지 않는다.
  // 한 번에 하나씩 여러 번 떼므로('필요하다고' → '필요하다' → '필요하' → '필요') 목록은 짧은 형태소 위주다.
  const KO_SUFFIX = new Set(words(`
    에서는 에서도 에서의 으로는 으로도 으로의 으로써 으로서 에게는 에게도 이라는 이라고 이라도 이라면 이라서 입니다 합니다 됩니다 있습니다 없습니다 했습니다 였습니다 었습니다
    하였다 되었다 이었다 에서 에게 에는 에도 에의 으로 까지 부터 처럼 보다 마다 이라 라는 라고 이며 이고 이다 와의 과의 로의 로서 로써 이나 이든 에만 도록 으며 으면 습니다
    다 고 며 면 지 게 기 여 야 서 도 은 는 을 를 이 가 의 에 로 와 과 만 들 하 해 했 되 돼 됐 한 할 함 합 된 될 됨 던 듯
  `));
  const KO_SUFFIX_MAX = 4;
  const KO_PARTICLE = '은는이가을를의에도로와과만';

  function koStem(w) {
    for (let pass = 0; pass < 4 && w.length > 2; pass++) {
      let cut = 0;
      for (let len = Math.min(KO_SUFFIX_MAX, w.length - 2); len >= 1; len--) {
        if (KO_SUFFIX.has(w.slice(-len))) { cut = len; break; }
      }
      if (!cut) break;
      w = w.slice(0, -cut);
    }
    return w;
  }

  // ---------------------------------------------------------------- 정규화·토큰
  const jongseong = (ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 ? c % 28 : -1; };
  /** 서술어 어미에서 생기는 2-gram을 받침으로 일반화해 거른다: 한다·했다·된다(ㄴ/ㅆ+다), 입니·합니·줍니(ㅂ+니). */
  function endingGram(g) {
    if (g[1] === '다') { const j = jongseong(g[0]); return j === 4 || j === 20; }
    return g[1] === '니' && jongseong(g[0]) === 17;
  }

  /** 마크다운 표지만 지운다. 본문 글자는 그대로 둔다. */
  function stripMarkdown(s) {
    return String(s)
      .normalize('NFC') // 맥에서 복사한 자모 분리형을 합쳐야 같은 글자로 비교된다
      .replace(/\r\n?/g, '\n')
      .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, '') // 코드펜스 표지와 언어 태그만 지우고 코드는 남긴다: 프로그래밍 과제에서는 코드도 근거다
      .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^[ \t]*(?:#{1,6}|>+)[ \t]*/gm, '')
      .replace(/^[ \t]*(?:[-*+•·▪◦]|\d{1,3}[.)])[ \t]+/gm, '')
      .replace(/^[-*_|: \t]{3,}$/gm, (line) => (/-{3,}|\*{3,}|_{3,}/.test(line) ? '' : line)) // 수평선·표 구분선
      .replace(/\*\*|~~|`/g, '')
      .replace(/\|/g, ' ');
  }

  // 글의 내용이 아니라 틀을 이루는 상투구. 서로 다른 글에서 우연히 겹쳐도 베꼈다는 근거가 되지 않으므로 토큰화 전에 지운다.
  const BOILERPLATE = [
    '이러한 점을 종합해 볼 때', '이러한 점을 종합하면', '이러한 점들을 종합하면', '이를 종합하면', '종합해 보면', '종합해 볼 때', '이와 같이', '이와 같은', '이상에서 살펴본 바와 같이',
    '위에서 살펴본 바와 같이', '앞서 말한 바와 같이', '다시 말하면', '다시 말해', '예를 들어', '예를 들면', '한마디로', '한 마디로', '결론적으로', '결과적으로', '요약하면', '요컨대',
    '정리하면', '마지막으로', '끝으로', '첫째', '둘째', '셋째', '넷째', '첫 번째', '두 번째', '세 번째', '라고 할 수 있다', '라고 할 수 있습니다', '라고 생각한다', '라고 생각합니다',
    'in conclusion', 'to conclude', 'in summary', 'to sum up', 'as a result', 'for example', 'for instance', 'on the other hand', 'in addition', 'in other words', 'first of all',
    'it can be said that', 'as mentioned above', 'as we can see', 'all in all', 'overall',
  ].sort((a, b) => b.length - a.length);
  const BOILERPLATE_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${BOILERPLATE.map((x) => x.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'gu');

  function normalize(text) {
    return stripMarkdown(text)
      .replace(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, ' ') // camelCase·HTTPServer를 단어로 나눈다 (룩어라운드라 긴 대문자 열에서도 선형)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(BOILERPLATE_RE, ' ')
      .trim();
  }

  function plain(text) {
    return stripMarkdown(text).replace(/\s+/g, ' ').trim();
  }

  const WORD_RE = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[a-z0-9]+/gu;

  /**
   * 정규화된 문자열 → 조각 배열(중복 포함). 한글은 어간의 글자 2-gram, 영문은 단어.
   * phrases면 영문은 바로 이어진 두 단어('carbon tax')도 낸다. 같은 주제를 다룬 글은 낱말을 따로 공유하지만 베껴 고친 글은 구절째 공유한다.
   * 한글 단어쌍도 시험했으나 어간 정규화가 없어 고쳐 쓴 문장에서 먼저 깨졌고, 구분력이 좋아지지 않아 쓰지 않는다.
   */
  function tokenize(norm, phrases) {
    const out = [];
    let prev = null; // 직전 영문 단어
    let lastEnd = -1;
    const re = new RegExp(WORD_RE.source, 'gu');
    let m;
    while ((m = re.exec(norm)) !== null) {
      const raw = m[0];
      if (prev !== null && gapBreaks(norm, lastEnd, m.index)) prev = null;
      lastEnd = m.index + raw.length;
      const c = raw.charCodeAt(0);
      if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
        if (raw.length < 2 || EN_STOP.has(raw)) continue;
        const w = stem(raw);
        out.push(w);
        if (phrases && prev !== null) out.push(prev + ' ' + w);
        prev = w;
      } else {
        prev = null;
        const st = koStem(raw);
        for (let i = 0; i + 1 < st.length; i++) {
          const g = st.slice(i, i + 2);
          if (!KO_STOP.has(g) && !endingGram(g)) out.push(g);
        }
      }
    }
    return out;
  }

  /** 두 단어 사이에 공백·하이픈·아포스트로피 외의 글자(쉼표 등)가 있으면 구절이 끊긴다. */
  function gapBreaks(s, a, b) {
    for (let i = a; i < b; i++) {
      const c = s.charCodeAt(i);
      if (c !== 32 && c !== 45 && c !== 39 && c !== 8217) return true;
    }
    return false;
  }

  /** 조각의 내용어 가중치. 일반 어휘·숫자는 낮게, 나머지는 1. */
  function baseWeightRaw(g) {
    const sp = g.indexOf(' ');
    if (sp >= 0) return Math.min(baseWeightRaw(g.slice(0, sp)), baseWeightRaw(g.slice(sp + 1)));
    const c = g.charCodeAt(0);
    if (c >= 48 && c <= 57) return WEAK;
    if (c < 128) return EN_WEAK.has(g) ? WEAK : 1;
    // '점을'·'수는'처럼 한 글자 명사+조사로 읽힐 수 있는 2-gram은 내용어로 세지 않는다
    return KO_WEAK.has(g) || KO_PARTICLE.includes(g[1]) ? WEAK : 1;
  }

  const unique = (arr) => Array.from(new Set(arr));

  // ---------------------------------------------------------------- 문장 나누기
  const TERM = new Set(['.', '!', '?', '。', '！', '？', '…']);
  const CLOSERS = new Set(['"', "'", '”', '’', ')', '」', '』', ']', '）']);
  const ABBR = new Set(['e.g', 'i.e', 'mr', 'mrs', 'ms', 'dr', 'prof', 'vs', 'fig', 'cf', 'al', 'no', 'approx', 'inc', 'ltd']);
  const isSpace = (code) => code === 32 || code === 9 || code === 10 || code === 13 || code === 160 || code === 0x3000;
  const KO_CONT = /^(?:보[면니았고]|봤|하더|해도|라[고는며])/;
  const KO_POLITE = /(?:[어아에예해세네군까나게래데]요|죠)$/;
  /** '때마다'·'가다'처럼 서술어가 아닌 '-다'에서 끊지 않도록, 받침 ㄴ·ㅆ이 붙은 어미와 몇 가지 기본형만 문장 끝으로 인정한다. */
  function koPlainEnd(two) {
    if (two[1] !== '다') return false;
    if ('니이하되않같없'.includes(two[0])) return true;
    const j = jongseong(two[0]);
    return j === 4 || j === 20;
  }

  function pieceSpans(text) {
    const n = text.length;
    const pieces = [];
    let s = 0;
    const push = (a, b) => {
      while (a < b && isSpace(text.charCodeAt(a))) a++;
      while (b > a && isSpace(text.charCodeAt(b - 1))) b--;
      if (b > a) pieces.push([a, b]);
    };
    let i = 0;
    while (i < n) {
      const c = text[i];
      if (c === '\n' || c === '\r') { push(s, i); s = i + 1; i++; continue; }
      if (TERM.has(c)) {
        let j = i + 1;
        while (j < n && TERM.has(text[j])) j++;
        while (j < n && CLOSERS.has(text[j])) j++;
        const cjkStop = c === '。' || c === '！' || c === '？';
        if ((j >= n || isSpace(text.charCodeAt(j)) || cjkStop) && periodBoundary(text, s, i, j, c)) { push(s, j); s = j; }
        i = j;
        continue;
      }
      if (c === ' ' || c === '\t') {
        // 마침표 없이 한국어 종결어미 뒤에 공백이 오는 경우. '다 알고' 같은 한 글자 '다'는 제외한다.
        if (i - s >= 3 && koPlainEnd(text.slice(i - 2, i))) {
          if (!KO_CONT.test(nextWord(text, i))) { push(s, i); s = i + 1; }
        } else if (i - s >= 3 && KO_POLITE.test(text.slice(Math.max(s, i - 3), i))) {
          if (!KO_CONT.test(nextWord(text, i))) { push(s, i); s = i + 1; }
        }
      }
      i++;
    }
    push(s, n);
    return pieces;
  }

  function nextWord(text, i) {
    let j = i;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
    return text.slice(j, j + 3);
  }

  /** text[s..i)가 공백과 한두 자리 숫자뿐인가. */
  function isListNumber(text, s, i) {
    let k = i - 1;
    let digits = 0;
    while (k >= s && text.charCodeAt(k) >= 48 && text.charCodeAt(k) <= 57) { k--; digits++; }
    if (digits < 1 || digits > 3) return false;
    while (k >= s && isSpace(text.charCodeAt(k))) k--;
    return k < s;
  }

  function periodBoundary(text, s, i, j, c) {
    if (c !== '.') return true;
    if (isListNumber(text, s, i)) return false; // '1.' 같은 번호 매기기
    if (!/[A-Za-z0-9]/.test(text[i - 1] || '')) return true; // 영문·숫자 뒤의 마침표만 약어일 수 있다
    let k = j;
    while (k < text.length && isSpace(text.charCodeAt(k)) && text[k] !== '\n') k++;
    if (k < text.length && text[k] >= 'a' && text[k] <= 'z') return false; // 'e.g. carbon' 처럼 소문자로 이어지면 약어로 본다
    const m = /([A-Za-z.]+)$/.exec(text.slice(Math.max(s, i - 6), i));
    return !(m && ABBR.has(m[1].toLowerCase()));
  }

  function chunkLong(text, pieces) {
    const out = [];
    for (const [a, b] of pieces) {
      let st = a;
      while (b - st > MAX_PIECE) {
        let cut = -1;
        for (let k = st + MAX_PIECE; k > st + MAX_PIECE / 2; k--) if (isSpace(text.charCodeAt(k))) { cut = k; break; }
        if (cut < 0) {
          cut = st + MAX_PIECE;
          const hc = text.charCodeAt(cut - 1);
          if (hc >= 0xd800 && hc <= 0xdbff) cut--;
        }
        out.push([st, cut]);
        st = cut;
        while (st < b && isSpace(text.charCodeAt(st))) st++;
      }
      if (st < b) out.push([st, b]);
    }
    return out;
  }

  const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
  /** 글자·숫자 개수가 MIN_SENT에 이르는지만 본다(끝까지 세지 않는다). */
  function longEnough(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xac00 && c <= 0xd7a3)) n++;
      else if (c > 127 && LETTER_OR_DIGIT.test(s[i])) n++;
      if (n >= MIN_SENT) return true;
    }
    return false;
  }

  const HANGUL = /\p{Script=Hangul}/u;
  const CODE_HINT = /[{}=]|[;:]\s*$|\)\s*$/;
  const LIST_MARK = /^\s*(?:[-*+•]|\d{1,3}[.)])\s/;

  /**
   * 코드는 한 줄이 너무 짧아(조각 서너 개) 줄 단위로는 겹침을 판단할 수 없다.
   * 코드펜스 안이거나 한글 없이 코드 기호가 있는 줄(과 표의 행)이 이어지면 한 덩어리로 묶어 하나의 문장처럼 다룬다.
   */
  function mergeCode(text, pieces) {
    const out = [];
    let inFence = false;
    let prevCode = false;
    let scan = 0;
    let ls = 0; // 현재 조각이 놓인 줄의 시작. 조각이 순서대로 오므로 앞으로만 훑어 전체가 선형이다
    for (const [a, b] of pieces) {
      for (; scan < a; scan++) if (text.charCodeAt(scan) === 10) ls = scan + 1;
      const line = text.slice(a, b);
      let code;
      if (/^(?:```|~~~)/.test(line)) { inFence = !inFence; code = true; }
      else if (inFence || line[0] === '|') code = true; // 표의 행도 한 줄로는 조각이 몇 개뿐이라 덩어리로 묶는다
      else if (HANGUL.test(line) || LIST_MARK.test(line)) code = false;
      else {
        code = CODE_HINT.test(line) || /^(?: {2,}|\t)/.test(text.slice(ls, a));
      }
      if (code && prevCode) out[out.length - 1][1] = b;
      else out.push([a, b]);
      prevCode = code;
    }
    return out;
  }

  /** text.slice(start, end)가 곧 문장이 되는 구간 배열. 너무 짧은 조각은 앞 문장에, 맨 앞이면 뒷 문장에 붙인다. */
  function sentenceSpans(text) {
    const pieces = chunkLong(text, mergeCode(text, pieceSpans(text)));
    const out = [];
    let pending = -1;
    let lastEnd = -1;
    for (const [a, b] of pieces) {
      lastEnd = b;
      if (!longEnough(text.slice(a, b))) {
        if (out.length) out[out.length - 1].end = b;
        else if (pending < 0) pending = a;
        continue;
      }
      out.push({ start: pending >= 0 ? pending : a, end: b });
      pending = -1;
    }
    if (pending >= 0) out.push({ start: pending, end: lastEnd });
    return out;
  }

  // 자모가 분리된(NFD) 입력도 NFC와 같게 나누기 위한 조각: 앞 글자와 합쳐질 수 있는 낱자모·결합 부호는 앞 조각에 붙는다
  const SEG_RE = /[^\p{M}\u1161-\u1175\u11a8-\u11c2][\p{M}\u1161-\u1175\u11a8-\u11c2]*|[\p{M}\u1161-\u1175\u11a8-\u11c2]+/gu;

  /**
   * 문장 구간. 오프셋은 항상 입력 text 기준이다. NFD 입력은 NFC로 합친 문자열에서 나눈 뒤 원문 오프셋으로 되돌린다:
   * 종결어미 판정이 완성형 음절의 받침을 보기 때문이다.
   */
  function splitSentences(text) {
    const nfc = text.normalize('NFC');
    if (nfc === text) return sentenceSpans(text);
    const spans = sentenceSpans(nfc);
    const o = [];
    const n = [];
    let ni = 0;
    for (const m of text.matchAll(SEG_RE)) { o.push(m.index); n.push(ni); ni += m[0].normalize('NFC').length; }
    o.push(text.length);
    n.push(ni);
    if (ni !== nfc.length) return sentenceSpans(text);
    const find = (x) => {
      let lo = 0;
      let hi = n.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (n[mid] <= x) lo = mid; else hi = mid - 1; }
      return lo;
    };
    return spans.map(({ start, end }) => {
      const b = find(end);
      return { start: o[find(start)], end: n[b] === end ? o[b] : o[Math.min(b + 1, o.length - 1)] };
    });
  }

  // ---------------------------------------------------------------- 의도 분류
  // 우선순위: 구체적인 작업 동사가 일반 동사를 이긴다.
  //   개요 > 요약 > 수정 > 피드백 > 아이디어 > 작성 > 설명.
  // 수정이 작성보다 앞서는 이유는 '고쳐 써줘'에 '써줘'가 들어 있기 때문이고,
  // 설명이 맨 뒤인 이유는 '알려줘'가 거의 모든 요청에 붙기 때문이다.
  const lat = (alt) => `(?<![a-z])(?:${alt})(?![a-z])`;
  const INTENT_RULES = [
    ['outline', new RegExp(`개요|목차|아웃라인|뼈대|구성안|글의 구성|구성(?:을|좀)?\\s*(?:짜|잡|해|만|제안)|틀(?:을)?\\s*(?:짜|잡|만)|서론.{0,8}본론.{0,8}결론|${lat('outline|table of contents|skeleton')}`, 'i')],
    ['summarize', new RegExp(`요약|간추|축약|줄여\\s*(?:줘|주)|핵심만|한\\s*줄로|${lat('summari[sz]e|summary|tl;?dr|condense|shorten|in brief')}`, 'i')],
    ['revise', new RegExp(`고쳐|고치|수정|교정|윤문|다듬|퇴고|맞춤법|문법|어색|자연스럽|바꿔|바꾸|다시 써|다르게 써|리라이트|${lat('rewrite|revise|proofread|edit|polish|rephrase|paraphrase|reword|fix')}|correct (?:this|my|the)|improve (?:this|my|the)|make (?:it|this) (?:sound|more|better|clearer)`, 'i')],
    ['feedback', new RegExp(`피드백|평가|검토|리뷰|의견|부족한|보완|점수|채점|첨삭|${lat('feedback|review|critique|evaluate|assess')}|what do you think|check (?:my|if|whether)|any (?:suggestions|improvements)`, 'i')],
    ['ideas', new RegExp(`아이디어|브레인스토밍|주제\\s*(?:추천|제안|후보)|소재|논점|쟁점|근거(?:로|를)?\\s*(?:쓸|들|추천|제안)|떠올|${lat('ideas?|brainstorm|suggest|topics?|angles?|perspectives?')}|arguments? (?:for|against)|points? (?:for|against)`, 'i')],
    ['summarize', /정리\s*(?:해|좀|하)/],
    ['generate', new RegExp(`써\\s*줘|써\\s*주|작성|만들어|지어|초안|생성|쓰고 싶|쓰려|${lat('write|draft|generate|compose|create|produce')}`, 'i')],
    ['explain', new RegExp(`설명|알려|뭐야|뭔가요|무엇|뭐가|차이|의미|개념|뜻|원리|이유|왜|어떻게|어떤|이란|인가요|${lat('explain|difference|meaning|define|describe|elaborate|why')}|what (?:is|are|does)|how (?:do|does|to|can)|tell me|more detail`, 'i')],
  ];

  /**
   * 붙여넣은 학생 글 안의 단어에 속지 않도록 지시문 자리만 본다. 줄이 셋 이상이면 첫 줄과 마지막 줄,
   * 두 줄이면 짧은 쪽(긴 쪽은 붙여넣은 글로 본다), 한 줄이 아주 길면 앞뒤 100자. 짧은 프롬프트는 전체를 본다.
   */
  function instructionPart(prompt) {
    const s = String(prompt || '').normalize('NFC');
    const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 3) return `${lines[0].slice(0, 200)} ${lines[lines.length - 1].slice(-200)}`;
    if (lines.length === 2) {
      const short = lines.filter((l) => l.length <= 200);
      if (short.length) return short.join(' ');
    }
    return s.length > 400 ? `${s.slice(0, 100)} ${s.slice(-100)}` : s;
  }

  function classifyIntent(prompt) {
    const s = instructionPart(prompt);
    for (const [name, re] of INTENT_RULES) if (re.test(s)) return name;
    return 'other';
  }

  const INTENT_LABELS = {
    generate: '글 작성', revise: '문장 수정', explain: '개념 설명', ideas: '아이디어 구상',
    outline: '개요 구성', summarize: '요약·정리', feedback: '피드백 요청', other: '기타',
  };
  const INTENT_KEYS = Object.keys(INTENT_LABELS);
  const intentLabel = (intent) => INTENT_LABELS[intent] || INTENT_LABELS.other;

  // ---------------------------------------------------------------- 입력 정리
  const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));

  function prepare(doc) {
    const meta = (doc && doc.meta) || {};
    const body = str(doc && doc.submission && doc.submission.text);
    const convs = doc && Array.isArray(doc.conversations) ? doc.conversations : [];
    const turns = [];
    convs.forEach((c, ci) => {
      const cid = str(c && c.id) || `conv${ci}`;
      const list = c && Array.isArray(c.turns) ? c.turns : [];
      list.forEach((t, ti) => {
        turns.push({
          id: str(t && t.id) || `${cid}#${ti}`,
          convId: cid,
          convIndex: ci,
          index: ti,
          prompt: str(t && t.prompt).slice(0, MAX_TEXT).normalize('NFC'),
          response: str(t && t.response).slice(0, MAX_TEXT).normalize('NFC'),
          chars: str(t && t.prompt).length + str(t && t.response).length,
        });
      });
    });
    const unparsed = convs.filter((c) => c && c.parsed === 'unparsed').length;
    return { title: str(meta.assignment), brief: str(meta.assignmentBrief), body, convCount: convs.length, unparsed, turns };
  }

  function makeUnits(text) {
    return sentenceSpans(text).map(({ start, end }) => {
      const raw = text.slice(start, end);
      return { raw, grams: unique(tokenize(normalize(raw), true)) };
    });
  }

  // ---------------------------------------------------------------- 연관도
  /**
   * 과제 참조 텍스트의 주제어 표. 본문에서 되풀이되는 조각일수록 주제어로 보고,
   * 한 번만 나온 조각은 우연히 겹칠 수 있어 약하게만 센다. 제목·안내문의 조각은 항상 주제어다.
   */
  function buildReference(title, brief, body) {
    const toks = tokenize(normalize(body), false);
    const counts = new Map();
    for (const g of toks) counts.set(g, (counts.get(g) || 0) + 1);
    const anchor = Math.max(2, toks.length / 500);
    const sal = new Map();
    for (const [g, c] of counts) sal.set(g, Math.max(0.15, Math.min(1, Math.pow(c / anchor, 1.5))));
    for (const g of tokenize(normalize(title + '\n' + brief), false)) sal.set(g, 1);
    // 참조 어휘가 작을수록 우연히 겹칠 확률이 낮으므로 증거 문턱도 낮춘다 (고유 조각 250개 이상이면 최대)
    const scale = Math.min(1, sal.size / 250);
    return { sal, lo: 0.6 + 0.9 * scale, width: 2 + scale };
  }

  function makeWeighter() {
    const cache = new Map();
    return (g) => {
      let v = cache.get(g);
      if (v === undefined) { v = baseWeightRaw(g); cache.set(g, v); }
      return v;
    };
  }

  /** 한 문장(조각 집합)이 주제어를 얼마나 담는가(0~1 안팎). */
  function unitRelevance(grams, ref, bw) {
    let den = REL_SMOOTH;
    let num = 0;
    for (const g of grams) {
      if (g.indexOf(' ') >= 0) continue;
      const b = bw(g);
      den += b;
      const s = ref.sal.get(g);
      if (s !== undefined) num += b * s;
    }
    // 공유한 주제어의 가중치 합이 문턱(lo) 이하면 우연 일치로 보고 0, lo+width 이상이면 전부 인정
    return (Math.min(1, Math.max(0, (num - ref.lo) / ref.width)) * num) / den;
  }

  function topMean(scores, k) {
    if (!scores.length) return 0;
    const top = scores.slice().sort((a, b) => b - a).slice(0, k);
    return top.reduce((a, b) => a + b, 0) / top.length;
  }

  const r4 = (x) => Math.round(x * 1e4) / 1e4;

  /** 겹침 증거가 충분한가. ratio는 문장이 상대 쪽에 들어 있는 정도(포함도 또는 점수). */
  function enoughEvidence(ratio, n, m, strong) {
    if (ratio >= VERBATIM_T && n >= SHORT_SHARED && m >= SHORT_MASS && strong >= SHORT_STRONG) return true;
    return n >= MIN_SHARED && m >= MIN_MASS && strong >= MIN_STRONG;
  }

  /**
   * 턴 하나의 연관도. 그 턴의 프롬프트·응답과 참조 텍스트만 쓴다(다른 턴을 보지 않는다).
   * 응답은 문장별 점수의 상위 3개 평균을 써서 긴 응답의 일반 어휘가 점수를 희석하지 않게 한다.
   * 프롬프트에 내용어가 거의 없는 짧은 후속 질문('더 자세히')은 응답 점수만으로 본다.
   */
  function turnRelevance(pUnits, rUnits, ref, bw) {
    const pScores = pUnits.map((u) => unitRelevance(u.grams, ref, bw));
    const rScores = rUnits.map((u) => unitRelevance(u.grams, ref, bw));
    let mass = 0;
    const seen = new Set();
    for (const u of pUnits) for (const g of u.grams) if (g.indexOf(' ') < 0 && !seen.has(g)) { seen.add(g); mass += bw(g); }
    let P = topMean(pScores, 3);
    let A = topMean(rScores, 3);
    if (mass < 3) P = A;
    if (!rUnits.length) A = P;
    const raw = 0.75 * Math.max(P, A) + 0.25 * Math.min(P, A);
    // 포화 함수: 선형으로 자르면 직접 관련된 턴이 모두 1.0에 붙어 순위 정보가 사라진다
    return r4(1 - Math.exp(-REL_GAIN * raw));
  }

  const labelOf = (rel) => (rel >= HIGH_THRESHOLD ? 'high' : rel >= DELETE_THRESHOLD ? 'mid' : 'low');

  /** 본문을 문장으로 나누고 조각 가중치(주제어처럼 여러 문장에 흔한 조각은 낮게)와 역색인을 만든다. */
  function bodyModel(body, bw) {
    const subs = splitSentences(body).map((sp, idx) => ({ idx, start: sp.start, end: sp.end, text: body.slice(sp.start, sp.end) }));
    const gramsOf = subs.map((s) => unique(tokenize(normalize(s.text), true)));
    const df = new Map();
    const post = new Map();
    gramsOf.forEach((gs, i) => {
      for (const g of gs) {
        df.set(g, (df.get(g) || 0) + 1);
        const l = post.get(g);
        if (l) l.push(i); else post.set(g, [i]);
      }
    });
    const wcache = new Map();
    const w = (g) => {
      let v = wcache.get(g);
      if (v === undefined) { v = bw(g) * dfFactor(df.get(g) || 0); wcache.set(g, v); }
      return v;
    };
    return { subs, gramsOf, sets: gramsOf.map((gs) => new Set(gs)), df, post, w };
  }

  /**
   * 이 턴의 문장이 본문 문장 안에 거의 들어 있는 정도(단위 쪽 포함도의 최댓값).
   * 학생이 대화 내용을 본문에 옮겨 썼다면 주제어가 한 번씩만 나와도 그 턴은 과제와 연관된 것이다.
   */
  function reuseOf(units, model, bw) {
    const nb = model.subs.length;
    if (!nb) return 0;
    const acc = new Float64Array(nb);
    const touched = [];
    let best = 0;
    for (const u of units) {
      const grams = u.grams;
      if (grams.length < SHORT_STRONG) continue;
      let WU = 0;
      let strong = 0;
      const ws = new Array(grams.length);
      for (let i = 0; i < grams.length; i++) {
        ws[i] = model.w(grams[i]);
        WU += ws[i];
        if (bw(grams[i]) === 1) strong++;
      }
      if (strong < SHORT_STRONG || WU <= 0) continue;
      touched.length = 0;
      for (let i = 0; i < grams.length; i++) {
        const l = model.post.get(grams[i]);
        if (!l || l.length > POSTING_CAP) continue;
        for (let q = 0; q < l.length; q++) {
          if (acc[l[q]] === 0) touched.push(l[q]);
          acc[l[q]] += ws[i];
        }
      }
      // 겹침 질량이 가장 큰 본문 문장 하나만 정밀 계산한다
      let top = -1;
      for (const si of touched) {
        if (top < 0 || acc[si] > acc[top] || (acc[si] === acc[top] && si < top)) top = si;
      }
      for (const si of touched) acc[si] = 0;
      if (top < 0) continue;
      let m = 0;
      let n = 0;
      const set = model.sets[top];
      for (let i = 0; i < grams.length; i++) {
        if (set.has(grams[i])) { m += ws[i]; if (bw(grams[i]) === 1) n++; }
      }
      if (m / WU > best && enoughEvidence(m / WU, n, m, strong)) best = m / WU;
    }
    return best;
  }

  const reuseRelevance = (reuse) => (reuse >= REUSE_MIN ? HIGH_THRESHOLD + ((REUSE_CAP - HIGH_THRESHOLD) * (reuse - REUSE_MIN)) / (1 - REUSE_MIN) : 0);

  function computeTurns(d, model, bw) {
    const ref = buildReference(d.title, d.brief, d.body);
    return d.turns.map((t) => {
      const pUnits = makeUnits(t.prompt);
      const rUnits = makeUnits(t.response);
      const topical = turnRelevance(pUnits, rUnits, ref, bw);
      const reuse = topical >= REUSE_CAP ? 0 : reuseOf(pUnits.concat(rUnits), model, bw);
      const floor = reuse > 0 ? reuseRelevance(reuse) + 0.15 * topical : 0; // 옮겨 쓴 턴끼리 0.6에서 동점이 나지 않게 주제어 점수를 조금 더한다
      return { ...t, pUnits, rUnits, relevance: r4(Math.max(topical, floor)) };
    });
  }

  // ---------------------------------------------------------------- 문장 정렬
  const dfFactor = (df) => (df <= 1 ? 1 : Math.max(0.25, 1 / (1 + 0.35 * (df - 1))));

  /**
   * 본문 문장마다 AI 응답/프롬프트 문장(단독 또는 인접 두 문장)과의 겹침을 구해 종류를 정한다.
   * 점수 = 0.65 * 포함도(본문 문장의 조각 중 AI 쪽에 있는 비율) + 0.35 * Dice.
   * 포함도만 쓰면 큰 AI 문단이 짧은 문장을 통째로 품을 때 과대평가되고, Dice만 쓰면 한 문장을 둘로 나눠 쓴 경우를 놓친다.
   */
  function align(model, turns, bw) {
    const T = turns.length;
    const { subs, gramsOf } = model;
    // 본문과 AI 문장 양쪽에 흔한 조각(주제어)은 겹쳐도 베꼈다는 근거가 약하므로 가중치를 낮춘다
    const aiDf = new Map();
    for (const t of turns) for (const units of [t.pUnits, t.rUnits]) for (const u of units) for (const g of u.grams) aiDf.set(g, (aiDf.get(g) || 0) + 1);
    const wc = new Map();
    const w = (g) => {
      let v = wc.get(g);
      if (v === undefined) {
        v = bw(g) * Math.min(1, Math.max(0.2, 1 / (1 + 0.25 * ((model.df.get(g) || 0) + (aiDf.get(g) || 0) - 2))));
        wc.set(g, v);
      }
      return v;
    };

    // AI 쪽 단위(문장) 목록과 역색인. 같은 (턴, 역할) 안에서 id가 연속이라 uid±1이 인접 문장이다.
    const U = [];
    const post = new Map();
    turns.forEach((t, ti) => {
      [t.pUnits, t.rUnits].forEach((units, role) => {
        units.forEach((u, k) => {
          const set = new Set(u.grams);
          let ws = 0;
          for (const g of set) ws += w(g);
          const uid = U.length;
          U.push({ ti, role, k, set, ws, raw: u.raw });
          for (const g of set) {
            const l = post.get(g);
            if (l) l.push(uid); else post.set(g, [uid]);
          }
        });
      });
    });

    const acc = new Float64Array(U.length);
    const results = [];

    subs.forEach((s, idx) => {
      const grams = gramsOf[idx];
      const ws = grams.map(w);
      let WS = 0;
      let strong = 0;
      for (let i = 0; i < grams.length; i++) { WS += ws[i]; if (bw(grams[i]) === 1) strong++; }

      const pEff = new Float64Array(T);
      const rEff = new Float64Array(T);
      const pTxt = new Array(T);
      const rTxt = new Array(T);
      let any = 0;

      if (WS > 0 && U.length) {
        const touched = [];
        for (let i = 0; i < grams.length; i++) {
          const l = post.get(grams[i]);
          if (!l || l.length > POSTING_CAP) continue;
          for (let q = 0; q < l.length; q++) {
            const u = l[q];
            if (acc[u] === 0) touched.push(u);
            acc[u] += ws[i];
          }
        }
        const top = [];
        for (const u of touched) {
          const a = acc[u];
          acc[u] = 0;
          if (a < MIN_MASS * 0.5) continue;
          if (top.length < TOP_CAND) top.push([u, a]);
          else {
            let mi = 0;
            for (let q = 1; q < top.length; q++) if (top[q][1] < top[mi][1]) mi = q;
            if (a > top[mi][1]) top[mi] = [u, a];
          }
        }
        for (const [uid] of top) {
          const base = U[uid];
          const variants = [[uid]];
          if (uid > 0 && U[uid - 1].ti === base.ti && U[uid - 1].role === base.role) variants.push([uid - 1, uid]);
          if (uid + 1 < U.length && U[uid + 1].ti === base.ti && U[uid + 1].role === base.role) variants.push([uid, uid + 1]);
          for (const v of variants) {
            const A = U[v[0]];
            const B = v.length > 1 ? U[v[1]] : null;
            let m = 0;
            let n = 0;
            let mA = 0;
            let mB = 0;
            for (let i = 0; i < grams.length; i++) {
              const inA = A.set.has(grams[i]);
              const inB = !!B && B.set.has(grams[i]);
              if (inA || inB) {
                m += ws[i];
                if (bw(grams[i]) === 1) n++;
                if (inA && !inB) mA += ws[i]; else if (inB && !inA) mB += ws[i];
              }
            }
            // 인접 두 문장을 묶는 것은 본문 문장이 두 문장을 합친 경우뿐이다: 양쪽이 각자 몫을 해야 한다
            if (B && (mA < 0.2 * m || mB < 0.2 * m)) continue;
            let WA = A.ws;
            if (B) {
              WA += B.ws;
              for (const g of B.set) if (A.set.has(g)) WA -= w(g);
            }
            const c = m / WS;
            const dice = (2 * m) / (WS + WA);
            let score = 0.65 * c + 0.35 * dice;
            if (!enoughEvidence(score, n, m, strong)) score = Math.min(score, ADAPTED_T - 0.05);
            const arr = base.role === 0 ? pEff : rEff;
            const txt = base.role === 0 ? pTxt : rTxt;
            if (score > arr[base.ti]) {
              arr[base.ti] = score;
              txt[base.ti] = B ? A.raw + ' ' + B.raw : A.raw;
              if (score > any) any = score;
            }
          }
        }
      }

      // 출처 판정. 같은 대화 안에서 프롬프트는 같은 턴의 응답보다 앞선다.
      let prefix = 0;
      let curConv = -1;
      let bestAI = null;
      let bestP = null;
      let anyResp = false;
      for (let ti = 0; ti < T; ti++) {
        const t = turns[ti];
        if (t.convIndex !== curConv) { curConv = t.convIndex; prefix = 0; }
        const pe = pEff[ti];
        if (pe > 0) {
          if (pe > prefix) prefix = pe;
          if (!bestP || pe > bestP.score) bestP = { ti, score: pe, text: pTxt[ti] };
        }
        const re = rEff[ti];
        if (re >= ADAPTED_T) {
          anyResp = true;
          // 응답 점수가 앞선 프롬프트(학생 글)보다 크게 높지 않으면 그 내용은 학생 쪽에서 먼저 나온 것이다
          if (prefix < re - ORIGIN_TIE && (!bestAI || re > bestAI.score)) bestAI = { ti, score: re, text: rTxt[ti] };
        }
      }

      let kind = 'original';
      let score = any;
      let src = null;
      if (bestAI) {
        kind = bestAI.score >= VERBATIM_T ? 'verbatim' : 'adapted';
        score = bestAI.score;
        src = bestAI;
      } else if (bestP && bestP.score >= ADAPTED_T - ORIGIN_TIE && (bestP.score >= ADAPTED_T || anyResp)) {
        kind = 'studentOrigin';
        score = bestP.score;
        src = bestP;
      }
      results.push({ kind, score: r4(Math.min(1, score)), src });
    });
    return results;
  }

  // ---------------------------------------------------------------- 요약
  /** 비공백 글자 수(코드포인트). 자모가 분리된 입력이어도 같은 값이 되도록 NFC로 합쳐서 센다. */
  const nonSpaceLen = (s) => {
    const t = s.normalize('NFC');
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (!isSpace(c) && !(c >= 0xdc00 && c <= 0xdfff)) n++;
    }
    return n;
  };

  /** 앞 n자(UTF-16 길이 기준 n 이하, 이모지를 반으로 자르지 않음). 잘리면 …로 끝난다. */
  function headOf(text, n) {
    const p = plain(text.slice(0, 4 * n)); // 긴 응답 전체를 다시 훑지 않도록 앞부분만 쓴다
    if (p.length <= n) return p;
    let out = '';
    for (const ch of p) {
      if (out.length + ch.length > n - 1) break;
      out += ch;
    }
    return out + '…';
  }

  function quantize(chars, total) {
    if (total === 0) return { verbatim: 0, adapted: 0, studentOrigin: 0, original: 1 };
    const keys = ['verbatim', 'adapted', 'studentOrigin'];
    const q = keys.map((k) => Math.round((chars[k] / total) * Q));
    let rest = Q - q[0] - q[1] - q[2];
    if (rest < 0) {
      let mx = 0;
      for (let i = 1; i < 3; i++) if (q[i] > q[mx]) mx = i;
      q[mx] += rest;
      rest = 0;
    }
    return { verbatim: q[0] / Q, adapted: q[1] / Q, studentOrigin: q[2] / Q, original: rest / Q };
  }

  const pct = (x) => Math.round(x * 100);
  const BAND_LABEL = { low: '낮음', mid: '중간', high: '높음' };

  function summaryLine(t) {
    const ai = t.reflected.verbatim + t.reflected.adapted;
    const parts = [`요청: ${intentLabel(t.intent)}`, `연관도 ${pct(t.relevance)}%`];
    parts.push(ai > 0 ? `과제 반영: 문장 ${ai}개(그대로 ${t.reflected.verbatim}, 수정 ${t.reflected.adapted})` : '과제 반영: 없음');
    if (t.reflected.studentOrigin > 0) parts.push(`본인 원문과 가까운 문장 ${t.reflected.studentOrigin}개`);
    if (t.deletable) parts.push('연관도 낮음(삭제 가능)');
    return parts.join(' · ');
  }

  function buildNarrative(d, turnRes, sum, sentences) {
    const lines = [];
    if (!d.turns.length) {
      lines.push('첨부된 AI 대화가 없어 본문과 비교할 내용이 없습니다.');
    } else {
      lines.push(`첨부된 AI 대화는 ${d.convCount}개, 대화 턴은 ${sum.turnCount}개이며, 과제와 관련된 턴(연관도 ${pct(DELETE_THRESHOLD)}% 이상)은 ${sum.relatedTurnCount}개입니다.`
        + (sum.deletableTurnCount ? ` 연관도가 낮아 삭제할 수 있는 턴은 ${sum.deletableTurnCount}개입니다.` : ''));
      const top = turnRes[0];
      lines.push(`가장 연관도가 높은 대화는 대화 ${top.convIndex + 1}의 ${top.index + 1}번째 턴(연관도 ${pct(top.relevance)}%, 요청: ${intentLabel(top.intent)})입니다.`
        + (top.reflected.verbatim + top.reflected.adapted > 0 ? ` 이 턴의 답변과 겹치는 본문 문장은 ${top.reflected.verbatim + top.reflected.adapted}개입니다.` : ''));
    }
    const dels = Array.isArray(d.deletions) ? d.deletions : [];
    if (dels.length) {
      const odd = dels.filter((x) => x && Number(x.relevance) >= DELETE_THRESHOLD).length;
      lines.push(`제출 전에 삭제된 대화는 ${dels.length}개이며, 삭제된 내용은 저장되지 않고 연관도와 글자 수만 기록되어 있습니다.`
        + (odd ? ` 이 중 ${odd}개는 기록된 연관도가 삭제 기준(${pct(DELETE_THRESHOLD)}%) 이상이라 앱의 삭제 규칙과 맞지 않습니다.` : ''));
    }
    if (d.unparsed) {
      lines.push(`역할 표지를 찾지 못한 대화가 ${d.unparsed}개 있습니다. 이 대화는 전체가 AI 답변으로 계산되므로, 학생이 쓴 부분이 섞여 있으면 의존도가 실제보다 높게 나올 수 있습니다.`);
    }
    if (!sentences.length) {
      lines.push('제출된 본문이 비어 있어 의존도를 계산하지 않았습니다.');
    } else {
      const c = sum.sentenceCounts;
      const s = sum.shares;
      lines.push(`본문 ${sentences.length}문장 기준, AI 답변과의 겹침으로 본 의존도는 ${pct(sum.dependency)}%(구간: ${BAND_LABEL[sum.band]}, 낮음 ${pct(BAND_MID)}% 미만 · 높음 ${pct(BAND_HIGH)}% 이상)이고 주체적 작성 비율은 ${pct(sum.autonomy)}%입니다. `
        + `근거(글자 수 기준): AI 답변과 거의 같은 문장 ${pct(s.verbatim)}%(${c.verbatim}문장), 고쳐 쓴 흔적이 있는 문장 ${pct(s.adapted)}%(${c.adapted}문장), `
        + `본인이 AI에 보낸 원문과 가까운 문장 ${pct(s.studentOrigin)}%(${c.studentOrigin}문장), 겹침이 확인되지 않은 문장 ${pct(s.original)}%(${c.original}문장)입니다.`);
    }
    lines.push('이 수치는 글자·단어 겹침에 기반한 추정이어서 AI 답변을 읽고 자기 말로 다시 쓴 내용은 잡아내지 못하므로 하한에 가깝고, 붙여넣은 대화는 링크로 검증되지 않았습니다.');
    return lines;
  }

  // ---------------------------------------------------------------- 공개 API
  function run(doc) {
    const d = prepare(doc);
    d.deletions = doc && Array.isArray(doc.deletions) ? doc.deletions : [];
    const bw = makeWeighter();
    const model = bodyModel(d.body, bw);
    const turns = computeTurns(d, model, bw);
    const subs = model.subs;
    const aligned = subs.length ? align(model, turns, bw) : [];

    const turnRes = turns.map((t, ti) => ({
      id: t.id,
      convId: t.convId,
      convIndex: t.convIndex,
      index: t.index,
      relevance: t.relevance,
      relevanceLabel: labelOf(t.relevance),
      intent: classifyIntent(t.prompt),
      promptHead: headOf(t.prompt, 80),
      responseHead: headOf(t.response, 80),
      reflected: { verbatim: 0, adapted: 0, studentOrigin: 0 },
      deletable: t.relevance < DELETE_THRESHOLD,
      summaryLine: '',
      _ti: ti,
    }));

    const chars = { verbatim: 0, adapted: 0, studentOrigin: 0, original: 0 };
    const counts = { verbatim: 0, adapted: 0, studentOrigin: 0, original: 0 };
    const sentences = subs.map((s, i) => {
      const a = aligned[i];
      const n = nonSpaceLen(s.text);
      chars[a.kind] += n;
      counts[a.kind]++;
      let source = null;
      if (a.src) {
        const tr = turnRes[a.src.ti];
        tr.reflected[a.kind]++;
        source = { turnId: tr.id, convIndex: tr.convIndex, turnIndex: tr.index, snippet: headOf(a.src.text, 80) };
      }
      return { idx: s.idx, text: s.text, start: s.start, end: s.end, kind: a.kind, score: a.score, source };
    });

    const total = chars.verbatim + chars.adapted + chars.studentOrigin + chars.original;
    const shares = quantize(chars, total);
    const dependency = shares.verbatim + 0.5 * shares.adapted;
    const band = dependency >= BAND_HIGH ? 'high' : dependency >= BAND_MID ? 'mid' : 'low';

    const intents = {};
    INTENT_KEYS.forEach((k) => { intents[k] = 0; });
    turnRes.forEach((t) => { intents[t.intent]++; t.summaryLine = summaryLine(t); });

    const summary = {
      dependency,
      autonomy: 1 - dependency,
      band,
      shares,
      sentenceCounts: counts,
      turnCount: turnRes.length,
      relatedTurnCount: turnRes.filter((t) => t.relevance >= DELETE_THRESHOLD).length,
      deletableTurnCount: turnRes.filter((t) => t.deletable).length,
      intents,
    };

    const sorted = turnRes.slice().sort((a, b) => b.relevance - a.relevance || a.convIndex - b.convIndex || a.index - b.index);
    sorted.forEach((t) => { delete t._ti; });
    return { turns: sorted, sentences, summary, narrative: buildNarrative(d, sorted, summary, sentences) };
  }

  function findTurnRelevance(doc, turnId) {
    const d = prepare(doc);
    const hit = d.turns.find((t) => t.id === turnId);
    if (!hit) return null;
    // 연관도는 이 턴과 과제만으로 정해지므로 다른 턴은 계산하지 않는다
    const bw = makeWeighter();
    const model = bodyModel(d.body, bw);
    const [t] = computeTurns({ ...d, turns: [hit] }, model, bw);
    const rel = t.relevance;
    return { turn: hit, relevance: rel };
  }

  function canDelete(doc, turnId) {
    const f = findTurnRelevance(doc, turnId);
    if (!f) return { ok: false, relevance: 0, message: '삭제할 대화를 찾을 수 없습니다.' };
    if (f.relevance < DELETE_THRESHOLD) {
      return { ok: true, relevance: f.relevance, message: `과제와 연관도가 낮아(${pct(f.relevance)}%) 삭제할 수 있습니다.` };
    }
    return { ok: false, relevance: f.relevance, message: REFUSAL_MESSAGE };
  }

  function deleteTurn(doc, turnId) {
    const chk = canDelete(doc, turnId);
    if (!chk.ok) return { ok: false, doc, message: chk.message };
    const f = findTurnRelevance(doc, turnId);
    const conversations = doc.conversations.map((c, ci) => (
      ci === f.turn.convIndex ? { ...c, turns: c.turns.filter((_, ti) => ti !== f.turn.index) } : c
    ));
    const record = { turnId, convId: f.turn.convId, relevance: chk.relevance, chars: f.turn.chars };
    // 점수·확인 코드는 삭제 전 내용 기준이므로 새 문서에서는 비운다 (제출 때 다시 채운다)
    const next = { ...doc, conversations, deletions: [...(Array.isArray(doc.deletions) ? doc.deletions : []), record], claimed: null, code: null };
    return { ok: true, doc: next, message: chk.message };
  }

  const api = {
    DELETE_THRESHOLD, HIGH_THRESHOLD, REFUSAL_MESSAGE, BAND_MID, BAND_HIGH, VERBATIM_T, ADAPTED_T,
    run, canDelete, deleteTurn, intentLabel, classifyIntent, splitSentences, normalize, tokenize,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analyze = api;
})(typeof self !== 'undefined' ? self : globalThis);
