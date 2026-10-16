'use strict';
/**
 * 픽스처 → doc + 정답표.
 * 정답은 "어떻게 만들었는가"로 정해진다. how 값과 검증 규칙:
 *   copy   AI 응답(from)에서 문장을 그대로 옮김      → 응답 평문의 부분 문자열이어야 함, 기대 verbatim
 *   light  AI 응답 문장에서 어미·조사 정도만 고침    → 부분 문자열이 아님(고쳤으므로),  기대 verbatim
 *   rewrite AI 응답 문장의 구절을 절반쯤 남기고 어휘·어순을 바꿔 다시 씀 → 부분 문자열이 아님, 기대 adapted
 *   paraphrase 같은 생각을 자기 말로 완전히 다시 씀   → 부분 문자열이 아님, 기대 original (엔진이 못 잡는 것이 정상: 알려진 한계)
 *   own    학생이 직접 씀                           → 어떤 프롬프트·응답에도 없음,      기대 original
 *   draft  학생이 AI에 보낸 초안(from의 프롬프트)을 그대로 씀 → 프롬프트의 부분 문자열,      기대 studentOrigin
 *   polish 초안을 교정받은 AI 응답(from)을 그대로 씀   → 응답의 부분 문자열, 프롬프트에는 없음, 기대 verbatim
 */
const EXPECT = { copy: 'verbatim', light: 'verbatim', rewrite: 'adapted', paraphrase: 'original', own: 'original', draft: 'studentOrigin', polish: 'verbatim' };

const flat = (s) => String(s)
  .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, '')
  .replace(/^[ \t]*(?:#{1,6}|>+)[ \t]*/gm, '')
  .replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, '')
  .replace(/\*\*|`/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function build(fx) {
  const turnById = new Map();
  const conversations = fx.conversations.map((c) => ({
    id: c.id,
    provider: c.provider,
    url: c.url,
    parsed: 'ok',
    turns: c.turns.map((t) => {
      const response = Array.isArray(t.response) ? t.response.join('\n') : t.response;
      const prompt = Array.isArray(t.prompt) ? t.prompt.join('\n') : t.prompt;
      const out = { id: t.id, prompt, response };
      turnById.set(t.id, { ...out, label: t.label, convId: c.id });
      return out;
    }),
  }));

  let text = '';
  const truth = [];
  const problems = [];
  fx.submission.forEach((para, pi) => {
    if (pi > 0) text += '\n\n';
    para.forEach((part, qi) => {
      if (qi > 0) text += part.sep === undefined ? ' ' : part.sep;
      const start = text.length;
      text += part.text;
      const end = text.length;
      truth.push({ start, end, how: part.how, expect: EXPECT[part.how], from: part.from || null, text: part.text });

      const needle = flat(part.text);
      const src = part.from ? turnById.get(part.from) : null;
      const anyHit = [...turnById.values()].some((t) => flat(t.response).includes(needle) || flat(t.prompt).includes(needle));
      if (part.how === 'copy' || part.how === 'polish') {
        if (!src || !flat(src.response).includes(needle)) problems.push(`${part.how}: 응답에 없음 → ${part.text.slice(0, 30)}`);
        if (part.how === 'polish' && flat(src.prompt).includes(needle)) problems.push(`polish: 프롬프트에도 있음 → ${part.text.slice(0, 30)}`);
      } else if (part.how === 'draft') {
        if (!src || !flat(src.prompt).includes(needle)) problems.push(`draft: 프롬프트에 없음 → ${part.text.slice(0, 30)}`);
      } else if (anyHit) {
        problems.push(`${part.how}: 그대로 있는 문장 → ${part.text.slice(0, 30)}`);
      }
    });
  });

  const doc = {
    version: 2,
    meta: { ...fx.meta },
    submission: { text },
    conversations,
    deletions: [],
    reflection: '',
    claimed: null,
    code: null,
  };
  const labels = {};
  for (const [id, t] of turnById) labels[id] = t.label;
  return { id: fx.id, doc, truth, labels, problems, turnById };
}

module.exports = { build, EXPECT, flat };
