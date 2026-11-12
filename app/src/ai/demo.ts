/** 演示素材：离线可用，覆盖「读—点词—答题—成绩」完整链路，不消耗任何 API。 */
import type { Article, Question, StudySnapshot } from '../types';

export const DEMO_ARTICLE: Omit<Article, 'id' | 'taskId' | 'accountId' | 'sessionId' | 'date' | 'exam' | 'createdAt' | 'favorite'> = {
  title: 'The Quiet Transfer of Attention',
  subtitle: 'Why focus has become a design problem rather than a character flaw',
  paragraphs: [
    'Every morning, before the coffee has cooled, millions of people hand their attention to a machine that was built to keep it. The ritual feels harmless: a glance at a notification, a short video, a headline that promises to explain the world in nine words. Yet the cumulative effect is not harmless at all. What looks like a series of small choices is, in practice, a quiet transfer of mental sovereignty.',
    'The mechanics are easy to describe and hard to resist. Platforms earn money by sustaining engagement, and engagement grows when content is fragmentary, emotionally urgent, and endlessly renewable. No single engineer decided that users should feel scattered; the incentive simply rewards whatever holds the eye. The result is an environment in which deliberate thought becomes an act of resistance rather than a default state.',
    'Psychologists who study attention describe two modes of work. The first is shallow: quick, reactive, and compatible with interruption. The second is deep: slow, cumulative, and dependent on an unbroken stretch of time. Deep work is where difficult ideas are born, yet it is precisely the mode that a notification-rich environment undermines. Each interruption carries a hidden cost, because returning to a complex task requires rebuilding the mental scaffolding that was just knocked down.',
    'Some researchers argue that the problem is not technology itself but the absence of boundaries around it. In experiments, students who silenced their phones for a single study session reported not only better focus but a surprising sense of relief, as if a low-grade anxiety had been switched off. The finding is subtle but important: the anxiety was never about missing something valuable; it was about the anticipation of missing it.',
    'Reclaiming attention, then, is less a matter of willpower than of design. A deliberate schedule, a phone that lives in another room, a written note of what the next hour is for — these small structures do more than any resolution. Resilience in the face of engineered distraction is not a personality trait. It is a practice, rebuilt daily, and it begins with the decision to notice where the morning actually went.',
  ],
  translation: [
    '每天早上，咖啡还没凉，数以百万计的人就把注意力交给了一台被设计来留住它的机器。这个仪式看起来无害：扫一眼通知、看一段短视频、读一个承诺用九个词解释世界的标题。然而累积起来的影响一点也不无害。看起来一连串微小的选择，实际上是一次对心智主导权的悄无声息的转让。',
    '这套机制容易描述，却难以抵抗。平台靠维持用户参与度赚钱，而当内容零碎、情绪紧迫、可无限刷新时，参与度就会上升。没有哪位工程师决定让用户变得心不在焉；只是激励机制会奖励一切能抓住眼球的东西。结果是，深思熟虑变成了一种反抗行为，而不再是默认状态。',
    '研究注意力的心理学家把工作分为两种模式。第一种是浅层：快速、反应式、与打断兼容。第二种是深层：缓慢、可累积、依赖一段不被打断的时间。艰难的想法诞生于深层工作，而通知泛滥的环境恰恰削弱的正是这一模式。每一次打断都有隐性代价，因为要回到复杂的任务，就得重建刚刚被推倒的心智脚手架。',
    '一些研究者认为，问题不在技术本身，而在于技术周围缺少边界。在实验中，把手机静音一次学习时段的学生不仅报告专注度更好，还报告了一种意外的轻松感，仿佛一种低度的焦虑被关掉了。这个发现微妙却重要：那种焦虑从来不是怕错过什么有价值的东西，而是对「可能错过」的预期。',
    '所以，收回注意力与其说是意志力问题，不如说是设计问题。一份刻意的日程、一部放在另一个房间的手机、一张写明接下来一小时做什么的便条——这些小小的结构比任何决心都更管用。面对被精心设计的干扰，韧性不是一种性格特质，而是一种每天重建的实践，它始于决定去看清这个早晨究竟去了哪里。',
  ],
  words: [
    {
      word: 'sustain',
      surface: 'sustaining',
      meaning: 'v. 维持；使持续',
      inContext: 'Platforms earn money by sustaining engagement',
      note: 'sustain growth / sustain attention',
    },
    {
      word: 'cumulative',
      surface: 'cumulative',
      meaning: 'adj. 累积的',
      inContext: 'the cumulative effect is not harmless at all',
      note: 'cumulative effect 累积效应',
    },
    {
      word: 'sovereignty',
      surface: 'sovereignty',
      meaning: 'n. 主权；主导权',
      inContext: 'a quiet transfer of mental sovereignty',
      note: '此处指对自身注意力的掌控权',
    },
    {
      word: 'fragmentary',
      surface: 'fragmentary',
      meaning: 'adj. 零碎的；不完整的',
      inContext: 'content is fragmentary, emotionally urgent',
      note: 'fragmentary information 碎片化信息',
    },
    {
      word: 'scattered',
      surface: 'scattered',
      meaning: 'adj. 分散的；心不在焉的',
      inContext: 'users should feel scattered',
      note: 'feel scattered 心思散乱',
    },
    {
      word: 'incentive',
      surface: 'incentive',
      meaning: 'n. 激励；动因',
      inContext: 'the incentive simply rewards whatever holds the eye',
      note: 'financial incentive 经济激励',
    },
    {
      word: 'deliberate',
      surface: 'deliberate',
      meaning: 'adj. 深思熟虑的；刻意的',
      inContext: 'deliberate thought becomes an act of resistance',
      note: 'deliberate 与 deliberate（vi.  deliberation）同源',
    },
    {
      word: 'undermine',
      surface: 'undermines',
      meaning: 'v. 削弱；暗中破坏',
      inContext: 'a notification-rich environment undermines',
      note: 'undermine confidence 削弱信心',
    },
    {
      word: 'subtle',
      surface: 'subtle',
      meaning: 'adj. 微妙的；不易察觉的',
      inContext: 'The finding is subtle but important',
      note: 'subtle difference 细微差别',
    },
    {
      word: 'resilience',
      surface: 'Resilience',
      meaning: 'n. 韧性；恢复力',
      inContext: 'Resilience in the face of engineered distraction',
      note: 'emotional resilience 情绪韧性',
    },
    {
      word: 'reclaim',
      surface: 'Reclaiming',
      meaning: 'v. 收回；重新夺回',
      inContext: 'Reclaiming attention, then, is less a matter of willpower',
      note: 'reclaim one’s time 夺回时间',
    },
  ],
  wordCount: 386,
  readMinutes: 3,
  themeHint: '注意力经济与深度工作',
};

type DemoQuestion = Omit<Question, 'id' | 'articleId' | 'index'>;

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    type: 'detail',
    stem: 'According to the second paragraph, why does fragmentary content spread so easily?',
    options: [
      'It costs platforms far less to produce than long-form journalism.',
      'The business model rewards whatever keeps users engaged for longer.',
      'Regulators have consistently refused to examine recommendation systems.',
      'Users explicitly ask for shorter videos when they sign up for an account.',
    ],
    answerIndex: 1,
    evidence: 'Platforms earn money by sustaining engagement, and engagement grows when content is fragmentary, emotionally urgent, and endlessly renewable.',
    explanation:
      '第二段把传播机制归因于商业模式：平台靠参与度赚钱，而零碎、情绪化、可不断刷新的内容最能提升参与度，因此 B 正确。A 讲生产成本，原文没有比较成本；C 提到监管，但原文只说「没有哪位工程师决定」，并未讨论监管；D 把用户偏好当成原因，原文恰恰说这是一种被激励结构塑造的结果。',
  },
  {
    type: 'vocab',
    stem: 'The phrase "mental scaffolding" in paragraph 3 most probably refers to ______.',
    options: [
      'the physical workspace a person arranges before starting to work',
      'the temporary notes that students take during a lecture',
      'the structured understanding built up around a difficult task',
      'the habit of checking notifications at fixed intervals',
    ],
    answerIndex: 2,
    evidence: 'returning to a complex task requires rebuilding the mental scaffolding that was just knocked down.',
    explanation:
      'scaffolding 原指施工脚手架，此处被 mental 修饰，指支撑复杂思考的结构化理解；被打断后需要「重建」，说明它是逐步搭起来的认知框架，C 正确。A 把它误解为物理空间；B 缩小为课堂笔记；D 与原文相反，固定查看通知正是打断的来源。',
  },
  {
    type: 'inference',
    stem: 'What can be inferred about the students who silenced their phones in the experiment?',
    options: [
      'They discovered that they had been missing genuinely valuable information.',
      'Their sense of relief came from no longer anticipating that they might miss something.',
      'They performed better because they had more free time without their devices.',
      'They reported stronger anxiety once the study session ended.',
    ],
    answerIndex: 1,
    evidence: 'the anxiety was never about missing something valuable; it was about the anticipation of missing it.',
    explanation:
      '原文明确区分了「错过有价值的信息」和「对可能错过的预期」，并指出焦虑来自后者，因此轻松感源于不再持续预期，B 正确。A 与原文相反；C 归因于时间变多，原文没有这种说法；D 把实验结论反转，学生报告的是 relief 而非更强的焦虑。',
  },
  {
    type: 'main',
    stem: 'Which of the following best states the author’s main point?',
    options: [
      'Digital platforms should be legally required to limit daily screen time.',
      'Attention is best protected by structural habits rather than by willpower alone.',
      'Deep work is only possible for people who avoid smartphones entirely.',
      'The anxiety of missing out is a personality trait that cannot be changed.',
    ],
    answerIndex: 1,
    evidence: 'Reclaiming attention, then, is less a matter of willpower than of design.',
    explanation:
      '末段主旨句把「收回注意力」定位为设计问题而非意志力问题，并列出一份日程、分开存放手机等具体结构，B 最贴合。A 提出立法要求，原文没有主张；C 绝对化，原文只说需要边界；D 与末段「不是性格特质，而是每日重建的实践」直接冲突。',
  },
];

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DEMO_SNAPSHOT: StudySnapshot = {
  id: 'demo|today',
  accountId: 'demo',
  date: localToday(),
  fetchedAt: Date.now(),
  source: 'demo',
  progress: { finished: 68, total: 120, studyTimeMs: 22 * 60 * 1000 },
  words: [
    { spelling: 'sustain', order: 1, response: 'VAGUE', isNew: false, isFinished: true },
    { spelling: 'cumulative', order: 2, response: 'FORGET', isNew: false, isFinished: true },
    { spelling: 'sovereignty', order: 3, response: 'FORGET', isNew: true, isFinished: true },
    { spelling: 'fragmentary', order: 4, response: 'VAGUE', isNew: true, isFinished: true },
    { spelling: 'scattered', order: 5, response: 'FAMILIAR', isNew: false, isFinished: true },
    { spelling: 'incentive', order: 6, response: 'VAGUE', isNew: false, isFinished: true },
    { spelling: 'deliberate', order: 7, response: 'FAMILIAR', isNew: false, isFinished: true },
    { spelling: 'undermine', order: 8, response: 'FORGET', isNew: false, isFinished: true },
    { spelling: 'subtle', order: 9, response: 'VAGUE', isNew: false, isFinished: true },
    { spelling: 'resilience', order: 10, response: 'FORGET', isNew: true, isFinished: true },
    { spelling: 'reclaim', order: 11, response: 'VAGUE', isNew: true, isFinished: true },
    { spelling: 'notification', order: 12, response: 'FAMILIAR', isNew: false, isFinished: true },
    { spelling: 'interruption', order: 13, response: 'VAGUE', isNew: false, isFinished: true },
    { spelling: 'boundary', order: 14, response: 'FAMILIAR', isNew: false, isFinished: true },
    { spelling: 'anticipation', order: 15, response: 'FORGET', isNew: true, isFinished: true },
    { spelling: 'willpower', order: 16, response: 'FAMILIAR', isNew: true, isFinished: true },
    { spelling: 'ritual', order: 17, response: 'VAGUE', isNew: true, isFinished: false },
    { spelling: 'reactive', order: 18, response: undefined, isNew: true, isFinished: false },
    { spelling: 'compatible', order: 19, response: undefined, isNew: true, isFinished: false },
    { spelling: 'engineered', order: 20, response: undefined, isNew: false, isFinished: false },
    { spelling: 'momentum', order: 21, response: undefined, isNew: true, isFinished: false },
    { spelling: 'scrutiny', order: 22, response: undefined, isNew: true, isFinished: false },
    { spelling: 'cognitive', order: 23, response: undefined, isNew: false, isFinished: false },
    { spelling: 'renewable', order: 24, response: undefined, isNew: true, isFinished: false },
  ],
  note: '这是演示数据，用于在没有墨墨凭证时体验完整流程。',
};
