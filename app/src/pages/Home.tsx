import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { fetchTodaySnapshot } from '../api/maimemo';
import { DEMO_SNAPSHOT } from '../ai/demo';
import { explainAny } from '../lib/errors';
import { greeting, percent, relativeTime, todayLabel } from '../lib/format';
import { todayKey } from '../api/maimemo';
import type { StudySnapshot, StudyWord } from '../types';

function Ring({ value }: { value: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 80 80" role="img" aria-label={`今日进度 ${value}%`}>
      <circle className="ring__track" cx="40" cy="40" r={r} />
      <circle
        className="ring__value"
        cx="40"
        cy="40"
        r={r}
        strokeDasharray={`${(c * value) / 100} ${c}`}
        strokeLinecap="round"
      />
      <text className="ring__label" x="40" y="45" textAnchor="middle">
        {value}%
      </text>
    </svg>
  );
}

const GROUPS: { key: string; label: string; match: (w: StudyWord) => boolean; tone: string }[] = [
  { key: 'forget', label: '忘记', match: (w) => w.response === 'FORGET', tone: 'forget' },
  { key: 'vague', label: '模糊', match: (w) => w.response === 'VAGUE', tone: 'vague' },
  { key: 'new', label: '新学', match: (w) => w.isNew && w.response !== 'FORGET' && w.response !== 'VAGUE', tone: 'new' },
  { key: 'known', label: '认识 / 熟知', match: (w) => w.response === 'FAMILIAR' || w.response === 'WELL_FAMILIAR', tone: 'known' },
  { key: 'left', label: '今日未学', match: (w) => !w.isFinished && !w.response, tone: 'left' },
];

export default function Home() {
  const { settings, snapshot, saveSnapshot, connector, accountId, notify, library, tasks, refreshTasks } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingTask = useMemo(() => tasks.find((t) => t.status === 'running' || t.status === 'interrupted' || t.status === 'failed'), [tasks]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const loadRemote = useCallback(async () => {
    if (!connector) {
      notify('先在设置里配置墨墨凭证，或先用演示数据', 'warn');
      navigate('settings');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await fetchTodaySnapshot(connector, settings.relayUrl);
      const withAccount: StudySnapshot = { ...next, accountId, id: todayKey(accountId) };
      await saveSnapshot(withAccount);
      notify(`已同步 ${withAccount.words.length} 个今日单词`, 'ok');
    } catch (err) {
      const explained = explainAny(err);
      setError(`${explained.title}｜${explained.action}`);
      notify(explained.title, 'error');
    } finally {
      setBusy(false);
    }
  }, [accountId, connector, notify, saveSnapshot, settings.relayUrl]);

  const useDemo = useCallback(async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const demo: StudySnapshot = {
      ...DEMO_SNAPSHOT,
      accountId,
      date,
      fetchedAt: Date.now(),
    };
    await saveSnapshot(demo);
    notify('已载入演示数据，可直接体验精读流程', 'ok');
  }, [accountId, notify, saveSnapshot]);

  const progress = snapshot?.progress ? percent(snapshot.progress.finished, snapshot.progress.total) : 0;
  const grouped = useMemo(() => {
    const words = snapshot?.words ?? [];
    return GROUPS.map((g) => ({ ...g, words: words.filter(g.match) })).filter((g) => g.words.length > 0);
  }, [snapshot]);

  return (
    <div className="page page--home">
      <section className="home__head">
        <div>
          <p className="eyebrow">{todayLabel()}</p>
          <h1 className="display">
            {greeting()}，<br />
            今天读点什么？
          </h1>
        </div>
        <div className="home__ring">
          {snapshot?.progress ? (
            <>
              <Ring value={progress} />
              <div className="home__ring-meta">
                <strong>{snapshot.progress.finished}</strong>
                <span>/ {snapshot.progress.total} 词</span>
              </div>
            </>
          ) : (
            <div className="home__ring-empty">
              <span>尚无</span>
              <small>今日数据</small>
            </div>
          )}
        </div>
      </section>

      {pendingTask ? (
        <button type="button" className="banner" onClick={() => navigate(`generate?task=${pendingTask.id}`)}>
          <span className="banner__dot" />
          <span className="banner__text">
            <strong>有一篇没写完的精读</strong>
            <small>
              {pendingTask.plan?.articles?.[pendingTask.articleIndex]?.title ?? '生成中断'} ·{' '}
              {relativeTime(pendingTask.updatedAt)} · 进度 {pendingTask.progress}%
            </small>
          </span>
          <span className="banner__cta">继续</span>
        </button>
      ) : null}

      <section className="home__source">
        <div className="source__line">
          <span className={`dot ${snapshot ? 'dot--ok' : 'dot--idle'}`} />
          <span>
            {snapshot
              ? `${snapshot.source === 'demo' ? '演示数据' : '墨墨同步'} · ${snapshot.words.length} 词 · ${relativeTime(snapshot.fetchedAt)}`
              : connector
                ? '已配置墨墨凭证，尚未拉取今日数据'
                : '还没有连接墨墨账号'}
          </span>
          <button type="button" className="link" onClick={loadRemote} disabled={busy}>
            {busy ? '同步中…' : '同步今日'}
          </button>
          {!connector ? (
            <button type="button" className="link link--muted" onClick={useDemo}>
              用演示数据
            </button>
          ) : null}
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        {snapshot?.note ? <p className="inline-note">{snapshot.note}</p> : null}
      </section>

      <section className="home__cta">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => navigate('generate')}
          disabled={!snapshot || snapshot.words.length === 0}
        >
          生成今日精读
          <span className="btn__hint">{snapshot ? `${snapshot.words.length} 词待筛选` : '先同步学习数据'}</span>
        </button>
      </section>

      {grouped.length ? (
        <section className="vocab">
          <div className="section__head">
            <h2 className="h2">今天的词，按记忆状态分组</h2>
            <span className="meta">点击生成后由 AI 决定取舍</span>
          </div>
          {grouped.map((g) => (
            <div className="vocab__row" key={g.key}>
              <div className="vocab__label">
                <span className={`tag tag--${g.tone}`}>{g.label}</span>
                <span className="meta">{g.words.length}</span>
              </div>
              <div className="vocab__chips">
                {g.words.map((w) => (
                  <span key={w.spelling} className={`chip chip--${g.tone}`}>
                    {w.spelling}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="empty">
          <h2 className="h2">今天的学习数据还没到</h2>
          <p className="lede">
            打开墨墨背单词学几个词，或者先用演示数据看看产品长什么样。数据只会存在这台设备上。
          </p>
          <div className="empty__actions">
            <button type="button" className="btn btn--ghost" onClick={useDemo}>
              载入演示数据
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => navigate('settings')}>
              配置墨墨账号
            </button>
          </div>
        </section>
      )}

      {library.length ? (
        <section className="recent">
          <div className="section__head">
            <h2 className="h2">最近读过的</h2>
            <button type="button" className="link" onClick={() => navigate('library')}>
              全部 {library.length} 篇
            </button>
          </div>
          <ul className="recent__list">
            {library.slice(0, 3).map((a) => (
              <li key={a.id}>
                <button type="button" className="recent__item" onClick={() => navigate(`read/${a.id}`)}>
                  <span className="recent__title">{a.title}</span>
                  <span className="meta">
                    {a.wordCount} 词 · {a.readMinutes} 分钟 · {a.exam.toUpperCase()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="home__foot">
        <span className="meta">数据只在本机 · 生成由你选择的 AI 接口完成</span>
        <span className="meta">v1.0</span>
      </footer>
    </div>
  );
}
