import { describe, expect, it } from 'vitest';
import {
  checkTranslationAlignment,
  checkWordCoverage,
  MIN_WORDS_BY_LENGTH,
  validateArticle,
  validateQuestions,
  validateSelection,
  validateQa,
} from '../src/ai/validate';
import { AppError } from '../src/lib/errors';

const words = ['sustain', 'undermine', 'subtle', 'reclaim'];

describe('validateSelection', () => {
  it('缺 articles 时用核心词退化生成一篇，并把未分配的词补进去', () => {
    const plan = validateSelection(
      {
        summary: '围绕注意力组织',
        picks: [
          { word: 'Sustain', role: 'core', reason: '高频' },
          { word: 'subtle', role: 'support', reason: '修饰' },
        ],
      },
      words,
    );
    expect(plan.articles).toHaveLength(1);
    // 兜底文章先放核心词，再把没分配的 support 词补进同一篇，避免词被浪费
    expect(plan.articles[0].targetWords).toEqual(['sustain', 'subtle']);
    expect(plan.articleCount).toBe(1);
  });

  it('picks 为空时抛出可解释的解析错误', () => {
    expect(() => validateSelection({}, words)).toThrow(AppError);
  });

  it('限制文章数不超过 3 篇', () => {
    const plan = validateSelection(
      {
        picks: [
          { word: 'sustain', role: 'core', reason: 'x' },
          { word: 'subtle', role: 'core', reason: 'x' },
          { word: 'reclaim', role: 'core', reason: 'x' },
          { word: 'undermine', role: 'core', reason: 'x' },
        ],
        articles: [
          { title: 'a', angle: 'a', targetWords: ['sustain'] },
          { title: 'b', angle: 'b', targetWords: ['subtle'] },
          { title: 'c', angle: 'c', targetWords: ['reclaim'] },
          { title: 'd', angle: 'd', targetWords: ['undermine'] },
        ],
        articleCount: 4,
      },
      words,
    );
    expect(plan.articles).toHaveLength(3);
    expect(plan.articleCount).toBe(3);
  });

  /* ===== 以下为 2026-10-28 审查后新增的边界测试 ===== */

  it('检测出今日词表之外的词，并写入 summary 警告', () => {
    const plan = validateSelection(
      {
        summary: '测试',
        picks: [
          { word: 'sustain', role: 'core', reason: 'x' },
          { word: 'notaword', role: 'core', reason: 'AI 编的词' },
        ],
        articles: [{ title: 'a', angle: 'a', targetWords: ['sustain', 'notaword'] }],
      },
      words,
    );
    // 越界词不应被静默接受：要出现在 dropped 里，且 summary 有提示
    expect(plan.dropped.some((d) => d.word === 'notaword')).toBe(true);
    expect(plan.summary).toMatch(/不在今日词表内/);
  });

  it('越界词过半时给出更强的匹配度警告', () => {
    const plan = validateSelection(
      {
        summary: '测试',
        picks: [
          { word: 'aaa', role: 'core', reason: 'x' },
          { word: 'bbb', role: 'core', reason: 'x' },
        ],
        articles: [{ title: 'a', angle: 'a', targetWords: ['aaa', 'bbb'] }],
      },
      words,
    );
    expect(plan.summary).toMatch(/匹配度较低/);
  });

  it('picks 内部去重，重复项记入 dropped', () => {
    const plan = validateSelection(
      {
        summary: '测试',
        picks: [
          { word: 'sustain', role: 'core', reason: 'x' },
          { word: 'Sustain', role: 'support', reason: '重复' },
        ],
        articles: [{ title: 'a', angle: 'a', targetWords: ['sustain'] }],
      },
      words,
    );
    expect(plan.picks).toHaveLength(1);
    expect(plan.dropped.some((d) => /重复/.test(d.reason))).toBe(true);
  });

  it('articleCount 以实际篇数为准，与 AI 声明不一致时给警告', () => {
    const plan = validateSelection(
      {
        picks: [{ word: 'sustain', role: 'core', reason: 'x' }],
        articles: [{ title: 'a', angle: 'a', targetWords: ['sustain'] }],
        articleCount: 3, // 声明 3 篇，实际只给了 1 篇
      },
      words,
    );
    expect(plan.articleCount).toBe(1);
    expect(plan.articles).toHaveLength(1);
    expect(plan.summary).toMatch(/实际规划 1 篇/);
  });

  it('targetWords 不得跨篇重复分配', () => {
    const plan = validateSelection(
      {
        picks: [
          { word: 'sustain', role: 'core', reason: 'x' },
          { word: 'subtle', role: 'core', reason: 'x' },
        ],
        articles: [
          { title: 'a', angle: 'a', targetWords: ['sustain', 'subtle'] },
          { title: 'b', angle: 'b', targetWords: ['sustain', 'subtle'] }, // 全部重复
        ],
      },
      words,
    );
    const all = plan.articles.flatMap((a) => a.targetWords);
    expect(new Set(all).size).toBe(all.length);
  });

  it('targetWords 里出现未选中的词会被丢弃', () => {
    const plan = validateSelection(
      {
        picks: [{ word: 'sustain', role: 'core', reason: 'x' }],
        articles: [{ title: 'a', angle: 'a', targetWords: ['sustain', 'reclaim'] }],
      },
      words,
    );
    expect(plan.articles[0].targetWords).toEqual(['sustain']);
  });
});

describe('validateArticle', () => {
  it('段落少于 3 段视为无效', () => {
    expect(() => validateArticle({ paragraphs: ['one', 'two'] })).toThrow(AppError);
  });

  it('提取正文、译文与词表', () => {
    const draft = validateArticle({
      title: 'Test',
      paragraphs: ['A '.repeat(30), 'B '.repeat(30), 'C '.repeat(30)],
      translation: ['甲', '乙', '丙'],
      words: [{ word: 'Sustain', surface: 'sustaining', meaning: '维持', inContext: 'x' }],
    });
    expect(draft.title).toBe('Test');
    expect(draft.words[0].word).toBe('sustain');
    expect(draft.words[0].surface).toBe('sustaining');
  });

  /* ===== 新增：确定性篇幅下限 ===== */

  it('篇幅低于档位下限时抛错（不依赖 AI 自评）', () => {
    const short = {
      paragraphs: ['A '.repeat(30), 'B '.repeat(30), 'C '.repeat(30)], // 约 90 词
      translation: ['甲', '乙', '丙'],
      words: [],
    };
    expect(() => validateArticle(short, MIN_WORDS_BY_LENGTH.medium)).toThrow(/篇幅不足/);
    // 不传 minWords 时保持向后兼容，不校验篇幅
    expect(() => validateArticle(short)).not.toThrow();
  });

  it('篇长档位下限递增', () => {
    expect(MIN_WORDS_BY_LENGTH.short).toBeLessThan(MIN_WORDS_BY_LENGTH.medium);
    expect(MIN_WORDS_BY_LENGTH.medium).toBeLessThan(MIN_WORDS_BY_LENGTH.long);
  });
});

describe('checkWordCoverage', () => {
  it('识别正文里真正出现的词（含词形变化）', () => {
    const draft = {
      title: 't',
      paragraphs: ['We must sustain the effort, and subtle changes matter.', 'Second para.', 'Third para.'],
      translation: ['a', 'b', 'c'],
      words: [],
    };
    const { covered, missing } = checkWordCoverage(draft, ['sustain', 'subtle', 'reclaim']);
    expect(covered).toEqual(['sustain', 'subtle']);
    expect(missing).toEqual(['reclaim']);
  });
});

describe('checkTranslationAlignment', () => {
  it('译文缺失时报出问题', () => {
    const issues = checkTranslationAlignment({ title: 't', paragraphs: ['a', 'b', 'c'], translation: [], words: [] });
    expect(issues).toContain('译文缺失');
  });

  it('译文段数与正文不一致时报出问题', () => {
    const issues = checkTranslationAlignment({
      title: 't',
      paragraphs: ['a', 'b', 'c'],
      translation: ['甲', '乙'],
      words: [],
    });
    expect(issues.join()).toMatch(/译文段数/);
  });

  it('段数一致时无问题', () => {
    const issues = checkTranslationAlignment({
      title: 't',
      paragraphs: ['a', 'b', 'c'],
      translation: ['甲', '乙', '丙'],
      words: [],
    });
    expect(issues).toHaveLength(0);
  });
});

describe('validateQuestions', () => {
  it('丢弃选项数不为 4 或答案越界的题', () => {
    const { questions, issues } = validateQuestions(
      {
        questions: [
          { stem: 'ok', options: ['a', 'b', 'c', 'd'], answerIndex: 2, evidence: 'x', explanation: 'y' },
          { stem: 'bad', options: ['a', 'b', 'c'], answerIndex: 0 },
          { stem: 'bad2', options: ['a', 'b', 'c', 'd'], answerIndex: 9 },
        ],
      },
      'a1',
    );
    expect(questions).toHaveLength(1);
    expect(questions[0].answerIndex).toBe(2);
    expect(questions[0].id).toBe('a1-q1');
    // 被丢弃的题要留下说明，不能静默消失
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it('全部不合格时抛错', () => {
    expect(() => validateQuestions({ questions: [] }, 'a1')).toThrow(AppError);
  });

  /* ===== 新增：题目数量与重复题干 ===== */

  it('题目数量与设定不一致时记入 issues', () => {
    const { questions, issues } = validateQuestions(
      {
        questions: [{ stem: 'q', options: ['a', 'b', 'c', 'd'], answerIndex: 0, evidence: 'e', explanation: 'x' }],
      },
      'a1',
      5,
    );
    expect(questions).toHaveLength(1);
    expect(issues.join()).toMatch(/题目数量/);
  });

  it('题干重复时记入 issues', () => {
    const { issues } = validateQuestions(
      {
        questions: [
          { stem: 'Same stem', options: ['a', 'b', 'c', 'd'], answerIndex: 0, evidence: 'e', explanation: 'x' },
          { stem: 'Same stem', options: ['a', 'b', 'c', 'd'], answerIndex: 1, evidence: 'e', explanation: 'y' },
        ],
      },
      'a1',
    );
    expect(issues.join()).toMatch(/题干重复/);
  });
});

describe('validateQa', () => {
  it('归一化质检报告字段', () => {
    const report = validateQa({
      pass: false,
      notes: ['译文有漏'],
      coverageIssues: ['Subtle'],
      questionIssues: [{ index: 1, problem: '依据不匹配' }],
    });
    expect(report.notes).toHaveLength(1);
    expect(report.coverageIssues[0]).toBe('subtle');
    expect(report.questionIssues[0].index).toBe(1);
    // pass 必须如实反映，不能被上层忽略成"通过"
    expect(report.pass).toBe(false);
  });
});
