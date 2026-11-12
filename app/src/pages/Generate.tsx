import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { DEMO_SNAPSHOT } from '../ai/demo';
import { buildDemoTask, previewFromPartial, runPipeline, type PipelineProgress } from '../ai/pipeline';
import { apiConfigError, apiTargetOf } from '../api/deepseek';
import { EXAM_PROFILES } from '../ai/prompts';
import { explainAny } from '../lib/errors';
import { cny } from '../lib/format';
import { idb } from '../lib/db';
import type { Article, ExamMode, GenerateOptions, GenerationTask } from '../types';

const STAGE_ORDER: { key: PipelineProgress['stage']; label: string; copy: string }[] = [
  { key: 'snapshot', label: '读取学习数据', copy: '正在把今天的单词从墨墨背单词里请出来' },
  { key: 'selection', label: 'AI 智能选词', copy: '正在邀请几个不太合群的单词参加这篇文章' },
  { key: 'article', label: '构思与正文', copy: 'AI 正在努力让这些单词看起来不是第一次见面' },
  { key: 'questions', label: '阅读理解命题', copy: '正在检查干扰项有没有比正确答案更像正确答案' },
  { key: 'qa', label: '质量检查', copy: '正在逐句核对答案有没有原文撑腰' },
  { key: 'save', label: '存入书架', copy: '正在把文章压平、装订、放进书架' },
];

const WAIT_LINES = [
  '可以去喝口水，不过最好先别把我彻底关掉，文章还在路上。',
  '切到别的 App 问题不大，但 iOS 可能让我暂时停工——回来点一下继续就行。',
  '这一段要写得像真题，而不是像 AI 在交作业，所以会慢一点。',
  '如果进度停住超过一分钟，那不是卡住，是模型在长句里换气。',
  '顺手把手机放远一点，等下读的时候正好用得上这份专注。',
];

const EXAM_ORDER: ExamMode[] = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2'];

export default function Generate() {
  const { settings, setSettings, snapshot, saveSnapshot, accountId, library, notify, refreshLibrary, refreshTasks } =
    useApp();
  const [options, setOptions] = useState<GenerateOptions>({
    exam: settings.exam,
    theme: settings.theme,
    length: settings.length,
    difficulty: settings.difficulty,
    questionCount: settings.questionCount,
    articleMode: settings.articleMode,
    continueSession: settings.continueSession,
    webSearch: settings.webSearch,
    model: settings.model,
    thinking: settings.thinking,
    apiProvider: settings.apiProvider,
  });
  const [task, setTask] = useState<GenerationTask | null>(null);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const resumedRef = useRef(false);

  const todayArticles = useMemo(
    () => library.filter((a) => a.accountId === accountId && a.date === snapshot?.date),
    [library, accountId, snapshot?.date],
  );

  useEffect(() => {
    if (!running) return;
    const copyTimer = window.setInterval(() => setLineIndex((i) => (i + 1) % STAGE_ORDER.length), 12_000);
    const tipTimer = window.setInterval(() => setTipIndex((i) => (i + 1) % WAIT_LINES.length), 9_000);
    return () => {
      window.clearInterval(copyTimer);
      window.clearInterval(tipTimer);
    };
  }, [running]);

  const persistOptions = useCallback(
    (patch: Partial<GenerateOptions>) => {
      setOptions((prev) => ({ ...prev, ...patch }));
      setSettings({
        exam: patch.exam ?? settings.exam,
        theme: patch.theme ?? settings.theme,
        length: patch.length ?? settings.length,
        difficulty: patch.difficulty ?? settings.difficulty,
        questionCount: patch.questionCount ?? settings.questionCount,
        articleMode: patch.articleMode ?? settings.articleMode,
        continueSession: patch.continueSession ?? settings.continueSession,
        webSearch: patch.webSearch ?? settings.webSearch,
        model: patch.model ?? settings.model,
        thinking: patch.thinking ?? settings.thinking,
      });
    },
    [setSettings, settings],
  );

  const previousArticles: Article[] = options.continueSession ? todayArticles : [];

  /** 恢复旧任务前，先确认任务创建时的接口与当前设置一致，避免把模型名发到另一家服务。 */
  const resumeProblem = useCallback(
    (target: GenerationTask): string | null => {
      const wanted = target.options.apiProvider ?? 'deepseek';
      if (wanted !== settings.apiProvider) {
        return `该任务使用${wanted === 'custom' ? '自定义接口' : 'DeepSeek 官方接口'}，请先在设置里切回对应接口再恢复`;
      }
      return apiConfigError(apiTargetOf(settings));
    },
    [settings],
  );

  const launch = useCallback(
    async (target: GenerationTask, demo: boolean) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      setTask(target);
      setPartial('');
      const api = apiTargetOf(settings, target.options.model);
      try {
        const result = await runPipeline(
          {
            task: target,
            snapshot: snapshot ?? { ...DEMO_SNAPSHOT, accountId },
            target: api,
            signal: controller.signal,
            previousArticles,
            demo,
          },
          {
            onProgress: setProgress,
            onDelta: (chunk) => setPartial((prev) => (prev + chunk).slice(-6000)),
            onTask: (t) => {
              setTask({ ...t });
            },
            onNotice: (text) => notify(text, 'warn'),
          },
        );
        await refreshLibrary();
        await refreshTasks();
        const article = result.articles[result.articleIndex];
        notify('文章写好了，开始读吧', 'ok');
        if (article) navigate(`read/${article.id}`);
      } catch (err) {
        const explained = explainAny(err);
        setError(`${explained.title}｜${explained.detail}｜${explained.action}`);
        notify(explained.title, 'error');
        await refreshTasks();
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [accountId, notify, previousArticles, refreshLibrary, refreshTasks, settings, snapshot],
  );

  const start = useCallback(async () => {
    if (!snapshot || snapshot.words.length === 0) {
      notify('先同步今天的墨墨学习数据', 'warn');
      navigate('');
      return;
    }
    const problem = apiConfigError(apiTargetOf(settings));
    if (problem) {
      notify(problem, 'warn');
      navigate('settings');
      return;
    }
    const api = apiTargetOf(settings);
    const sessionId = options.continueSession && todayArticles[0] ? todayArticles[0].sessionId : crypto.randomUUID();
    const now = Date.now();
    const taskOptions: GenerateOptions = {
      ...options,
      model: api.model,
      apiProvider: api.provider,
      // 联网检索是 DeepSeek 专有工具，自定义接口下强制关闭
      webSearch: api.provider === 'deepseek' ? options.webSearch : false,
      thinking: api.provider === 'deepseek' ? options.thinking : false,
    };
    const draft: GenerationTask = {
      id: `task-${now}`,
      accountId,
      date: snapshot.date,
      exam: options.exam,
      createdAt: now,
      updatedAt: now,
      status: 'running',
      stage: 'snapshot',
      progress: 0,
      articleIndex: 0,
      totalArticles: 1,
      sessionId,
      options: taskOptions,
      snapshotId: snapshot.id,
      articles: [],
      questions: {},
    };
    await idb.put('tasks', draft.id, draft);
    await launch(draft, false);
  }, [accountId, launch, notify, options, settings, snapshot, todayArticles]);

  const startDemo = useCallback(async () => {
    const base = snapshot ?? { ...DEMO_SNAPSHOT, accountId };
    if (!snapshot) await saveSnapshot({ ...DEMO_SNAPSHOT, accountId });
    const demoTask = buildDemoTask(base, options.exam, crypto.randomUUID());
    demoTask.options = options;
    demoTask.accountId = accountId;
    await launch(demoTask, true);
  }, [accountId, launch, options, saveSnapshot, snapshot]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    notify('已停止本次生成，已完成的阶段已保存', 'warn');
  }, [notify]);

  // 从 URL 恢复任务 / 继续生成规划中的下一篇
  useEffect(() => {
    if (resumedRef.current) return;
    const hash = window.location.hash;
    const query = hash.includes('?') ? new URLSearchParams(hash.split('?')[1]) : null;
    const taskId = query?.get('task');
    if (!taskId) return;
    resumedRef.current = true;
    void (async () => {
      const stored = await idb.get<GenerationTask>('tasks', taskId);
      if (!stored) return;
      setOptions({ ...stored.options });
      const wantsNext = query?.get('next') === '1';
      if (wantsNext && stored.status === 'complete' && stored.articleIndex + 1 < stored.totalArticles) {
        const advanced: GenerationTask = {
          ...stored,
          articleIndex: stored.articleIndex + 1,
          status: 'running',
          stage: 'article',
          progress: 0,
          qaNotes: undefined,
          error: undefined,
        };
        setTask(advanced);
        setProgress({ stage: 'article', progress: 0, detail: '正在写规划里的下一篇' });
        if (!resumeProblem(stored) || stored.demo) {
          await launch(advanced, Boolean(stored.demo));
        }
        return;
      }
      setTask(stored);
      setProgress({
        stage: stored.stage === 'done' ? 'save' : stored.stage,
        progress: stored.progress,
        detail: '已读取上次中断的进度',
      });
    })();
  }, [launch, resumeProblem, settings]);

  const resume = useCallback(async () => {
    if (!task) return;
    if (!task.demo) {
      const problem = resumeProblem(task);
      if (problem) {
        notify(problem, 'warn');
        navigate('settings');
        return;
      }
    }
    await launch({ ...task, status: 'running', error: undefined }, Boolean(task.demo));
  }, [launch, notify, resumeProblem, task]);

  const stageIndex = progress ? STAGE_ORDER.findIndex((s) => s.key === progress.stage) : -1;
  const barValue = progress?.progress ?? task?.progress ?? 0;
  const preview = useMemo(() => (partial ? previewFromPartial(partial) : ''), [partial]);
  const profile = EXAM_PROFILES[options.exam];

  if (running || (task && (task.status === 'running' || task.status === 'interrupted' || task.status === 'failed'))) {
    return (
      <div className="page page--generate">
        <div className="stage">
          <div className="stage__head">
            <p className="eyebrow">{running ? '正在生成' : task?.status === 'failed' ? '生成中断' : '已暂停'}</p>
            <h1 className="h1 stage__title">{profile.name} · {options.length === 'short' ? '短文' : options.length === 'long' ? '长文' : '标准篇幅'}</h1>
          </div>

          <div className="progress progress--hero">
            <div className="progress__bar" style={{ width: `${barValue}%` }} />
            <span className="progress__value">{Math.round(barValue)}%</span>
          </div>

          <ol className="stage__list">
            {STAGE_ORDER.map((s, i) => {
              const done = stageIndex > i || task?.status === 'complete';
              const active = stageIndex === i && running;
              return (
                <li key={s.key} className={`stage__item ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
                  <span className="stage__dot">{done ? '✓' : active ? '●' : i + 1}</span>
                  <div>
                    <div className="stage__label">{s.label}</div>
                    {active ? <div className="stage__copy">{progress?.detail ?? s.copy}</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>

          {running ? (
            <p className="stage__whisper">{WAIT_LINES[tipIndex]}</p>
          ) : null}

          {preview ? (
            <div className="stage__preview" aria-live="polite">
              <div className="stage__preview-head">实时预览 · 未完成</div>
              <p>{preview}</p>
            </div>
          ) : (
            running ? <p className="stage__idle">{STAGE_ORDER[Math.max(stageIndex, 0)]?.copy ?? '准备中'}</p> : null
          )}

          {error ? <div className="alert alert--error">{error}</div> : null}
          {!running && task?.error ? <div className="alert alert--warn">{task.error}</div> : null}

          <div className="stage__actions">
            {running ? (
              <button type="button" className="btn btn--ghost" onClick={abort}>
                停止生成
              </button>
            ) : (
              <>
                <button type="button" className="btn btn--primary" onClick={resume}>
                  {task?.stage === 'questions' ? '继续命题' : task?.stage === 'qa' ? '继续质量检查' : task?.articles?.length ? '继续命题' : '继续生成'}
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => { setTask(null); setProgress(null); setPartial(''); }}>
                  重新设置
                </button>
              </>
            )}
          </div>

          <p className="meta stage__footnote">
            生成时请尽量保持页面在前台——切到其他 App 后 iOS 可能暂停网络请求。
            回来点「继续」会从<b>已完成的阶段</b>接着走，这些阶段不会重复请求、不会重复计费；
            但若中断时某个阶段正写到一半，该阶段需要重新发送，<b>可能会再次产生这部分费用</b>。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--generate">
      <header className="gen__head">
        <p className="eyebrow">今日 · {snapshot?.words.length ?? 0} 词</p>
        <h1 className="display display--sm">把这堆单词，<br />变成一篇值得读的文章</h1>
        <p className="lede">
          AI 会先看哪些词忘了、哪些只是眼熟，再决定写什么、放弃什么。不是把 200 个词塞进一段话。
        </p>
      </header>

      <section className="gen__block">
        <div className="section__head">
          <h2 className="h2">考试模式</h2>
          <span className="meta">{profile.lengthHint}</span>
        </div>
        <div className="exam-grid">
          {EXAM_ORDER.map((id) => {
            const p = EXAM_PROFILES[id];
            return (
              <button
                key={id}
                type="button"
                className={`exam-card ${options.exam === id ? 'is-active' : ''}`}
                onClick={() => persistOptions({ exam: id })}
              >
                <span className="exam-card__short">{p.short}</span>
                <span className="exam-card__name">{p.name.replace(/（.*）/, '')}</span>
                <span className="exam-card__meta">{p.words[0]}–{p.words[1]} 词</span>
              </button>
            );
          })}
        </div>
        <p className="hint">{profile.syntax}</p>
      </section>

      <section className="gen__block">
        <div className="section__head">
          <h2 className="h2">主题与篇幅</h2>
        </div>
        <label className="field">
          <span className="field__label">想要的题材（可留空，让 AI 从单词里自己找）</span>
          <input
            className="input"
            placeholder="例如：城市与孤独、AI 与就业、气候政策"
            value={options.theme}
            onChange={(e) => persistOptions({ theme: e.target.value })}
          />
        </label>
        <div className="segmented">
          {(['short', 'medium', 'long'] as const).map((len) => (
            <button
              key={len}
              type="button"
              className={`segmented__item ${options.length === len ? 'is-active' : ''}`}
              onClick={() => persistOptions({ length: len })}
            >
              {len === 'short' ? '短文' : len === 'long' ? '长文' : '标准'}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">
            难度 <strong>{options.difficulty}/5</strong>
          </span>
          <input
            className="range"
            type="range"
            min={1}
            max={5}
            step={1}
            value={options.difficulty}
            onChange={(e) => persistOptions({ difficulty: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })}
          />
        </label>
        <div className="row">
          <label className="field field--inline">
            <span className="field__label">题目数量</span>
            <input
              className="input input--num"
              type="number"
              min={3}
              max={6}
              value={options.questionCount}
              onChange={(e) => persistOptions({ questionCount: Math.max(3, Math.min(6, Number(e.target.value) || 4)) })}
            />
          </label>
          <label className="field field--inline">
            <span className="field__label">组篇方式</span>
            <select
              className="select"
              value={options.articleMode}
              onChange={(e) => persistOptions({ articleMode: e.target.value as GenerateOptions['articleMode'] })}
            >
              <option value="single">单篇（默认）</option>
              <option value="auto">自动组篇（AI 判断）</option>
            </select>
          </label>
        </div>
      </section>

      <section className="gen__block">
        <div className="section__head">
          <h2 className="h2">AI 与成本</h2>
          <button type="button" className="link" onClick={() => navigate('settings')}>
            设置
          </button>
        </div>
        <div className="row">
          {settings.apiProvider === 'deepseek' ? (
            <label className="field field--inline">
              <span className="field__label">模型</span>
              <select
                className="select"
                value={options.model}
                onChange={(e) => persistOptions({ model: e.target.value })}
              >
                <option value="deepseek-flash">deepseek-flash</option>
                <option value="deepseek-v4-pro">deepseek-v4-pro</option>
              </select>
            </label>
          ) : (
            <label className="field field--inline">
              <span className="field__label">模型（在设置中修改）</span>
              <input
                className="input input--mono"
                value={settings.customApiModel || '未填写'}
                readOnly
              />
            </label>
          )}
          {settings.apiProvider === 'deepseek' ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={options.webSearch}
                onChange={(e) => persistOptions({ webSearch: e.target.checked })}
              />
              <span>联网找真题风格参考（默认关）</span>
            </label>
          ) : null}
        </div>
        {settings.apiProvider === 'deepseek' ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={options.thinking}
              onChange={(e) => persistOptions({ thinking: e.target.checked })}
            />
            <span>深度思考模式（更慢，成本更高）</span>
          </label>
        ) : null}
        <label className="toggle">
          <input
            type="checkbox"
            checked={options.continueSession}
            onChange={(e) => persistOptions({ continueSession: e.target.checked })}
          />
          <span>
            接续今天的生成会话（避免重复主题与用词）
            {todayArticles.length ? ` · 今天已有 ${todayArticles.length} 篇` : ' · 今天还没有文章'}
          </span>
        </label>
        <p className="hint">
          {settings.apiProvider === 'deepseek' ? (
            <>
              预计一次完整生成：4 次 AI 调用（选词 / 正文 / 命题 / 质检）。用 deepseek-flash 通常不到 {cny(0.05)}，
              用 v4-pro 约 {cny(0.2)} 上下。实际以返回的 usage 为准，生成结束后会显示明细。
            </>
          ) : (
            <>
              当前使用自定义接口（{settings.customApiBase || '未填写地址'}），费用由你的服务商结算，应用无法估算；
              深度思考与联网检索是 DeepSeek 专有能力，此模式下不会发送。
            </>
          )}
        </p>
      </section>

      <div className="gen__actions">
        <button type="button" className="btn btn--primary btn--block" onClick={start}>
          开始生成
          <span className="btn__hint">{profile.name} · {profile.words[0]}–{profile.words[1]} 词</span>
        </button>
        <button type="button" className="btn btn--quiet btn--block" onClick={startDemo}>
          先用演示素材看效果（不消耗 API）
        </button>
      </div>
    </div>
  );
}
