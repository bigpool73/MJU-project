'use strict';
// 영어 기술 보고서 픽스처. 코드 블록이 든 응답, 한 단어짜리 후속 질문('more'), 무관한 영어 잡담을 포함한다.
module.exports = {
  id: 'overfitting',
  meta: {
    student: 'Alex Kim', studentId: '60208888', course: 'Intro to Machine Learning', professor: 'Dr. Choi',
    assignment: 'Understanding Overfitting in Machine Learning',
    assignmentBrief: 'Explain overfitting, show how to detect it with a validation set, and describe two techniques to reduce it. Include a short code example.',
  },
  conversations: [
    {
      id: 'oa', provider: 'claude', url: 'https://claude.ai/share/fixture-ml-1',
      turns: [
        {
          id: 'om1', label: 'related',
          prompt: 'Explain overfitting like I am a first-year student.',
          response: [
            'Overfitting happens when a model learns the training data so closely that it also memorizes the noise instead of the underlying pattern.',
            'As a result the model scores very well on the data it has seen but performs poorly on new examples.',
            'A useful comparison is a student who memorizes past exam answers without understanding the subject, then fails when the questions change.',
          ],
        },
        {
          id: 'om2', label: 'related',
          prompt: 'how do I detect it?',
          response: [
            'Split your data into a training set and a validation set, then compare the error on both.',
            'If training error keeps falling while validation error starts rising, the model is overfitting.',
            'Plotting both curves against the number of epochs makes this gap easy to spot.',
          ],
        },
        {
          id: 'om3', label: 'related',
          prompt: 'Show a short python example with regularization.',
          response: [
            'Here is a compact example using scikit-learn.',
            '```python\nfrom sklearn.linear_model import Ridge\nfrom sklearn.model_selection import train_test_split\n\nX_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2)\nmodel = Ridge(alpha=1.0)\nmodel.fit(X_train, y_train)\nprint(model.score(X_val, y_val))\n```',
            'The alpha parameter controls the strength of the L2 penalty; larger values shrink the weights and reduce overfitting.',
          ],
        },
        {
          id: 'om4', label: 'related',
          prompt: [
            'Please fix the grammar in my paragraph.',
            'Early stopping are another way to fight overfitting, it stop the training when the validation loss do not improve anymore.',
            'In my experiment the network was too big for the small dataset so it memorized everything quickly.',
          ],
          response: [
            'Here is the corrected paragraph.',
            'Early stopping is another way to fight overfitting; it stops training when the validation loss no longer improves.',
            'In my experiment the network was too big for the small dataset so it memorized everything quickly.',
          ],
        },
        {
          id: 'om5', label: 'related',
          prompt: 'What exactly is a validation set?',
          response: [
            'A validation set is a portion of your data that is held back during training.',
            'You use it to tune settings and to check whether the model generalizes beyond the examples it learned from.',
          ],
        },
        {
          id: 'om6', label: 'related',
          prompt: 'more',
          response: [
            'Another way to reduce overfitting is to collect more training data or use data augmentation, because a larger and more varied dataset makes memorizing individual examples harder.',
          ],
        },
        {
          id: 'om7', label: 'chat',
          prompt: 'I am bored. Tell me a fun fact about octopuses.',
          response: [
            'Octopuses have three hearts, and two of them pump blood to the gills.',
            'They can also squeeze through any opening larger than their beak, which is the only hard part of their body.',
          ],
        },
        {
          id: 'om8', label: 'chat',
          prompt: 'Any tips for a first date at a coffee shop?',
          response: [
            'Choose a quiet place so you can actually hear each other.',
            'Ask open questions and listen more than you talk.',
            'Keep the first meeting short so it feels relaxed rather than like an interview.',
          ],
        },
        {
          id: 'om9', label: 'chat',
          prompt: 'What are the best budget laptops for gaming this year?',
          response: [
            'For budget gaming, look for a laptop with a dedicated graphics card and at least sixteen gigabytes of memory.',
            'Models with a high refresh rate screen give a smoother experience in fast games.',
            'Check the cooling design in reviews, because thin laptops often throttle under load.',
          ],
        },
        {
          id: 'om10', label: 'chat',
          prompt: 'Can you recommend a podcast about history?',
          response: [
            'Try a narrative podcast that covers one historical event per season, with sound design and interviews.',
          ],
        },
        {
          id: 'om11', label: 'ambiguous',
          prompt: 'What is the difference between supervised and unsupervised learning?',
          response: [
            'Supervised learning trains a model on labeled examples so it can predict labels for new data.',
            'Unsupervised learning looks for structure such as clusters in data that has no labels.',
          ],
        },
        {
          id: 'om12', label: 'ambiguous',
          prompt: 'How do I install tensorflow on windows?',
          response: [
            'Create a virtual environment, activate it, and run pip install tensorflow.',
            'Make sure your python version is supported.',
          ],
        },
      ],
    },
  ],
  submission: [
    [
      { how: 'own', text: 'When I trained my first image classifier, I was thrilled by its ninety nine percent accuracy until I tested it on photos I had taken myself.' },
      { how: 'copy', from: 'om1', text: 'Overfitting happens when a model learns the training data so closely that it also memorizes the noise instead of the underlying pattern.' },
      { how: 'rewrite', from: 'om2', text: 'You can spot overfitting by comparing the error on the training set with the error on a validation set, because the validation error starts rising while training error keeps falling.' },
      { how: 'own', text: 'In my case the gap appeared after only a few epochs, which told me that the network was too large for the small dataset I was using.' },
    ],
    [
      { how: 'copy', from: 'om3', text: 'The alpha parameter controls the strength of the L2 penalty; larger values shrink the weights and reduce overfitting.' },
      { how: 'polish', from: 'om4', text: 'Early stopping is another way to fight overfitting; it stops training when the validation loss no longer improves.' },
      { how: 'draft', from: 'om4', text: 'In my experiment the network was too big for the small dataset so it memorized everything quickly.' },
      { how: 'light', from: 'om6', text: 'Another way to reduce overfitting is to collect more training data or use data augmentation, because a larger and more varied dataset makes memorizing individual examples much harder.' },
      { how: 'own', text: 'Saving the model with the lowest validation loss was easy to apply, so it became my second technique.' },
    ],
  ],
};
