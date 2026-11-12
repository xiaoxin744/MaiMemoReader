import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { idb } from '../lib/db';
import { letter, relativeTime } from '../lib/format';
import { locateEvidence } from '../lib/text';
import type { Article, Question, QuizAttempt, UsageTotal } from '../types';

/** 「重新练习、不计入历史」的会话标记，Quiz 会读取后跳过落库 */
export const PRACTICE_FLAG_KEY = 'memo-reader.practice';

/** 练习模式的一次性结果：不写 attempts，只放这里供结果页展示 */
export const PRACTICE_RESULT_KEY = 'memo-reader.practice.result';

function Evidence({ article, question }: { article: Article; question: Question }) {
  const hit = useMemo(() => locateEvidence(article.paragraphs, question.evidence), [article, question]);
  if (!hit) {
    return <p className="evidence evidence--missing">原文依据：{question.evidence || '（模型没有给出可定位的句子）'}</p>;
  }

  // locateEvidence 已经返回了字符区间，之前只用它定位段落、却把整段原样渲染，
  // 导致「原文依据」和「引用」看起来是两段不相干的文字。这里真正做区间高亮。
  const paragraph = article.paragraphs[hit.paragraphIndex] ?? '';
  const before = paragraph.slice(0, hit.start);
  const focus = paragraph.slice(hit.start, hit.end);
  const after = paragraph.slice(hit.end);

  return (
    <div className="evidence">
      <div className="evidence__label">原文依据 · 第 {hit.paragraphIndex + 1} 段</div>
      <p className="evidence__text">
        {before}
        <mark className="evidence__hit">{focus}</mark>
        {after}
      </p>
      {question.evidence && question.evidence.trim() !== focus.trim() ? (
        <p className="evidence__quote">模型引用：“{question.evidence}”</p>
      ) : null}
    </div>
  );
}

export default function Result({ articleId }: { articleId: string }) {
  const { notify } = useApp();
  const [article, setArticle] = useState<Article | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [usage, setUsage] = useState<UsageTotal | null>(null);
  const [practiceMode, setPracticeMode] = useState(false);

  useEffect(() => {
    void (async () => {
      const a = await idb.get<Article>('articles', articleId);
      setArticle(a ?? null);
      const qs = (await idb.all<Question>('questions'))
        .filter((q) => q.articleId === articleId)
        .sort((x, y) => x.index - y.index);
      setQuestions(qs);
      // 练习模式的结果只存在于本次会话，优先展示
      let practiceResult: QuizAttempt | null = null;
      try {
        const raw = sessionStorage.getItem(PRACTICE_RESULT_KEY);
        if (raw) {
          sessionStorage.removeItem(PRACTICE_RESULT_KEY);
          practiceResult = JSON.parse(raw) as QuizAttempt;
        }
      } catch {
        /* ignore */
      }

      if (practiceResult && practiceResult.articleId === articleId) {
        setAttempt(practiceResult);
        setPracticeMode(true);
      } else {
        const attempts = (await idb.all<QuizAttempt>('attempts'))
          .filter((x) => x.articleId === articleId)
          .sort((x, y) => y.createdAt - x.createdAt);
        setAttempt(attempts[0] ?? null);
        setPracticeMode(false);
      }

      // 这篇对应的生成任务，用于展示真实花费
      const task = a ? await idb.get<{ usage?: UsageTotal }>('tasks', a.taskId) : null;
      setUsage(task?.usage ?? null);
    })();
  }, [articleId]);

  if (!article || !attempt) {
    return (
      <div className="page page--narrow">
        <h1 className="h1">还没交卷</h1>
        <p className="lede">先去完成这一篇的题目，交卷后会显示分数、解析和原文依据。</p>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(`quiz/${articleId}`)}>
          去做题
        </button>
      </div>
    );
  }

  const score = attempt.score;
  const total = attempt.total;
  const ratio = total ? score / total : 0;
  const band = ratio >= 0.8 ? '很稳' : ratio >= 0.6 ? '及格线以上' : '需要再看一遍';

  const retry = async () => {
    // 之前只弹了提示却没告诉答题页，Quiz 仍然会写入新的 attempt，两边说法不一致。
    // 用 sessionStorage 传递「本次是练习、不计入历史」的标记。
    try {
      sessionStorage.setItem(PRACTICE_FLAG_KEY, articleId);
    } catch {
      /* ignore */
    }
    notify('重新开始练习，这一次不计入历史成绩', 'ok');
    navigate(`quiz/${articleId}`);
  };

  const practiceAgain = () => {
    void retry();
  };

  return (
    <div className="result">
      <header className="result__head">
        <p className="eyebrow">
          {article.exam.toUpperCase()} · 交卷于 {relativeTime(attempt.createdAt)}
          {practiceMode ? ' · 练习模式（未计入历史）' : ''}
        </p>
        <h1 className="result__score">
          {score}
          <span>/ {total}</span>
        </h1>
        <p className="result__band">{band}</p>
        {usage ? (
          <p className="meta result__usage">
            本次生成：{usage.calls} 次调用 · {(usage.promptTokens + usage.completionTokens).toLocaleString()} tokens ·
            {usage.costKnown === false ? ' 费用由服务商结算' : ` 约 ¥${usage.costCny.toFixed(4)}`}
            {usage.searchCalls > 0 ? ` · 联网检索 ${usage.searchCalls} 次` : ''}
          </p>
        ) : null}
        <div className="result__bar">
          <div className="result__bar-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div className="result__actions">
          <button type="button" className="btn btn--ghost" onClick={retry}>
            重新练习
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => navigate(`read/${article.id}`)}>
            回文章
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => navigate('generate')}>
            再生成一篇
          </button>
        </div>
      </header>

      <ol className="review">
        {questions.map((q, i) => {
          const picked = attempt.answers[i];
          const correct = picked === q.answerIndex;
          return (
            <li className={`rcard ${correct ? 'is-correct' : 'is-wrong'}`} key={q.id}>
              <div className="rcard__head">
                <span className="rcard__no">{String(i + 1).padStart(2, '0')}</span>
                <span className={`rcard__flag ${correct ? 'ok' : 'bad'}`}>{correct ? '正确' : '错误'}</span>
                <span className="meta">
                  你选 {picked === null ? '—' : letter(picked)} · 答案 {letter(q.answerIndex)}
                </span>
              </div>
              <p className="rcard__stem">{q.stem}</p>
              <div className="rcard__options">
                {q.options.map((opt, oi) => {
                  const isAnswer = oi === q.answerIndex;
                  const isPicked = oi === picked;
                  return (
                    <div
                      key={oi}
                      className={`ropt ${isAnswer ? 'is-answer' : ''} ${isPicked && !isAnswer ? 'is-picked-wrong' : ''}`}
                    >
                      <span className="ropt__key">{letter(oi)}</span>
                      <span>{opt}</span>
                    </div>
                  );
                })}
              </div>
              <p className="rcard__explain">{q.explanation}</p>
              <Evidence article={article} question={q} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
