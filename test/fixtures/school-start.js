'use strict';
// 영어 에세이 픽스처
module.exports = {
  id: 'school-start',
  meta: {
    student: 'Jamie Park', studentId: '60203456', course: 'English Composition', professor: 'Dr. Lee',
    assignment: 'Should High Schools Start Later in the Morning?',
    assignmentBrief: 'Write a persuasive essay arguing for or against later school start times. Use at least two pieces of evidence and address one counterargument.',
  },
  conversations: [
    {
      id: 'e1', provider: 'chatgpt', url: 'https://chatgpt.com/share/fixture-school-1',
      turns: [
        {
          id: 'et1', label: 'related',
          prompt: 'I need arguments for a persuasive essay supporting later school start times. Can you list some?',
          response: [
            'Here are the strongest arguments you can use for later school start times.',
            '**1. Teenage sleep biology**',
            'During puberty the body clock of adolescents shifts later, so many teenagers cannot fall asleep before eleven at night no matter how disciplined they are.',
            'When classes begin at 7:30 a.m., students are asked to wake up at an hour when their bodies are still producing sleep hormones.',
            '**2. Academic performance and health**',
            'Studies of districts that moved their start times later found improved attendance, higher grades, and fewer students falling asleep in class.',
            'Chronic sleep loss is also linked to anxiety, depression, and a weaker immune system among teenagers.',
            '**3. Safety**',
            'Drowsy teenage drivers are more likely to be involved in car crashes, and crash rates have dropped in places where schools opened later.',
            '**Counterargument to address**',
            'Critics argue that later schedules disrupt sports practice, bus routes, and after-school jobs, but districts can solve these problems with careful planning.',
          ],
        },
        {
          id: 'et2', label: 'related',
          prompt: 'tell me more',
          response: [
            'The key idea is the circadian rhythm, the internal clock that controls when we feel awake or sleepy.',
            'In adolescents, the hormone melatonin is released about two hours later than in children or adults, which makes early bedtimes biologically difficult.',
            'Researchers recommend that teenagers get between eight and ten hours of sleep each night, but an early start often limits them to six or seven.',
            'You can strengthen your essay by pointing out that the problem is not laziness but a predictable change in teenage biology.',
          ],
        },
        {
          id: 'et3', label: 'related',
          prompt: 'Give me an outline for a five paragraph persuasive essay on this.',
          response: [
            'Here is a possible outline.',
            '1. Introduction: Open with a vivid scene of sleepy students and state your thesis that high schools should start later.',
            '2. Body paragraph one: Explain how teenage sleep biology conflicts with early start times.',
            '3. Body paragraph two: Present evidence that later start times improve grades, attendance, and safety.',
            '4. Counterargument: Acknowledge concerns about sports and buses, then respond with practical solutions.',
            '5. Conclusion: Restate the thesis and call on school boards to act.',
          ],
        },
        {
          id: 'et4', label: 'related',
          prompt: [
            'Can you fix the grammar and make my paragraph sound better?',
            'Many teenagers are exhausted when they arrives at school because they could not sleeps enough the night before.',
            'It is not that students is lazy, but their bodies simply wants to sleep later than the adults around them.',
            'If schools started an hour later, I believe that student would be more focused and healthy.',
          ],
          response: [
            'Here is the revised paragraph.',
            'Many teenagers are exhausted when they arrive at school because they could not get enough sleep the night before.',
            'It is not that students are lazy; their bodies simply want to sleep later than the adults around them do.',
            'If schools started an hour later, I believe that students would be more focused and healthy.',
          ],
        },
        {
          id: 'et5', label: 'chat',
          prompt: 'What should I cook for dinner tonight? I have pasta, tomatoes, and some cheese.',
          response: [
            'With pasta, tomatoes, and cheese you can make a simple baked pasta.',
            'Boil the pasta until it is almost tender, then mix it with chopped tomatoes, garlic, and olive oil.',
            'Top the dish with grated cheese and bake it for fifteen minutes until the surface turns golden.',
            'If you have basil in the kitchen, tear a few leaves over the top before serving.',
          ],
        },
        {
          id: 'et6', label: 'chat',
          prompt: 'My roommate keeps leaving dirty dishes in the sink. How do I bring it up without starting a fight?',
          response: [
            'Choose a calm moment instead of raising the issue while you are annoyed.',
            'Start by describing how the dishes affect you rather than accusing your roommate of being careless.',
            'Suggest a simple system, such as washing your own plates the same day, and ask what would work for them.',
            'A friendly tone usually keeps the conversation from turning into an argument.',
          ],
        },
        {
          id: 'et7', label: 'chat',
          prompt: 'Which football team do you think will win the league this year?',
          response: [
            'It is hard to predict a champion this early in the season.',
            'The favorite has a deep squad and a strong defense, but injuries could change everything.',
            'Keep an eye on the teams with a good goal difference and an easy schedule after the winter break.',
            'Watching a few matches each weekend is the best way to judge form.',
          ],
        },
        {
          id: 'et8', label: 'chat',
          prompt: 'Is it a good time to buy Tesla stock? The price has dropped a lot lately.',
          response: [
            'I cannot tell you whether to buy a particular stock, but I can explain what investors usually look at.',
            'Consider the company earnings, revenue growth, and how the price compares with competitors in the market.',
            'A falling price can be a chance or a warning, depending on whether the business outlook has changed.',
            'Spreading your money across several investments reduces the risk of a large loss.',
          ],
        },
        {
          id: 'et9', label: 'chat',
          prompt: 'Recommend a few anime to watch this weekend, something with a good story.',
          response: [
            'Here are a few series with strong stories that are easy to binge.',
            'One follows two brothers searching for a way to restore their bodies after a failed experiment.',
            'Another is a mystery about a notebook that lets its owner decide who lives or dies.',
            'If you prefer something gentle, try the slice of life series about a small cafe in the countryside.',
          ],
        },
      ],
    },
    {
      id: 'e2', provider: 'gemini', url: 'https://gemini.google.com/share/fixture-school-2',
      turns: [
        {
          id: 'et10', label: 'ambiguous',
          prompt: 'How do I cite a website in APA style?',
          response: [
            'In APA style a website citation lists the author, the date, the title of the page, and the web address.',
            'If there is no author, move the title to the author position.',
            'Place the citation in a reference list at the end of your paper and cite it in the text with the author and year.',
          ],
        },
        {
          id: 'et11', label: 'ambiguous',
          prompt: 'Give me tips for writing a strong thesis statement.',
          response: [
            'A strong thesis statement makes a clear and debatable claim in one or two sentences.',
            'It should tell the reader what you will argue and hint at the reasons you will use to support it.',
            'Avoid vague words and facts that no one could disagree with.',
            'Revise your thesis after finishing the draft, because your argument often changes as you write.',
          ],
        },
        {
          id: 'et12', label: 'ambiguous',
          prompt: 'What are the pros and cons of giving high school students a lot of homework?',
          response: [
            'Homework can help students practice what they learned and build habits of independent study.',
            'However, too much homework cuts into sleep and free time, which can increase stress for teenagers.',
            'Many teachers now try to give shorter assignments that focus on quality rather than quantity.',
          ],
        },
      ],
    },
  ],
  submission: [
    [
      { how: 'own', text: 'Every morning my alarm rings at six, and every morning I wonder why a school day has to start before the sun is fully up.' },
      { how: 'own', text: 'I believe that high schools should start later because teenagers need more sleep, perform better, and stay safer when classes begin after eight thirty.' },
      { how: 'copy', from: 'et1', text: 'During puberty the body clock of adolescents shifts later, so many teenagers cannot fall asleep before eleven at night no matter how disciplined they are.' },
      { how: 'rewrite', from: 'et2', text: 'The hormone melatonin is released about two hours later in adolescents than in children or adults, so going to bed early is biologically hard for them.' },
    ],
    [
      { how: 'own', text: 'My own experience matches this, because on days when I sleep only six hours I can barely follow my first two classes.' },
      { how: 'light', from: 'et1', text: 'Studies of districts that moved their start times later found improved attendance, higher grades, and fewer students sleeping in class.' },
      { how: 'rewrite', from: 'et1', text: 'Tired teenage drivers are more likely to end up in car crashes, and in places where schools opened later, crash rates have fallen.' },
      { how: 'own', text: 'A nurse at my school told me that the clinic fills up on Monday mornings with students complaining of headaches and exhaustion.' },
    ],
    [
      { how: 'draft', from: 'et4', text: 'It is not that students is lazy, but their bodies simply wants to sleep later than the adults around them.' },
      { how: 'polish', from: 'et4', text: 'Many teenagers are exhausted when they arrive at school because they could not get enough sleep the night before.' },
      { how: 'own', text: 'Some people worry that a later schedule would hurt sports teams and bus routes, and that is a fair concern.' },
      { how: 'copy', from: 'et1', text: 'Critics argue that later schedules disrupt sports practice, bus routes, and after-school jobs, but districts can solve these problems with careful planning.' },
      { how: 'draft', from: 'et4', text: 'If schools started an hour later, I believe that student would be more focused and healthy.' },
      { how: 'own', text: 'For all these reasons, school boards should move the first bell later and give teenagers a fair chance to learn.' },
    ],
  ],
};
