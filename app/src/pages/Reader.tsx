import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { idb } from '../lib/db';
import { buildFormIndex, tokenize } from '../lib/text';
import { apiConfigError, apiTargetOf, chat, extractJson } from '../api/deepseek';
import { glossPrompt } from '../ai/prompts';
import { explainAny } from '../lib/errors';
import { cny } from '../lib/format';
import type { Article, Question, SelectionPlan, WordGloss } from '../types';

interface ActiveWord {
  word: string;
  sentence: string;
  meaning?: string;
  note?: string;
  source: 'article' | 'gloss' | 'none';
}

interface TaskMeta {
  plan?: SelectionPlan;
  totalArticles: number;
  articleIndex: number;
  taskId: string;
}

function useScrollProgress() {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - doc.clientHeight;
      setValue(total > 0 ? Math.min(100, Math.max(0, (doc.scrollTop / total) * 100)) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return value;
}

export default function Reader({ articleId }: { articleId: string }) {
  const { settings, notify, library, refreshLibrary } = useApp();
  const [article, setArticle] = useState<Article | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [plan, setPlan] = useState<SelectionPlan | null>(null);
  const [taskMeta, setTaskMeta] = useState<TaskMeta | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [focus, setFocus] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [active, setActive] = useState<ActiveWord | null>(null);
  const [glossBusy, setGlossBusy] = useState(false);
  const progress = useScrollProgress();
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const a = await idb.get<Article>('articles', articleId);
      if (!a || cancelled) {
        if (!cancelled) setArticle(null);
        return;
      }
      setArticle(a);
      const qs = (await idb.all<Question>('questions')).filter((q) => q.articleId === articleId).sort((x, y) => x.index - y.index);
      setQuestions(qs);
      const task = await idb.get<import('../types').GenerationTask>('tasks', a.taskId);
      setPlan(task?.plan ?? null);
      if (task) {
        setTaskMeta({
          plan: task.plan,
          totalArticles: task.plan?.articleCount ?? task.totalArticles ?? 1,
          articleIndex: task.articleIndex ?? 0,
          taskId: task.id,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  const formIndex = useMemo(() => {
    if (!article) return new Map<string, string>();
    return buildFormIndex(article.words.map((w) => w.word));
  }, [article]);

  const wordMap = useMemo(() => {
    const map = new Map<string, Article['words'][number]>();
    article?.words.forEach((w) => map.set(w.word, w));
    return map;
  }, [article]);

  const coverageStats = useMemo(() => {
    if (!article) return { used: 0, total: 0 };
    const used = article.words.filter((w) =>
      article.paragraphs.some((p) => tokenize(p).some((t) => t.type === 'word' && t.key && formIndex.get(t.key) === w.word)),
    ).length;
    return { used, total: article.words.length };
  }, [article, formIndex]);

  const openWord = useCallback(
    async (surface: string, sentence: string) => {
      if (!article) return;
      const key = surface.toLowerCase().replace(/[^a-z-]/g, '');
      const target = wordMap.get(formIndex.get(key) ?? '') ?? wordMap.get(key);
      if (target) {
        setActive({ word: target.word, sentence, meaning: target.meaning, note: target.note, source: 'article' });
        return;
      }
      const cached = await idb.get<WordGloss>('glossary', `${settings.exam}:${key}`);
      if (cached) {
        setActive({ word: key, sentence, meaning: cached.meaning, note: cached.collocation ?? cached.context, source: 'gloss' });
        return;
      }
      setActive({ word: key, sentence, source: 'none' });
    },
    [article, formIndex, settings.exam, wordMap],
  );

  const askAi = useCallback(async () => {
    if (!active || !article) return;
    const api = apiTargetOf(settings);
    const problem = apiConfigError(api);
    if (problem) {
      notify(`${problem}，请到设置里补充`, 'warn');
      return;
    }
    setGlossBusy(true);
    try {
      const { system, user } = glossPrompt(active.word, active.sentence, article.exam);
      const res = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          apiKey: api.apiKey,
          provider: api.provider,
          baseUrl: api.baseUrl,
          model: api.model,
          json: true,
          maxTokens: 400,
          temperature: 0.5,
        },
      );
      const parsed = extractJson<{ meaning?: string; context?: string; collocation?: string }>(res.content);
      const gloss: WordGloss = {
        key: `${article.exam}:${active.word}`,
        word: active.word,
        meaning: parsed.meaning ?? '',
        context: parsed.context ?? '',
        collocation: parsed.collocation,
        createdAt: Date.now(),
      };
      await idb.put('glossary', gloss.key, gloss);
      setActive({ ...active, meaning: gloss.meaning, note: gloss.collocation ?? gloss.context, source: 'gloss' });
      notify(api.provider === 'custom' ? '释义已生成' : `释义已生成（约 ${cny(0.0006)}）`, 'ok');
    } catch (err) {
      notify(explainAny(err).title, 'error');
    } finally {
      setGlossBusy(false);
    }
  }, [active, article, notify, settings]);

  const toggleFavorite = useCallback(async () => {
    if (!article) return;
    const next = { ...article, favorite: !article.favorite };
    setArticle(next);
    await idb.put('articles', next.id, next);
    await refreshLibrary();
  }, [article, refreshLibrary]);

  const exportArticle = useCallback(() => {
    if (!article) return;
    const lines = [
      `# ${article.title}`,
      article.subtitle ? `_${article.subtitle}_` : '',
      '',
      ...article.paragraphs.flatMap((p, i) => (article.translation[i] ? [p, '', `> ${article.translation[i]}`, ''] : [p, ''])),
      '---',
      '## 词汇',
      ...article.words.map((w) => `- **${w.word}**（${w.surface}）：${w.meaning}`),
    ];
    const blob = new Blob([lines.filter((l) => l !== undefined).join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${article.title.replace(/[^\w\u4e00-\u9fa5]+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [article]);

  if (!article) {
    return (
      <div className="page page--narrow">
        <h1 className="h1">找不到这篇文章</h1>
        <p className="lede">可能是在另一台设备上生成的，或者被清除了本地数据。</p>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('library')}>
          回书架
        </button>
      </div>
    );
  }

  return (
    <div className={`reader ${focus ? 'reader--focus' : ''}`}>
      <div className="reader__progress" style={{ width: `${progress}%` }} />
      <div className="reader__toolbar">
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => navigate('library')}>
          ← 书架
        </button>
        <div className="reader__tools">
          <button type="button" className={`tool ${showTranslation ? 'is-on' : ''}`} onClick={() => setShowTranslation((v) => !v)}>
            译文
          </button>
          <button type="button" className={`tool ${coverage ? 'is-on' : ''}`} onClick={() => setCoverage((v) => !v)}>
            词汇 {coverageStats.used}/{coverageStats.total}
          </button>
          <button type="button" className={`tool ${focus ? 'is-on' : ''}`} onClick={() => setFocus((v) => !v)}>
            {focus ? '退出专注' : '专注'}
          </button>
          <button type="button" className={`tool ${article.favorite ? 'is-on' : ''}`} onClick={toggleFavorite}>
            {article.favorite ? '已收藏' : '收藏'}
          </button>
          <button type="button" className="tool" onClick={exportArticle}>
            导出
          </button>
        </div>
      </div>

      {coverage ? (
        <aside className="coverage">
          <div className="coverage__head">
            <h3>词汇覆盖</h3>
            <button type="button" className="link" onClick={() => setCoverage(false)}>
              收起
            </button>
          </div>
          <p className="meta">
            正文实际用到 {coverageStats.used} / {coverageStats.total} 个目标词
            {plan ? `；AI 从 ${plan.picks.length + plan.dropped.length} 个候选词里选出了 ${plan.picks.length} 个` : ''}。
          </p>
          <ul className="coverage__list">
            {article.words.map((w) => (
              <li key={w.word}>
                <strong>{w.word}</strong>
                <span className="coverage__surface">{w.surface}</span>
                <span>{w.meaning}</span>
              </li>
            ))}
          </ul>
          {plan ? (
            <>
              <h4 className="coverage__sub">AI 选词依据</h4>
              <p className="meta">{plan.summary}</p>
              {plan.dropped.length ? (
                <p className="meta">
                  放弃：{plan.dropped.map((d) => `${d.word}（${d.reason}）`).join('、')}
                </p>
              ) : null}
            </>
          ) : null}
        </aside>
      ) : null}

      <article className="reader__paper">
        <header className="reader__head">
          <p className="eyebrow">
            {article.exam.toUpperCase()} · {article.wordCount} 词 · {article.readMinutes} 分钟
          </p>
          <h1 className="reader__title">{article.title}</h1>
          {article.subtitle ? <p className="reader__sub">{article.subtitle}</p> : null}
        </header>

        <div className="reader__body">
          {article.paragraphs.map((p, pi) => (
            <div className="para-block" key={pi}>
              <p className={pi === 0 ? 'para para--lead' : 'para'}>
                {tokenize(p).map((t, ti) => {
                  if (t.type !== 'word') return <span key={ti}>{t.text}</span>;
                  const targetKey = t.key ? formIndex.get(t.key) : undefined;
                  if (!targetKey) {
                    return (
                      <button type="button" key={ti} className="w" onClick={() => openWord(t.text, p)}>
                        {t.text}
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      key={ti}
                      className={`w w--target ${active?.word === targetKey ? 'is-active' : ''}`}
                      onClick={() => openWord(t.text, p)}
                    >
                      {t.text}
                    </button>
                  );
                })}
              </p>
              {showTranslation && article.translation[pi] ? <p className="translation">{article.translation[pi]}</p> : null}
            </div>
          ))}
        </div>

        <div className="reader__words">
          <h2 className="h2">本篇词汇</h2>
          <div className="reader__chips">
            {article.words.map((w) => (
              <button
                type="button"
                key={w.word}
                className="chip chip--target"
                onClick={() => openWord(w.surface, w.inContext || article.paragraphs[0])}
              >
                {w.word}
                <small>{w.meaning}</small>
              </button>
            ))}
          </div>
        </div>

        <footer className="reader__foot">
          <button type="button" className="btn btn--primary btn--block" onClick={() => navigate(`quiz/${article.id}`)}>
            开始阅读理解
            <span className="btn__hint">{questions.length} 道题 · {questions.length ? '交卷后看解析' : '题目还在路上'}</span>
          </button>
          {taskMeta && taskMeta.totalArticles > taskMeta.articleIndex + 1 ? (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`generate?task=${taskMeta.taskId}&next=1`)}
            >
              继续生成规划中的第 {taskMeta.articleIndex + 2} 篇
              <span className="btn__hint">AI 判断今天的词适合拆成 {taskMeta.totalArticles} 篇，按需生成，避免浪费</span>
            </button>
          ) : null}
          <p className="meta">原文依据会在解析里高亮，点词可看语境释义。</p>
        </footer>
      </article>

      {active ? (
        <div className="sheet-wrap" onClick={() => setActive(null)}>
          <div className="sheet" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head">
              <h3>{active.word}</h3>
              <button type="button" className="sheet__close" onClick={() => setActive(null)}>
                ✕
              </button>
            </div>
            {active.meaning ? (
              <p className="sheet__meaning">{active.meaning}</p>
            ) : (
              <p className="sheet__meaning sheet__meaning--empty">这词不在本篇词表里。</p>
            )}
            {active.note ? <p className="meta">{active.note}</p> : null}
            <p className="sheet__ctx">“{active.sentence.slice(0, 220)}{active.sentence.length > 220 ? '…' : ''}”</p>
            {!active.meaning || active.source === 'none' ? (
              <button type="button" className="btn btn--ghost btn--block" onClick={askAi} disabled={glossBusy}>
                {glossBusy ? '正在解释…' : '让 AI 解释这个词在这句里的意思'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
