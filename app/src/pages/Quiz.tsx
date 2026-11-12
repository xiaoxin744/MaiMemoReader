import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { idb } from '../lib/db';
import { letter } from '../lib/format';
import type { Article, Question, QuizAttempt } from '../types';
import { PRACTICE_FLAG_KEY, PRACTICE_RESULT_KEY } from './Result';

export default function Quiz({ articleId }: { articleId: string }) {
  const { notify } = useApp();
  const [article, setArticle] = useState<Article | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showPassage, setShowPassage] = useState(false);

  useEffect(() => {
    void (async () => {
      const a = await idb.get<Article>('articles', articleId);
      setArticle(a ?? null);
      const qs = (await idb.all<Question>('questions'))
        .filter((q) => q.articleId === articleId)
        .sort((x, y) => x.index - y.index);
      setQuestions(qs);
      setAnswers(Array.from({ length: qs.length }, () => null));
    })();
  }, [articleId]);

  const answered = useMemo(() => answers.filter((a) => a !== null).length, [answers]);

  const submit = async () => {
    if (!article || questions.length === 0) return;
    if (answered < questions.length) {
      notify(`还有 ${questions.length - answered} 道题没选`, 'warn');
      return;
    }
    setSubmitting(true);
    const score = questions.reduce((sum, q, i) => sum + (answers[i] === q.answerIndex ? 1 : 0), 0);

    // 结果页点「重新练习」时会写这个标记，表示本次不计入历史
    let practice = false;
    try {
      practice = sessionStorage.getItem(PRACTICE_FLAG_KEY) === article.id;
      if (practice) sessionStorage.removeItem(PRACTICE_FLAG_KEY);
    } catch {
      /* ignore */
    }

    const attempt: QuizAttempt = {
      id: `attempt-${Date.now()}`,
      articleId: article.id,
      answers,
      score,
      total: questions.length,
      createdAt: Date.now(),
    };

    if (practice) {
      // 练习模式：不写 attempts，只把结果放进 sessionStorage 供结果页一次性展示
      try {
        sessionStorage.setItem(PRACTICE_RESULT_KEY, JSON.stringify(attempt));
      } catch {
        /* ignore */
      }
    } else {
      await idb.put('attempts', attempt.id, attempt);
    }

    setSubmitting(false);
    navigate(`result/${article.id}`);
  };

  if (!article) {
    return (
      <div className="page page--narrow">
        <h1 className="h1">题目还没准备好</h1>
        <p className="lede">可能正文已生成但命题中断，回到生成页点「继续命题」即可，不必重新生成文章。</p>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('')}>
          回到今日
        </button>
      </div>
    );
  }

  return (
    <div className="quiz">
      <header className="quiz__head">
        <p className="eyebrow">{article.exam.toUpperCase()} · 阅读理解</p>
        <h1 className="quiz__title">{article.title}</h1>
        <div className="quiz__meta">
          <span>{questions.length} 道题 · 四选一</span>
          <button type="button" className="link" onClick={() => setShowPassage((v) => !v)}>
            {showPassage ? '收起原文' : '展开原文'}
          </button>
        </div>
      </header>

      {showPassage ? (
        <div className="quiz__passage">
          {article.paragraphs.map((p, i) => (
            <p key={i} className="para">
              <span className="para__num">{i + 1}</span>
              {p}
            </p>
          ))}
        </div>
      ) : null}

      <ol className="quiz__list">
        {questions.map((q, qi) => (
          <li className="qcard" key={q.id}>
            <div className="qcard__head">
              <span className="qcard__no">{String(qi + 1).padStart(2, '0')}</span>
              <span className="qcard__type">{q.type === 'main' ? '主旨' : q.type === 'inference' ? '推断' : q.type === 'vocab' ? '词义' : q.type === 'attitude' ? '态度' : q.type === 'structure' ? '结构' : '细节'}</span>
            </div>
            <p className="qcard__stem">{q.stem}</p>
            <div className="qcard__options">
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  type="button"
                  className={`opt ${answers[qi] === oi ? 'is-picked' : ''}`}
                  onClick={() =>
                    setAnswers((prev) => {
                      const next = [...prev];
                      next[qi] = oi;
                      return next;
                    })
                  }
                >
                  <span className="opt__key">{letter(oi)}</span>
                  <span className="opt__text">{opt}</span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <div className="quiz__bar">
        <div className="quiz__bar-meta">
          已答 {answered} / {questions.length}
          <span className="meta">· 交卷前不显示答案</span>
        </div>
        <button type="button" className="btn btn--primary" onClick={submit} disabled={submitting}>
          交卷
        </button>
      </div>
    </div>
  );
}
