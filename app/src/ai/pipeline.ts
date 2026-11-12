/**
 * 生成管线：分阶段执行 + 逐阶段落盘（IndexedDB）。
 * 任一阶段失败只标记该阶段，已完成阶段的结果不会被丢弃，也不会自动重发付费请求。
 */
import { idb } from '../lib/db';
import { AppError, explainAny, type ExplainedError } from '../lib/errors';
import { countWords, readingMinutes } from '../lib/text';
import type {
  ApiProvider,
  Article,
  GenerationTask,
  Question,
  SelectionPlan,
  StudySnapshot,
  UsageTotal,
} from '../types';
import {
  apiConfigError,
  chat,
  costOf,
  extractJson,
  searchWeb,
  type ApiTarget,
  type ChatMessage,
  type TokenUsage,
} from '../api/deepseek';
import {
  articlePrompt,
  explanationRepairPrompt,
  qaPrompt,
  questionsPrompt,
  researchDigest,
  researchQueries,
  selectionPrompt,
} from './prompts';
import {
  buildArticle,
  checkTranslationAlignment,
  checkWordCoverage,
  MIN_WORDS_BY_LENGTH,
  validateArticle,
  validateQa,
  validateQuestions,
  validateRepairs,
  validateSelection,
} from './validate';
import { DEMO_ARTICLE, DEMO_QUESTIONS } from './demo';

export type StageName = 'snapshot' | 'selection' | 'article' | 'questions' | 'qa' | 'save';

export interface PipelineProgress {
  stage: StageName;
  progress: number;
  detail: string;
}

export interface PipelineHooks {
  onProgress: (p: PipelineProgress) => void;
  onDelta?: (chunk: string) => void;
  onTask: (task: GenerationTask) => void;
  onNotice?: (text: string) => void;
}

export interface PipelineInput {
  task: GenerationTask;
  snapshot: StudySnapshot;
  /** 本次使用的接口（官方 DeepSeek 或自定义 OpenAI 兼容服务），由设置解析后传入 */
  target: ApiTarget;
  signal: AbortSignal;
  previousArticles: Article[];
  demo?: boolean;
}

const STUDIO: Record<StageName, [number, number]> = {
  snapshot: [2, 8],
  selection: [10, 26],
  article: [28, 68],
  questions: [70, 84],
  qa: [86, 96],
  save: [97, 100],
};

function emptyUsage(): UsageTotal {
  return { promptTokens: 0, completionTokens: 0, costCny: 0, calls: 0, searchCalls: 0, costKnown: true };
}

function addUsage(
  total: UsageTotal,
  usage: TokenUsage,
  model: string,
  searchCalls = 0,
  provider: ApiProvider = 'deepseek',
): UsageTotal {
  return {
    promptTokens: total.promptTokens + (usage.prompt_tokens ?? 0),
    completionTokens: total.completionTokens + (usage.completion_tokens ?? 0),
    costCny: total.costCny + costOf(model, usage, searchCalls, provider),
    calls: total.calls + 1,
    searchCalls: total.searchCalls + searchCalls,
    // 自定义服务商的计价未知：保留 token 数，但不要把估算的 0 元说成真实费用
    costKnown: (total.costKnown ?? true) && provider !== 'custom',
  };
}

/** 从半截 JSON 里尽量抽出已经写完的正文，用于流式预览 */
export function previewFromPartial(raw: string): string {
  const start = raw.indexOf('"paragraphs"');
  if (start < 0) return raw.slice(-600);
  const body = raw.slice(start);
  const matched = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((s) => s.length > 30);
  if (!matched.length) return raw.slice(-600);
  return matched
    .map((s) => s.replace(/\\n/g, '\n').replace(/\\"/g, '"'))
    .join('\n\n')
    .slice(-1200);
}

async function save(task: GenerationTask): Promise<void> {
  task.updatedAt = Date.now();
  await idb.put('tasks', task.id, task);
}

function slice(studio: [number, number], ratio: number): number {
  const [from, to] = studio;
  return Math.round(from + (to - from) * Math.min(1, Math.max(0, ratio)));
}

export async function runPipeline(input: PipelineInput, hooks: PipelineHooks): Promise<GenerationTask> {
  const { task, snapshot, target, signal, previousArticles } = input;
  const options = task.options;
  const configError = apiConfigError(target);
  if (configError && !input.demo) {
    throw new AppError('deepseek', configError, { provider: target.provider });
  }

  task.status = 'running';
  task.error = undefined;
  task.usage = task.usage ?? emptyUsage();
  await save(task);
  hooks.onTask({ ...task });

  const say = (stage: StageName, ratio: number, detail: string) => {
    task.stage = stage;
    task.progress = slice(STUDIO[stage], ratio);
    hooks.onProgress({ stage, progress: task.progress, detail });
  };

  const callJson = async (
    messages: ChatMessage[],
    maxTokens: number,
  ): Promise<{ raw: string; usage: TokenUsage }> => {
    const res = await chat(messages, {
      apiKey: target.apiKey,
      provider: target.provider,
      baseUrl: target.baseUrl,
      model: target.model,
      json: true,
      thinking: options.thinking,
      maxTokens,
      signal,
    });
    return { raw: res.content, usage: res.usage };
  };

  try {
    /* ---------------- 阶段 1：选词与规划 ---------------- */
    if (!task.plan) {
      say('selection', 0, '正在把今天的单词按语义排队');
      const usedWords = previousArticles.flatMap((a) => a.words.map((w) => w.word));
      // 联网检索是 DeepSeek 官方工具（按次计费），自定义接口没有对应能力
      const research =
        options.webSearch && target.provider === 'deepseek' && !input.demo
          ? await runResearch(target.apiKey, options, task, hooks)
          : '';
      const { system, user } = selectionPrompt(snapshot, options, usedWords);
      const { raw, usage } = await callJson(
        [
          { role: 'system', content: system },
          { role: 'user', content: research ? `${user}\n\n【公开资料风格参考（只参考话题与行文风格，禁止照抄句子）】\n${research}` : user },
        ],
        3000,
      );
      task.usage = addUsage(task.usage, usage, target.model, 0, target.provider);
      const plan = validateSelection(extractJson(raw), snapshot.words.map((w) => w.spelling));
      task.plan = plan;
      task.totalArticles = plan.articles.length;
      task.articleIndex = 0;
      say('selection', 1, `已选定 ${plan.picks.length} 个词，规划 ${plan.articleCount} 篇`);
      await save(task);
      hooks.onTask({ ...task });
    }

    const plan = task.plan as SelectionPlan;

    /* ---------------- 阶段 2：文章正文 ---------------- */
    let planArticle = plan.articles[Math.min(task.articleIndex, plan.articles.length - 1)];
    let article: Article | undefined = task.articles[task.articleIndex];

    if (!article) {
      say('article', 0.02, '正在给这些词找一个合适的场景');
      const pendingWords = planArticle ? planArticle.targetWords : plan.picks.map((p) => p.word);
      const previous = previousArticles.length
        ? {
            titles: previousArticles.map((a) => a.title),
            usedWords: previousArticles.flatMap((a) => a.words.map((w) => w.word)),
          }
        : null;
      if (!planArticle) {
        planArticle = { title: 'Today’s Reading', angle: plan.summary, targetWords: pendingWords };
      }
      const { system, user } = articlePrompt(plan, planArticle, options, previous);
      let streamed = '';
      let lastFlush = 0;
      const res = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          apiKey: target.apiKey,
          provider: target.provider,
          baseUrl: target.baseUrl,
          model: target.model,
          json: true,
          thinking: options.thinking,
          maxTokens: options.length === 'long' ? 7000 : 5200,
          signal,
          onDelta: (chunk) => {
            streamed += chunk;
            task.partialText = streamed;
            hooks.onDelta?.(chunk);
            const targetChars = options.length === 'long' ? 5200 : 3600;
            say('article', Math.min(0.95, streamed.length / targetChars), '正在写正文');
            const now = Date.now();
            if (now - lastFlush > 900) {
              lastFlush = now;
              void save(task);
            }
          },
        },
      );
      task.usage = addUsage(task.usage, res.usage, target.model, 0, target.provider);
      const draft = validateArticle(extractJson(res.content), MIN_WORDS_BY_LENGTH[options.length]);
      const wordCount = countWords(draft.paragraphs);
      article = buildArticle(
        draft,
        {
          id: `${task.id}-a${task.articleIndex + 1}`,
          taskId: task.id,
          accountId: task.accountId,
          sessionId: task.sessionId,
          date: task.date,
          exam: options.exam,
          createdAt: Date.now(),
          favorite: false,
          themeHint: options.theme.trim() || undefined,
        },
        wordCount,
        readingMinutes(wordCount),
      );
      task.articles[task.articleIndex] = article;
      task.partialText = undefined;
      task.partialTitle = article.title;
      say('article', 1, `正文完成，共 ${wordCount} 词`);
      await save(task);
      hooks.onTask({ ...task });
      await idb.put('articles', article.id, article);
    }

    // 供质量阶段做确定性检查的视图（article 已含 paragraphs / translation / words）
    const draftView = {
      title: article.title,
      paragraphs: article.paragraphs,
      translation: article.translation,
      words: article.words,
    };

    /* ---------------- 阶段 3：命题 ---------------- */
    let questions: Question[] = task.questions[article.id] ?? [];
    if (!questions.length) {
      say('questions', 0.1, '正在设计干扰项');
      const { system, user } = questionsPrompt(article, options);
      const { raw, usage } = await callJson(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        3000,
      );
      task.usage = addUsage(task.usage, usage, target.model, 0, target.provider);
      const parsed = validateQuestions(extractJson(raw), article.id, options.questionCount);
      questions = parsed.questions;
      task.questions[article.id] = questions;
      // 命题阶段的确定性校验结果，留到质量阶段一起汇报
      task.qaNotes = parsed.issues.length ? parsed.issues : undefined;
      say('questions', 1, `${questions.length} 道题已就位`);
      await save(task);
      hooks.onTask({ ...task });
    }

    /* ---------------- 阶段 4：质量检查 ---------------- */
    if (!task.qaNotes) {
      say('qa', 0.1, '正在复核答案与原文依据');
      const { system, user } = qaPrompt(article, questions);
      try {
        const { raw, usage } = await callJson(
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          1800,
        );
        task.usage = addUsage(task.usage, usage, target.model, 0, target.provider);
        const report = validateQa(extractJson(raw));

        // ---- 先跑确定性检查，不依赖 AI 自评 ----
        const detIssues: string[] = [];
        const coverage = checkWordCoverage(draftView, planArticle ? planArticle.targetWords : []);
        if (coverage.missing.length) {
          detIssues.push(`以下目标词未在正文出现：${coverage.missing.slice(0, 12).join('、')}`);
        }
        detIssues.push(...checkTranslationAlignment(draftView));

        // ---- 再合并 AI 质检意见 ----
        const notes: string[] = [];
        if (detIssues.length) notes.push('【程序检查】', ...detIssues, '');
        if (!report.pass) {
          notes.push('【AI 质量检查未通过】');
        }
        notes.push(...report.notes);
        if (report.coverageIssues.length) notes.push(`AI 认为以下词未在正文出现：${report.coverageIssues.join('、')}`);
        report.questionIssues.forEach((q) => notes.push(`第 ${q.index + 1} 题：${q.problem}`));

        const weak = questions.filter((q) => !q.evidence || q.explanation.length < 40);
        if (weak.length) {
          say('qa', 0.6, '正在补全解析与证据定位');
          const repair = explanationRepairPrompt(article, weak);
          const fixRes = await callJson(
            [
              { role: 'system', content: repair.system },
              { role: 'user', content: repair.user },
            ],
            1800,
          );
          task.usage = addUsage(task.usage, fixRes.usage, target.model, 0, target.provider);
          const { fixes } = validateRepairs(extractJson(fixRes.raw));
          questions = questions.map((q) => {
            const fix = fixes.find((f) => f.index === q.index);
            return fix ? { ...q, evidence: fix.evidence || q.evidence, explanation: fix.explanation || q.explanation } : q;
          });
        }
        task.questions[article.id] = questions;
        const clean = notes.filter((n) => n && n.trim()).length > 0;
        if (!clean) {
          task.qaNotes = ['质量检查通过：词汇覆盖、译文对齐、答案与原文依据一致。'];
        } else {
          // 有问题的项一律保留，让用户在阅读页看到，不粉饰为"通过"
          task.qaNotes = notes.filter((n) => n !== '' || n === '');
        }
      } catch (err) {
        if (signal.aborted) throw err;
        // 质检属于增强阶段，失败不阻断交付
        task.qaNotes = [`质量检查未完成：${explainAny(err).title}。文章与题目已保存，可正常练习。`];
      }
      say('qa', 1, '检查完成');
      await save(task);
      hooks.onTask({ ...task });
    }

    /* ---------------- 收尾 ---------------- */
    say('save', 0.5, '正在把文章放进书架');
    await idb.put('articles', article.id, article);
    // 必须等所有题目落盘后再标完成，否则阅读页可能读到不完整的题目集合
    await Promise.all(questions.map((q) => idb.put('questions', q.id, q)));
    task.status = 'complete';
    task.stage = 'done';
    task.progress = 100;
    task.partialText = undefined;
    await save(task);
    hooks.onTask({ ...task });
    return task;
  } catch (err) {
    const explained: ExplainedError = explainAny(err);
    task.status = signal.aborted ? 'interrupted' : 'failed';
    task.error = `${explained.title}｜${explained.action}`;
    await save(task);
    hooks.onTask({ ...task });
    throw err;
  }
}

async function runResearch(
  apiKey: string,
  options: GenerationTask['options'],
  task: GenerationTask,
  hooks: PipelineHooks,
): Promise<string> {
  try {
    const hits: { title: string; summary: string }[] = [];
    for (const q of researchQueries(options.exam, options.theme)) {
      const res = await searchWeb(apiKey, q, 5);
      res.forEach((h) => hits.push({ title: h.title, summary: h.summary }));
      task.usage = {
        ...(task.usage ?? emptyUsage()),
        searchCalls: (task.usage?.searchCalls ?? 0) + 1,
        costCny: (task.usage?.costCny ?? 0) + 0.005,
        calls: (task.usage?.calls ?? 0) + 1,
      };
    }
    hooks.onNotice?.(`已联网检索 ${hits.length} 条公开资料，仅用于风格参考`);
    return researchDigest(hits);
  } catch (err) {
    hooks.onNotice?.(`联网检索未成功，已回退为离线生成：${explainAny(err).title}`);
    return '';
  }
}

/** 演示模式：本地固定素材，走完整阅读 / 答题 / 存档链路，不产生任何 API 费用 */
export function buildDemoTask(snapshot: StudySnapshot, exam: GenerationTask['exam'], sessionId: string): GenerationTask {
  const now = Date.now();
  const taskId = `demo-${now}`;
  const articleId = `${taskId}-a1`;
  const article: Article = {
    ...DEMO_ARTICLE,
    id: articleId,
    taskId,
    accountId: snapshot.accountId,
    sessionId,
    date: snapshot.date,
    exam,
    createdAt: now,
    favorite: false,
  };
  const questions: Question[] = DEMO_QUESTIONS.map((q, i) => ({
    ...q,
    id: `${articleId}-q${i + 1}`,
    articleId,
    index: i,
  }));
  return {
    id: taskId,
    accountId: snapshot.accountId,
    date: snapshot.date,
    exam,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    stage: 'selection',
    progress: 0,
    articleIndex: 0,
    totalArticles: 1,
    sessionId,
    options: {
      exam,
      theme: '',
      length: 'medium',
      difficulty: 3,
      questionCount: questions.length,
      articleMode: 'single',
      continueSession: false,
      webSearch: false,
      model: 'deepseek-flash',
      thinking: false,
    },
    plan: {
      summary: '演示模式：用固定素材展示选词、成文与命题的完整链路',
      picks: article.words.map((w) => ({ word: w.word, role: 'core' as const, reason: '演示选词' })),
      dropped: [],
      articles: [{ title: article.title, angle: '演示文章', targetWords: article.words.map((w) => w.word) }],
      articleCount: 1,
    },
    snapshotId: snapshot.id,
    articles: [article],
    questions: { [articleId]: questions },
    demo: true,
    qaNotes: ['演示素材：词汇覆盖与解析均经过人工校对，可直接体验阅读与答题流程。'],
  };
}
