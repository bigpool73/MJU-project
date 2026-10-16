'use strict';
// 영어 에세이 — 대학생 봉사활동 의무화 (영어작문). 본문은 영어, 학생 프롬프트는 한영 혼용.
module.exports = {
  id: 'eng-service',
  field: '영어 에세이',
  meta: {
    student: '정하늘',
    studentId: '60234410',
    course: '영어작문',
    professor: '김영미',
    assignment: 'Opinion Essay: Should Community Service Be Mandatory for College Students?',
    assignmentBrief: 'Write a five-paragraph opinion essay (about 250-300 words) on whether community service should be mandatory for college students. State a clear thesis, give at least two reasons with examples, address one counterargument and rebut it, and use at least three transition expressions.',
  },
  conversations: [
    {
      id: 'c1', provider: 'chatgpt', source: '대화-c1-chatgpt.pdf', turns: [
        {
          id: 'c1t1', label: 'related',
          prompt: '영어작문 과제인데 대학생 봉사활동 의무화 찬성하는 에세이 쓸 거야. reasons 두세 개만 brainstorm 해줘. 영어로 답해줘',
          response: `Here are three strong reasons you can use to support mandatory community service for college students.

## 1. Practical skills and career readiness

- Volunteering allows students to develop teamwork, communication, and problem-solving skills that employers value.
- Many students graduate with strong grades but little experience working with people outside their own social circle.

## 2. Stronger connection to the community

- Community service also teaches young people that they are responsible for the neighborhoods they live in.
- Students who help local residents often gain a deeper understanding of social problems such as loneliness among the elderly.

## 3. Personal growth and empathy

- Direct contact with people in need helps students move from abstract opinions to real understanding.
- Many volunteers report that the experience changed how they see their own priorities.

### Tips for your essay

1. State your position clearly in the first paragraph.
2. Support each reason with one specific example.
3. Use transition words such as "first," "in addition," and "as a result."

Let me know if you would like me to help with the counterargument next.`,
        },
        {
          id: 'c1t2', label: 'related',
          prompt: 'now write the counterargument and rebuttal paragraph',
          response: `Here is a sample counterargument and rebuttal paragraph that you can adapt.

## Counterargument and Rebuttal

Critics argue that forcing students to volunteer defeats the purpose of service, since true volunteering should come from free choice. They also point out that students are already under pressure from exams, tuition, and part-time jobs. However, many students never try volunteering simply because they do not know where to start, and a requirement can give them that first push. Moreover, a flexible system in which students choose the organization they serve would still respect individual interests. In this way, the requirement becomes an opportunity rather than a burden.

## Notes on the structure

- The first two sentences present the opposing view fairly.
- The word "however" signals the shift to your rebuttal.`,
        },
        {
          id: 'c1t3', label: 'related', traps: ['shortFollowup', 'longResponse'],
          prompt: 'more details',
          response: `Sure! Let me explain each reason in more detail so that you can develop full body paragraphs.

## Reason 1: Practical skills and career readiness

In today's competitive job market, employers look for more than good grades. They want graduates who can work with others, solve unexpected problems, and communicate clearly. Community service provides a natural setting for practicing these abilities. For example, a student who helps organize a food drive must coordinate with other volunteers, manage limited resources, and speak with people from different backgrounds. These experiences are difficult to reproduce in a lecture hall. Service experience also helps students connect what they learn in class with real social problems.

## Reason 2: Stronger connection to the community

Many university students live in a community for four years without really knowing the people around them. A service requirement can change this situation by bringing students into direct contact with local residents, schools, and organizations. Over time, repeated service experiences can turn a short-term obligation into a lifelong habit of civic engagement. This is important because a healthy society depends on citizens who are willing to contribute to the common good.

## Reason 3: Personal growth and empathy

Meeting people who face difficult situations can be a powerful experience. It encourages students to reflect on their own advantages and to think about how they can use them to help others. In many cases, students find that they receive as much as they give. They gain confidence, a sense of purpose, and a broader perspective on life.

## How to use this in your essay

It is important to choose one clear example for each reason and to explain how it supports your thesis. You may also use a personal story, since personal experience makes an essay more convincing. Each body paragraph should end with a sentence that links the example back to your main argument.

I hope this helps. Feel free to ask if you need more examples.`,
        },
      ],
    },
    {
      id: 'c2', provider: 'chatgpt', source: '대화-c2-chatgpt.pdf', turns: [
        {
          id: 'c2t1', label: 'related', traps: ['draft'],
          prompt: '내 intro 문단 grammar랑 어색한 표현 고쳐줘. 영어로 답해줘\n\nNowadays many college students are busy with study and part-time jobs. But I think community service should be mandatory for them. The first reason is that it can help students to learn about the real society.',
          response: `Your paragraph is clear and easy to follow. Here is a corrected version with a few small improvements.

## Revised version

Nowadays, many college students are busy with their studies and part-time jobs. However, I believe that community service should be mandatory for them. The first reason is that it helps students learn about the real world. Mandatory community service would give students practical experience that no classroom can offer.

## What I changed

1. **"study" to "their studies"**: "Study" is usually uncountable, and the possessive sounds more natural here.
2. **"But I think" to "However, I believe that"**: This sounds more formal for an academic essay.
3. **"to learn about the real society"**: Removing "to" and changing "real society" to "the real world" is more idiomatic.`,
        },
        {
          id: 'c2t2', label: 'related', traps: ['draft'],
          prompt: 'conclusion도 부탁해\n\nIn conclusion, I think that universities need to make community service mandatory. It will not only help the students but also the community. So I hope more universities will try this system.',
          response: `Good conclusion! It restates your position and ends with a hopeful note. Here is a polished version.

## Revised version

In conclusion, I believe that universities should make community service mandatory. It will benefit not only students but also the communities they live in. I therefore hope that more universities will adopt this system.

## Notes

- "need to make" to "should make" is shorter and more direct.
- "will not only help the students but also the community" is not parallel, so I used "benefit not only ... but also ...".`,
        },
      ],
    },
    {
      id: 'c3', provider: 'claude', source: '대화-c3-claude.pdf', turns: [
        {
          id: 'c3t1', label: 'borderline',
          prompt: '에세이에서 쓸 수 있는 transition words 리스트 줘. however, moreover 말고 다른 것도',
          response: `기능별로 나누어 정리해 드릴게요.

## 추가

- in addition, furthermore, besides

## 대조

- on the other hand, in contrast, nevertheless

## 예시

- for instance, to illustrate, such as

## 결과

- as a result, consequently, therefore

## 결론

- in conclusion, to sum up, all in all

한 문단에 전환어를 너무 많이 쓰면 오히려 어색해지니, 문단마다 한두 개면 충분합니다.`,
        },
        {
          id: 'c3t2', label: 'borderline',
          prompt: '영어 에세이 250 words면 문장이 대충 몇 개야? 단락마다 몇 문장 쓰는 게 좋아?',
          response: `영어 문장 하나는 평균 15~20단어 정도이므로 250 words면 대략 13~17문장입니다.

## 5단락 구성 기준

- 서론: 3문장 (배경, 흐름, 주제문)
- 본론 1~3: 각 3~4문장
- 결론: 2~3문장

분량은 과제 안내문의 기준을 우선으로 하고, 단락 길이를 비슷하게 맞추면 균형이 좋아 보입니다.`,
        },
      ],
    },
    {
      id: 'c4', provider: 'gemini', source: '대화-c4-gemini.pdf', turns: [
        {
          id: 'c4t1', label: 'unrelated', traps: ['lexicalOverlap'],
          prompt: '동아리 MT에서 내가 간식 담당 volunteer 했는데ㅋㅋ 10명이 먹을 과자랑 치킨 뭐 사면 좋을까',
          response: `10명 기준으로 간단하게 정리해 드릴게요.

## 추천 구성

- **치킨**: 3마리 정도가 적당합니다. 후라이드, 양념, 간장 맛을 섞어 주세요.
- **과자**: 포카칩, 새우깡처럼 호불호가 적은 것을 중심으로 5~6봉지 준비하세요.
- **음료**: 1.5리터 콜라와 사이다를 각각 두 병씩 챙기면 좋아요.

술을 마시는 자리라면 안주로 먹기 좋은 나초나 견과류도 조금 더하세요.`,
        },
        {
          id: 'c4t2', label: 'unrelated',
          prompt: '전 남친 인스타 계속 확인하게 되는데 끊는 방법 있을까.. 헤어진 지 두 달 됐어',
          response: `헤어진 뒤에 상대의 근황이 궁금한 것은 자연스러운 일이에요. 습관을 바꾸는 데 도움이 되는 방법을 알려드릴게요.

1. **차단 또는 숨기기**: 계정을 보이지 않게 설정하면 충동적으로 열어 보는 횟수가 크게 줄어듭니다.
2. **대체 행동 만들기**: 확인하고 싶을 때 산책이나 운동처럼 손쉬운 다른 행동을 정해 두세요.
3. **감정 적어 보기**: 어떤 마음에서 확인하고 싶은지 메모해 보면 패턴이 보입니다.

시간이 지나면서 줄어드는 것이 보통이니 스스로를 너무 몰아붙이지 마세요.`,
        },
      ],
    },
    {
      id: 'c5', provider: 'chatgpt', source: '대화-c5-chatgpt.pdf', turns: [
        {
          id: 'c5t1', label: 'unrelated',
          prompt: '일반물리 문제 풀어줘. 초속 20m로 달리던 차가 브레이크를 밟아 -4m/s²로 감속하면 정지거리는?',
          response: `등가속도 운동 공식 v² = v₀² + 2as 를 사용합니다.

## 풀이

1. 나중 속도 v = 0, 처음 속도 v₀ = 20 m/s, 가속도 a = −4 m/s² 입니다.
2. 0 = 20² + 2 × (−4) × s 이므로 8s = 400 입니다.
3. 따라서 정지거리 **s = 50 m** 입니다.`,
        },
        {
          id: 'c5t2', label: 'unrelated', traps: ['shortFollowup'],
          prompt: '더 자세히',
          response: `공식이 어떻게 나오는지 조금 더 자세히 설명해 드릴게요.

## 공식 유도

등가속도 운동에서 v = v₀ + at 이고 이동 거리는 s = v₀t + ½at² 입니다. 첫 식에서 t = (v − v₀)/a 를 구해 두 번째 식에 대입하고 정리하면 v² = v₀² + 2as 가 됩니다.

## 활용 팁

시간이 주어지지 않은 문제에서는 이 식이 가장 빠릅니다. 부호를 정할 때는 처음 운동 방향을 +로 두고, 감속이면 가속도를 음수로 쓰세요.`,
        },
      ],
    },
  ],
  segments: [
    { kind: 'studentOrigin', from: 'c2t1', traps: ['draft'], draft: 'Nowadays many college students are busy with study and part-time jobs.', text: 'Nowadays many college students are busy with study and part-time jobs.' },
    { kind: 'studentOrigin', from: 'c2t1', traps: ['draft'], draft: 'But I think community service should be mandatory for them.', text: 'But I think community service should be mandatory for them.' },
    { kind: 'studentOrigin', from: 'c2t1', traps: ['draft'], draft: 'The first reason is that it can help students to learn about the real society.', text: 'The first reason is that it can help students learn about the real society.' },
    { kind: 'verbatim', from: 'c2t1', traps: ['draft'], find: 'Mandatory community service would give students practical experience' },
    { kind: 'verbatim', from: 'c1t1', brk: 'para', find: 'Volunteering allows students to develop teamwork' },
    { kind: 'adapted', from: 'c1t3', text: 'Serving also lets students link what they study in class to the real problems of society.' },
    { kind: 'original', text: 'For example, last summer I joined a weekend program that delivered lunch boxes to elderly people in my neighborhood.' },
    { kind: 'original', traps: ['sharedTerm'], text: 'At first I only wanted to get volunteer hours for my scholarship, but I changed my mind after talking with an old man who lived alone.' },
    { kind: 'verbatim', from: 'c1t1', find: 'Community service also teaches young people' },
    { kind: 'adapted', from: 'c1t1', text: 'Meeting people who need help makes students go beyond abstract opinions and gain real understanding.' },
    { kind: 'original', traps: ['short'], text: 'That was my own experience.' },
    { kind: 'verbatim', from: 'c1t2', brk: 'para', find: 'Critics argue that forcing students to volunteer' },
    { kind: 'verbatim', from: 'c1t2', find: 'many students never try volunteering' },
    { kind: 'adapted', from: 'c1t2', text: 'Also, if students can pick the place where they serve, the system will still respect what they are interested in.' },
    { kind: 'verbatim', from: 'c1t3', find: 'repeated service experiences can turn' },
    { kind: 'original', traps: ['boilerplate'], text: "In today's world, getting a good job is not easy for anyone, even for students with high grades." },
    { kind: 'original', traps: ['genericVocab'], text: 'There are many different ways to look at this issue, and each person may have a different opinion about it.' },
    { kind: 'original', traps: ['short'], text: 'Still, it is worth trying.' },
    { kind: 'studentOrigin', from: 'c2t2', brk: 'para', traps: ['draft'], draft: 'In conclusion, I think that universities need to make community service mandatory.', text: 'In conclusion, I think that universities need to make community service mandatory.' },
    { kind: 'studentOrigin', from: 'c2t2', traps: ['draft'], draft: 'It will not only help the students but also the community.', text: 'It will not only help the students but also help the community.' },
    { kind: 'studentOrigin', from: 'c2t2', traps: ['draft'], draft: 'So I hope more universities will try this system.', text: 'So I hope more universities will try this system.' },
  ],
};
