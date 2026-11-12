import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { idb } from '../lib/db';
import { relativeTime } from '../lib/format';
import type { Article, GenerationTask, QuizAttempt } from '../types';

export default function Library() {
  const { library, refreshLibrary, refreshTasks, notify, accountId } = useApp();
  const [query, setQuery] = useState('');
  const [exam, setExam] = useState<'all' | Article['exam']>('all');
  const [onlyFav, setOnlyFav] = useState(false);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);

  useEffect(() => {
    void refreshLibrary();
    void idb.all<QuizAttempt>('attempts').then(setAttempts);
  }, [refreshLibrary]);

  const bestScore = useMemo(() => {
    const map = new Map<string, number>();
    attempts.forEach((a) => {
      const ratio = a.total ? a.score / a.total : 0;
      map.set(a.articleId, Math.max(map.get(a.articleId) ?? 0, ratio));
    });
    return map;
  }, [attempts]);

  const filtered = useMemo(
    () =>
      library
        .filter((a) => (exam === 'all' ? true : a.exam === exam))
        .filter((a) => (onlyFav ? a.favorite : true))
        .filter((a) => (query ? (a.title + (a.subtitle ?? '')).toLowerCase().includes(query.toLowerCase()) : true)),
    [library, exam, onlyFav, query],
  );

  const remove = async (article: Article) => {
    if (
      !window.confirm(
        `删除《${article.title}》？\n\n相关题目、作答记录，以及生成任务里保存的文章副本都会一起删除。`,
      )
    ) {
      return;
    }

    /* ① 文章本体 */
    await idb.del('articles', article.id);

    /* ② 题目 */
    const qs = await idb.all<{ id: string; articleId: string }>('questions');
    for (const q of qs.filter((x) => x.articleId === article.id)) await idb.del('questions', q.id);

    /* ③ 作答记录 */
    const as = await idb.all<QuizAttempt>('attempts');
    for (const a of as.filter((x) => x.articleId === article.id)) await idb.del('attempts', a.id);

    /* ④ 生成任务里嵌入的文章副本与题目 —— 否则「导出全部数据」还会把已删文章带出去 */
    const tasks = await idb.all<GenerationTask>('tasks');
    for (const t of tasks) {
      const hadArticle = (t.articles ?? []).some((x) => x.id === article.id);
      const hadQuestions = Boolean(t.questions?.[article.id]);
      if (!hadArticle && !hadQuestions) continue;

      const next: GenerationTask = {
        ...t,
        articles: (t.articles ?? []).filter((x) => x.id !== article.id),
        questions: { ...(t.questions ?? {}) },
      };
      delete next.questions[article.id];

      if (next.articles.length === 0) {
        // 这个任务的所有产物都删完了，整个任务也没有保留价值
        await idb.del('tasks', t.id);
      } else {
        next.updatedAt = Date.now();
        await idb.put('tasks', t.id, next);
      }
    }

    await refreshLibrary();
    await refreshTasks();
    setAttempts(await idb.all<QuizAttempt>('attempts'));
    notify('已删除（含任务记录里的副本）', 'warn');
  };

  const taskOf = async (article: Article) => {
    const task = await idb.get<{ qaNotes?: string[] }>('tasks', article.taskId);
    return task?.qaNotes ?? [];
  };

  return (
    <div className="page page--library">
      <header className="lib__head">
        <p className="eyebrow">书架 · {accountId === 'local' ? '本机' : accountId}</p>
        <h1 className="display display--sm">读过的，都留在这里</h1>
        <div className="lib__filters">
          <input
            className="input input--search"
            placeholder="搜索标题"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="select" value={exam} onChange={(e) => setExam(e.target.value as typeof exam)}>
            <option value="all">全部考试</option>
            <option value="cet4">CET-4</option>
            <option value="cet6">CET-6</option>
            <option value="kaoyan1">考研英语一</option>
            <option value="kaoyan2">考研英语二</option>
          </select>
          <label className="toggle toggle--inline">
            <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} />
            <span>只看收藏</span>
          </label>
        </div>
      </header>

      {filtered.length === 0 ? (
        <section className="empty">
          <h2 className="h2">书架还是空的</h2>
          <p className="lede">生成第一篇精读后，它会出现在这里，并支持离线打开。</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('generate')}>
            去生成
          </button>
        </section>
      ) : (
        <ul className="lib__list">
          {filtered.map((a) => {
            const score = bestScore.get(a.id);
            return (
              <li key={a.id} className="lib__item">
                <button type="button" className="lib__main" onClick={() => navigate(`read/${a.id}`)}>
                  <div className="lib__row">
                    <span className="tag tag--exam">{a.exam.toUpperCase()}</span>
                    {a.favorite ? <span className="tag tag--fav">收藏</span> : null}
                    {score !== undefined ? <span className="tag tag--score">最佳 {Math.round(score * 100)}%</span> : null}
                  </div>
                  <h3 className="lib__title">{a.title}</h3>
                  {a.subtitle ? <p className="lib__sub">{a.subtitle}</p> : null}
                  <p className="meta">
                    {a.wordCount} 词 · {a.readMinutes} 分钟 · {relativeTime(a.createdAt)} · {a.words.length} 个目标词
                  </p>
                </button>
                <div className="lib__ops">
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    onClick={async () => {
                      const notes = await taskOf(a);
                      notify(notes[0] ?? '这篇没有质量检查备注', 'ok');
                    }}
                  >
                    质检
                  </button>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => navigate(`quiz/${a.id}`)}>
                    做题
                  </button>
                  <button type="button" className="btn btn--quiet btn--sm btn--danger" onClick={() => remove(a)}>
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
