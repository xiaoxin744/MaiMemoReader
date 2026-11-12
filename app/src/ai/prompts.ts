/**
 * Prompt 工坊：按考试模式拆分的可维护模板。
 * 每个阶段独立成文，方便单独调整，也方便在「设置 → 高级」里查看当前策略。
 */
import type { Article, ExamMode, GenerateOptions, Question, SelectionPlan, StudySnapshot, StudyWord } from '../types';

export interface ExamProfile {
  id: ExamMode;
  name: string;
  short: string;
  words: [number, number];
  sentenceLength: string;
  lexicon: string;
  syntax: string;
  structure: string;
  reasoning: string;
  questionMix: string;
  distractor: string;
  lengthHint: string;
}

export const EXAM_PROFILES: Record<ExamMode, ExamProfile> = {
  cet4: {
    id: 'cet4',
    name: 'CET-4 大学英语四级',
    short: '四级',
    words: [340, 430],
    sentenceLength: '平均 14–18 词，最长句不超过 32 词；以简单句与并列句为主，定语从句、状语从句点到为止',
    lexicon: '以四级核心词为主，允许少量六级词但必须能从上下文推断；避免学术生僻词堆叠',
    syntax: '少用倒装、省略与多重嵌套；被动语态控制在 15% 以内',
    structure: '总—分或时间线清晰的说明/叙事；段落之间用明显的连接词推进',
    reasoning: '推理只需一步：因果、对比、举例即可支撑结论',
    questionMix: '2 道细节理解 + 1 道主旨 + 1 道词义/指代 + 1 道简单推断',
    distractor: '干扰项用「原文提过但答非所问」「程度被夸大」「主体被替换」三种手法，不要制造文字游戏',
    lengthHint: '短文，通读 3 分钟内可完成',
  },
  cet6: {
    id: 'cet6',
    name: 'CET-6 大学英语六级',
    short: '六级',
    words: [440, 560],
    sentenceLength: '平均 18–24 词，允许 40 词左右的长句，含非限定从句与插入语',
    lexicon: '六级核心词为主，可出现抽象名词化表达（如 the erosion of trust）',
    syntax: '允许名词化、分词结构、倒装强调；句间指代需读者自行追踪',
    structure: '论证型：现象—分析—反方—作者立场；段落主题句可后置',
    reasoning: '需要两步推理，能区分事实陈述与作者评价',
    questionMix: '2 细节 + 1 推断 + 1 作者态度 + 1 篇章结构/写作目的',
    distractor: '干扰项混合「局部正确」「偷换因果」「绝对化」；正确答案需要综合两句以上信息',
    lengthHint: '中等篇幅，适合一次精读',
  },
  kaoyan1: {
    id: 'kaoyan1',
    name: '考研英语一',
    short: '英一',
    words: [400, 460],
    sentenceLength: '平均 22–30 词，刻意保留 2–3 个 45 词以上的多从句长句',
    lexicon: '考研核心词 + 学术评论常用抽象词；允许熟词僻义，但须由上下文锁定',
    syntax: '多重修饰、后置定语、让步与转折叠加；避免为了难而写病句',
    structure: '典型《经济学人》式评论：具体事例开篇 → 提出争议 → 引述对立观点 → 作者让步后收束',
    reasoning: '要求识别隐含前提、作者未明说的态度、反讽与让步中的真正立场',
    questionMix: '2 细节/因果 + 1 词义句意 + 1 推断 + 1 作者态度或段落作用',
    distractor: '干扰项必须复现原文词汇但改变逻辑关系（因果倒置、范围扩大、时态偏移），或把他人观点安到作者头上',
    lengthHint: '与真题单篇阅读接近（约 400 词）',
  },
  kaoyan2: {
    id: 'kaoyan2',
    name: '考研英语二',
    short: '英二',
    words: [390, 450],
    sentenceLength: '平均 20–26 词，长句以并列与从句组合为主，逻辑标记更明确',
    lexicon: '考研核心词，偏商务、科技、社会议题的实用表达',
    syntax: '结构清晰，允许数据、流程、比较关系的表达；少用文学化修辞',
    structure: '说明+评述：现状/数据 → 原因 → 影响 → 建议；观点分布均匀',
    reasoning: '推理链条清晰，但需要辨别数据与结论之间的跳跃',
    questionMix: '2 细节 + 1 推断 + 1 词义/句意 + 1 主旨或作者建议',
    distractor: '干扰项用「数据错位」「范围不符」「把建议说成事实」，避免与原文高度雷同的句子',
    lengthHint: '与英语二真题单篇接近（约 400 词）',
  },
};

const STATUS_LABEL: Record<string, string> = {
  FORGET: '忘记',
  VAGUE: '模糊',
  FAMILIAR: '认识',
  WELL_FAMILIAR: '熟知',
};

function describeWords(words: StudyWord[]): string {
  return words
    .map((w) => {
      const tags: string[] = [];
      if (w.response) tags.push(STATUS_LABEL[w.response] ?? w.response);
      if (w.isNew) tags.push('新学');
      if (!w.isFinished) tags.push('今日未完成');
      return `${w.spelling}${tags.length ? `（${tags.join('/')}）` : ''}`;
    })
    .join('、');
}

export function lengthTarget(options: GenerateOptions): string {
  const base = EXAM_PROFILES[options.exam].words;
  const factor = options.length === 'short' ? 0.82 : options.length === 'long' ? 1.22 : 1;
  return `${Math.round(base[0] * factor)}–${Math.round(base[1] * factor)} 词`;
}

const JSON_RULES = `输出要求：
1. 只输出一个 JSON 对象，不要 Markdown、不要代码围栏、不要额外解释。
2. 所有字符串使用英文半角标点；正文中的引号请用 "" 或转义，确保 JSON 合法。
3. 字段缺失会导致前端校验失败，请严格按给定字段名输出。`;

/* ------------------------------------------------------------------ */
/* 阶段 1：智能选词与组篇规划                                            */
/* ------------------------------------------------------------------ */

export function selectionPrompt(snapshot: StudySnapshot, options: GenerateOptions, avoidWords: string[]) {
  const profile = EXAM_PROFILES[options.exam];
  const words = snapshot.words;
  const hard = words.filter((w) => w.response === 'FORGET' || w.response === 'VAGUE');
  const fresh = words.filter((w) => w.isNew);
  const system = `你是一位熟悉中国考研与四六级命题规律的精读主编，负责从用户当天的墨墨学习单词里挑选值得进入文章的词，并规划文章结构。
你的判断标准，按优先级：
1. 记忆状态：忘记/模糊 > 新学 > 认识 > 熟知。熟知的词只在不破坏表达时才用。
2. 语义可组合性：能围绕一个具体主题形成 3–5 个语义簇的词优先。
3. 主题适配：与 ${profile.name} 常见话题（科技、教育、环境、经济、社会心理、文化）匹配度高的词优先。
4. 表达自然度：会被迫写成「单词展览」的词直接放弃，不要为了覆盖率硬塞。

你不必覆盖全部单词。目标：核心词 ${Math.min(12, Math.max(6, Math.round(words.length / 12)))} 个左右，辅助词若干，其余明确放弃并说明原因。
如果当天词量很大（100 词以上）且语义分成两三个明显不相关的簇，可以规划 2–3 篇不同主题的文章；否则只规划 1 篇。${
    options.articleMode === 'single' ? '用户已选择「单篇」，必须只规划 1 篇。' : '用户选择「自动组篇」，由你判断篇数与主题切分。'
  }

${JSON_RULES}
JSON 结构：
{
  "summary": "一句话说明本次选词的整体思路（中文，40 字内）",
  "picks": [{ "word": "英文原形", "role": "core|support", "reason": "中文理由，20 字内，说明为何值得优先融入" }],
  "dropped": [{ "word": "英文原形", "reason": "中文理由，20 字内" }],
  "articles": [{ "title": "英文暂定标题", "angle": "中文说明主题与切入角度", "targetWords": ["分配给这篇文章的单词"] }],
  "articleCount": 文章数量(整数 1-3)
}`;
  const session =
    avoidWords.length > 0
      ? `\n今天已经生成过的文章里用过的词，请优先换角度或换词，避免重复：${avoidWords.join('、')}。`
      : '';
  const user = `【当日学习数据】日期 ${snapshot.date}，共 ${words.length} 词。
进度：${snapshot.progress ? `${snapshot.progress.finished}/${snapshot.progress.total}，学习时长 ${Math.round((snapshot.progress.studyTimeMs || 0) / 60000)} 分钟` : '未提供'}。
忘记/模糊（${hard.length}）：${hard.map((w) => w.spelling).join('、') || '无'}
新学（${fresh.length}）：${fresh.map((w) => w.spelling).join('、') || '无'}
全部单词与状态：${describeWords(words)}

【目标考试】${profile.name}
【词汇层级】${profile.lexicon}
【用户主题偏好】${options.theme.trim() || '不限，由你判断'}
【难度档位】${options.difficulty}/5（5 最难）
【篇幅】${lengthTarget(options)}${session}`;
  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 阶段 2：英文精读文章生成                                              */
/* ------------------------------------------------------------------ */

export function articlePrompt(
  plan: SelectionPlan,
  planArticle: SelectionPlan['articles'][number],
  options: GenerateOptions,
  previous: { titles: string[]; usedWords: string[] } | null,
) {
  const profile = EXAM_PROFILES[options.exam];
  const assigned = planArticle.targetWords;
  const system = `你是一位英文专栏作者，同时熟悉 ${profile.name} 的阅读文章风格。请写一篇完全原创的英文文章，把指定单词自然地织进论证里。

【${profile.name} 写作规格】
- 篇幅：${lengthTarget(options)}（不含标题）
- 句法：${profile.sentenceLength}
- 用词：${profile.lexicon}；句法要求：${profile.syntax}
- 篇章：${profile.structure}
- 推理强度：${profile.reasoning}
- 难度档位 ${options.difficulty}/5：${options.difficulty >= 4 ? '允许更抽象的概念与更密的修饰，但仍须逻辑自洽' : '优先保证可读性与信息清晰'}

【硬性约束】
1. 每段 3–6 句，共 4–6 段；不使用小标题、不用列表。
2. 指定单词必须用在有意义的论证位置，不能一句话塞多个词凑数；每个核心词至少出现 1 次，允许合理的词形变化（时态、单复数、派生）。
3. 文章必须有真实的信息密度：具体场景、数据、因果链或对立观点，不要空泛口号。
4. 不使用版权文本、不引用真实媒体的整句；引用观点请自拟。
5. 英文正文避免中式英语，避免 the、very 等空词的堆砌。
6. 中文译文按段对应，忠实但可读，不要逐字硬译。

${JSON_RULES}
JSON 结构：
{
  "title": "英文标题（8 词内，有信息量，不要副标题式口号）",
  "subtitle": "一行英文导语（可选，20 词内）",
  "paragraphs": ["英文段落1", "英文段落2"],
  "translation": ["对应段落1的中文", "对应段落2的中文"],
  "words": [{ "word": "目标词原形", "surface": "文中实际形态", "meaning": "在此语境下的中文释义", "inContext": "文中包含该词的那一小句（英文，12 词内）", "note": "搭配或语用提示（可选，中文，20 字内）" }]
}`;
  const prev =
    previous && (previous.titles.length || previous.usedWords.length)
      ? `\n【接续上下文】今天已经写过：${previous.titles.join(' / ') || '无'}。已用过的词：${previous.usedWords.slice(0, 60).join('、')}。
这是同一天的另一篇，请换主题、换论证角度、换开头方式；可以复用少量核心词，但不要重复上一版的句式与例子。不是续写，不要承接上一篇的情节。`
      : '';
  const user = `【本篇任务】${planArticle.angle}
【暂定标题】${planArticle.title}
【主题偏好】${options.theme.trim() || '由你根据单词决定'}
【必须融入的单词（${assigned.length} 个）】${assigned.join('、')}
【可以在自然时使用、否则放弃的辅助词】${plan.picks.filter((p) => p.role === 'support').map((p) => p.word).join('、') || '无'}
【选词思路】${plan.summary}${prev}`;
  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 阶段 3：阅读理解命题                                                  */
/* ------------------------------------------------------------------ */

export function questionsPrompt(article: Article, options: GenerateOptions) {
  const profile = EXAM_PROFILES[options.exam];
  const count = options.questionCount;
  const system = `你是 ${profile.name} 阅读命题人。基于给定文章出 ${count} 道四选一单选题，要求与真题难度、题型分布一致。

【题型分布】${profile.questionMix}（按此比例取前 ${count} 道，可微调但必须覆盖 3 种以上题型）
【干扰项设计】${profile.distractor}
【硬性约束】
1. 每题只有一个正确选项，且必须能由原文直接或经一步推理确证；其余三项必须有明确错误原因。
2. 题干用英文，问法符合真题习惯（如 What can be inferred from paragraph 3? / The author suggests that ...）。
3. 选项长度接近（8–22 词），避免正确项明显更长或更短；不要出现 "all of the above"。
4. evidence 必须是原文中逐字出现的完整句子（不改写、不合并），用于前端定位。
5. explanation 用中文写 60–120 字：先点明正确项依据，再逐一说明干扰项错在哪（可用一句话概括共性错误）。
6. 不要在题干或选项里泄露答案；不要在解析之外的地方出现「正确答案是 X」。

${JSON_RULES}
JSON 结构：
{
  "questions": [{
    "type": "detail|main|inference|vocab|attitude|structure",
    "stem": "英文题干",
    "options": ["A 项", "B 项", "C 项", "D 项"],
    "answerIndex": 0,
    "evidence": "原文逐字句子",
    "explanation": "中文解析"
  }]
}`;
  const body = article.paragraphs.map((p, i) => `[P${i + 1}] ${p}`).join('\n\n');
  const user = `【文章标题】${article.title}
【文章正文】
${body}

【目标词】${article.words.map((w) => w.word).join('、')}
请输出 ${count} 道题。`;
  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 阶段 4：解析补全（仅当质检发现解析/证据不足时调用）                    */
/* ------------------------------------------------------------------ */

export function explanationRepairPrompt(article: Article, weak: Question[]) {
  const system = `你是阅读题审校。下面这些题目的解析或原文依据不合格，请重写它们，保持题干、选项、答案不变。
${JSON_RULES}
JSON 结构：
{ "fixes": [{ "index": 题目序号(从 0 开始), "evidence": "原文逐字句子", "explanation": "中文解析 60-120 字" }] }`;
  const user = `【文章】
${article.paragraphs.map((p, i) => `[P${i + 1}] ${p}`).join('\n\n')}

【待修复题目】
${weak
  .map(
    (q) =>
      `#${q.index} ${q.stem}\n选项：${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join(' | ')}\n答案：${String.fromCharCode(65 + q.answerIndex)}\n现有依据：${q.evidence || '（空）'}\n现有解析：${q.explanation || '（空）'}`,
  )
  .join('\n\n')}`;
  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 阶段 5：生成内容质量检查                                              */
/* ------------------------------------------------------------------ */

export function qaPrompt(article: Article, questions: Question[]) {
  const system = `你是精读产品的质检编辑。逐项检查下面这篇文章与题目，只报告确实存在的问题，不要为了挑错而挑错。
检查项：
1. 单词覆盖：words 里列出的词是否真的出现在正文中（含词形变化）；是否有正文出现但未登记的目标词。
2. 语言质量：语法错误、明显的中式英语、重复句式。
3. 题目一致性：evidence 是否为原文原句；answerIndex 是否与解析结论一致；是否存在两个都能成立的选项。
4. 译文：是否有整段漏译或明显误译。
${JSON_RULES}
JSON 结构：
{
  "pass": true,
  "notes": ["中文提醒，每条 30 字内，最多 5 条"],
  "coverageIssues": ["未在正文出现的词"],
  "questionIssues": [{ "index": 题号(从0开始), "problem": "中文描述" }]
}`;
  const user = `【标题】${article.title}
【正文】
${article.paragraphs.map((p, i) => `[P${i + 1}] ${p}`).join('\n\n')}

【登记词汇】${article.words.map((w) => `${w.word}→${w.surface}`).join('、')}

【题目】
${questions
  .map(
    (q) =>
      `#${q.index} [${q.type}] ${q.stem}\n${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}\n答案：${String.fromCharCode(65 + q.answerIndex)}\n依据：${q.evidence}`,
  )
  .join('\n\n')}`;
  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 阅读器点词：语境释义（本地缓存，按需触发）                             */
/* ------------------------------------------------------------------ */

export function glossPrompt(word: string, sentence: string, exam: ExamMode) {
  const profile = EXAM_PROFILES[exam];
  const system = `你是词典编辑，为中文母语的英语学习者解释单词在具体句子中的意思。
${JSON_RULES}
JSON 结构：
{ "meaning": "该语境下的中文释义（20 字内，标词性）", "context": "一句话说明它在这句里的作用（30 字内）", "collocation": "常用搭配 1-2 个（可选）" }`;
  const user = `单词：${word}
句子：${sentence}
学习者目标：${profile.name}`;
  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 联网检索：公开真题风格资料（仅作风格参考，不复制原文）                  */
/* ------------------------------------------------------------------ */

export function researchQueries(exam: ExamMode, theme: string): string[] {
  const profile = EXAM_PROFILES[exam];
  const topic = theme.trim() || 'technology and society';
  return [
    `${profile.name} 阅读真题 文章来源 话题 风格`,
    `${topic} english essay ${exam === 'cet4' || exam === 'cet6' ? 'cet reading' : '考研英语 阅读'} site:edu.cn`,
  ];
}

export function researchDigest(hits: { title: string; summary: string }[]): string {
  if (!hits.length) return '';
  return hits
    .slice(0, 6)
    .map((h, i) => `${i + 1}. ${h.title} —— ${h.summary.slice(0, 160)}`)
    .join('\n');
}
