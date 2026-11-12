/** 结构化输出校验：把模型 JSON 收敛成前端可依赖的数据，坏数据在这里被拦下。 */
import { AppError } from '../lib/errors';
import type { Article, ArticleWord, Question, QuestionType, SelectionPlan, WordPick } from '../types';

const QUESTION_TYPES: QuestionType[] = ['detail', 'main', 'inference', 'vocab', 'attitude', 'structure'];

/** 单篇文章的目标词数上限，防止 AI 把全部词塞进一篇 */
const MAX_WORDS_PER_ARTICLE = 40;

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function clampIndex(v: unknown, max: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n) || n < 0 || n >= max) return -1;
  return n;
}

/**
 * 校验选词与组篇规划。
 *
 * 修正记录（2026-10-28）：
 *  此前 `outside` 的过滤条件写成 `!known.has(p.word)`，而 `known` 正是由全部 picks
 *  构建的，该条件对每个选中词恒为 false，导致越界选词检测完全失效（死代码）。
 *  现在改为直接与当日词表 `allowSet` 比对。
 *
 *  同时补上三项此前缺失的一致性检查：
 *    ① picks 内部去重（保留首次出现，重复项记入 dropped）
 *    ② 每篇的 targetWords 必须来自 picks，且不得跨篇重复分配
 *    ③ articleCount 以实际规划出的篇数为准，不再直接采信 AI 的声明值
 *
 * 设计原则：越界词只记警告、不改回固定选词算法——AI 依然自主决定选词。
 */
export function validateSelection(raw: unknown, allowedWords: string[]): SelectionPlan {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const allowSet = new Set(allowedWords.map((w) => w.toLowerCase()));

  /* ---------- 1. picks：解析 + 去重 ---------- */
  const seen = new Set<string>();
  const picks: WordPick[] = [];
  const dropped: { word: string; reason: string }[] = [];

  for (const item of asArray<Record<string, unknown>>(obj.picks)) {
    const word = asString(item.word).toLowerCase();
    if (!word) continue;
    if (seen.has(word)) {
      dropped.push({ word, reason: '重复选词，已去重' });
      continue;
    }
    seen.add(word);
    picks.push({
      word,
      role: item.role === 'support' ? 'support' : 'core',
      reason: asString(item.reason),
    });
  }
  if (!picks.length) throw new AppError('parse', '选词结果为空，模型没有按要求返回 picks');

  /* ---------- 2. 越界检测（修正后的实现） ---------- */
  const outsidePicks = allowSet.size > 0 ? picks.filter((p) => !allowSet.has(p.word)) : [];
  const outsideRatio = picks.length ? outsidePicks.length / picks.length : 0;

  /* ---------- 3. articles：解析 + 目标词归属校验 ---------- */
  const assigned = new Set<string>();
  const rawArticles = asArray<Record<string, unknown>>(obj.articles)
    .map((a) => {
      const targetWords: string[] = [];
      for (const w of asArray<string>(a.targetWords)) {
        const word = asString(w).toLowerCase();
        if (!word) continue;
        // 必须来自 picks，且不能跨篇重复
        if (!seen.has(word)) continue;
        if (assigned.has(word)) continue;
        assigned.add(word);
        targetWords.push(word);
        if (targetWords.length >= MAX_WORDS_PER_ARTICLE) break;
      }
      return {
        title: asString(a.title),
        angle: asString(a.angle),
        targetWords,
      };
    })
    .filter((a) => a.targetWords.length > 0);

  /* ---------- 4. 兜底：一篇都没有时把核心词整体作为一篇 ---------- */
  let articles = rawArticles;
  if (!articles.length) {
    const coreWords = picks
      .filter((p) => p.role === 'core')
      .map((p) => p.word)
      .slice(0, MAX_WORDS_PER_ARTICLE);
    if (coreWords.length) {
      // 兜底文章同样要登记分配关系，否则下一步会把同一个词再补一遍
      coreWords.forEach((w) => assigned.add(w));
      articles = [
        {
          title: asString(obj.title, 'Today’s Reading'),
          angle: asString(obj.summary, '根据今日单词组织的一篇精读'),
          targetWords: coreWords,
        },
      ];
    }
  }

  /* ---------- 5. 未被任何文章分配的词，补进最后一篇 ---------- */
  const leftover = picks.map((p) => p.word).filter((w) => !assigned.has(w));
  if (leftover.length && articles.length) {
    const last = articles[articles.length - 1];
    for (const w of leftover) {
      if (last.targetWords.length >= MAX_WORDS_PER_ARTICLE) break;
      last.targetWords.push(w);
      assigned.add(w);
    }
  }

  /* ---------- 6. articleCount 以实际篇数为准 ---------- */
  const sliced = articles.slice(0, 3);
  const articleCount = sliced.length;

  /* ---------- 7. 组装 + 警告 ---------- */
  let summary = asString(obj.summary, '按记忆状态与语义关联组织的今日精读');
  const warnings: string[] = [];

  if (outsidePicks.length) {
    const list = outsidePicks.slice(0, 8).map((p) => p.word).join('、');
    warnings.push(`有 ${outsidePicks.length} 个词不在今日词表内（${list}）`);
    for (const p of outsidePicks) {
      dropped.push({ word: p.word, reason: '不在今日词表内' });
    }
  }
  if (outsideRatio >= 0.5) {
    warnings.push('模型给出的词与当日词表匹配度较低');
  }
  const declared = Number(obj.articleCount);
  if (Number.isFinite(declared) && declared > 0 && declared !== articleCount) {
    warnings.push(`模型声明 ${declared} 篇，实际规划 ${articleCount} 篇`);
  }

  if (warnings.length) summary += `（注意：${warnings.join('；')}）`;

  return {
    summary,
    picks,
    dropped,
    articles: sliced,
    articleCount,
  };
}

export interface ArticleDraft {
  title: string;
  subtitle?: string;
  paragraphs: string[];
  translation: string[];
  words: ArticleWord[];
}

/** 各长度档位的正文词数下限，用于确定性校验（不依赖 AI 自评） */
export const MIN_WORDS_BY_LENGTH: Record<'short' | 'medium' | 'long', number> = {
  short: 220,
  medium: 380,
  long: 620,
};

export function validateArticle(raw: unknown, minWords = 0): ArticleDraft {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const paragraphs = asArray<string>(obj.paragraphs)
    .map((p) => asString(p))
    .filter(Boolean);
  if (paragraphs.length < 3) throw new AppError('parse', `正文段落不足（得到 ${paragraphs.length} 段）`);

  const translation = asArray<string>(obj.translation).map((t) => asString(t));
  const words = asArray<Record<string, unknown>>(obj.words)
    .map((w) => ({
      word: asString(w.word).toLowerCase(),
      surface: asString(w.surface) || asString(w.word),
      meaning: asString(w.meaning),
      inContext: asString(w.inContext),
      note: asString(w.note) || undefined,
    }))
    .filter((w) => w.word && w.meaning);

  // 确定性篇幅检查：词数不足直接判定这份草稿不可用，交由上层决定重试或标注
  if (minWords > 0) {
    const body = paragraphs.join(' ');
    const count = body.split(/\s+/).filter((t) => /[A-Za-z]/.test(t)).length;
    if (count < minWords) {
      throw new AppError(
        'parse',
        `正文篇幅不足（${count} 词，本档要求至少 ${minWords} 词）`,
      );
    }
  }

  return {
    title: asString(obj.title, 'Untitled Reading'),
    subtitle: asString(obj.subtitle) || undefined,
    paragraphs,
    translation,
    words,
  };
}

/** 译文段数与正文段数是否对应（允许缺省，但不应多于正文） */
export function checkTranslationAlignment(draft: ArticleDraft): string[] {
  const issues: string[] = [];
  if (!draft.translation.length) {
    issues.push('译文缺失');
  } else if (draft.translation.length !== draft.paragraphs.length) {
    issues.push(`译文段数（${draft.translation.length}）与正文段数（${draft.paragraphs.length}）不一致`);
  }
  return issues;
}

/** 目标词是否真的出现在正文里（大小写不敏感，允许变形） */
export function checkWordCoverage(
  draft: ArticleDraft,
  targetWords: string[],
): { covered: string[]; missing: string[] } {
  const body = draft.paragraphs.join(' ').toLowerCase();
  const declared = new Set(draft.words.map((w) => w.word.toLowerCase()));

  const covered: string[] = [];
  const missing: string[] = [];

  for (const raw of targetWords) {
    const word = raw.toLowerCase();
    // 词本身出现，或模型声称用了该词的变形
    const stem = word.replace(/(ing|ed|es|s|ly)$/, '');
    const hit =
      body.includes(word) ||
      (stem.length >= 4 && body.includes(stem)) ||
      declared.has(word);
    if (hit) covered.push(word);
    else missing.push(word);
  }
  return { covered, missing };
}

export function validateQuestions(
  raw: unknown,
  articleId: string,
  expectedCount = 0,
): { questions: Question[]; issues: string[] } {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const list = asArray<Record<string, unknown>>(obj.questions);
  if (!list.length) throw new AppError('parse', '命题结果为空');

  const issues: string[] = [];
  const questions: Question[] = [];

  list.forEach((q, i) => {
    const options = asArray<string>(q.options).map((o) => asString(o));
    const answerIndex = clampIndex(q.answerIndex, options.length);
    if (options.length !== 4 || answerIndex < 0) {
      issues.push(`第 ${i + 1} 题选项或答案不合法，已丢弃`);
      return;
    }
    const type = QUESTION_TYPES.includes(q.type as QuestionType) ? (q.type as QuestionType) : 'detail';
    const stem = asString(q.stem);
    if (!stem) {
      issues.push(`第 ${i + 1} 题题干为空，已丢弃`);
      return;
    }
    questions.push({
      id: `${articleId}-q${i + 1}`,
      articleId,
      index: questions.length,
      type,
      stem,
      options,
      answerIndex,
      evidence: asString(q.evidence),
      explanation: asString(q.explanation),
    });
  });

  if (!questions.length) throw new AppError('parse', '没有一道题满足四选一 + 合法答案的要求');

  if (expectedCount > 0 && questions.length !== expectedCount) {
    issues.push(`题目数量 ${questions.length} 与设定 ${expectedCount} 不一致`);
  }

  // 题干重复检测
  const stems = new Set<string>();
  questions.forEach((q) => {
    const key = q.stem.toLowerCase();
    if (stems.has(key)) issues.push(`题干重复：${q.stem.slice(0, 24)}`);
    stems.add(key);
  });

  return {
    questions: questions.map((q, i) => ({ ...q, index: i, id: `${articleId}-q${i + 1}` })),
    issues,
  };
}

export interface QaReport {
  pass: boolean;
  notes: string[];
  coverageIssues: string[];
  questionIssues: { index: number; problem: string }[];
}

export function validateQa(raw: unknown): QaReport {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    pass: Boolean(obj.pass),
    notes: asArray<string>(obj.notes).map((n) => asString(n)).filter(Boolean).slice(0, 6),
    coverageIssues: asArray<string>(obj.coverageIssues).map((n) => asString(n).toLowerCase()).filter(Boolean),
    questionIssues: asArray<Record<string, unknown>>(obj.questionIssues)
      .map((q) => ({ index: Number(q.index) || 0, problem: asString(q.problem) }))
      .filter((q) => q.problem),
  };
}

export interface RepairResult {
  fixes: { index: number; evidence: string; explanation: string }[];
}

export function validateRepairs(raw: unknown): RepairResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    fixes: asArray<Record<string, unknown>>(obj.fixes)
      .map((f) => ({
        index: Number(f.index) || 0,
        evidence: asString(f.evidence),
        explanation: asString(f.explanation),
      }))
      .filter((f) => f.index >= 0),
  };
}

export function buildArticle(
  draft: ArticleDraft,
  meta: Omit<Article, 'title' | 'subtitle' | 'paragraphs' | 'translation' | 'words' | 'wordCount' | 'readMinutes'>,
  wordCount: number,
  readMinutes: number,
): Article {
  return {
    ...meta,
    title: draft.title,
    subtitle: draft.subtitle,
    paragraphs: draft.paragraphs,
    translation: draft.translation,
    words: draft.words,
    wordCount,
    readMinutes,
  };
}
