import { useEffect, useState } from 'react';
import { navigate, useRoute, type Route } from './lib/router';
import { useApp } from './state/store';
import { exchangeCode, readCallback } from './api/oidc';
import { explainAny } from './lib/errors';
import Home from './pages/Home';
import Generate from './pages/Generate';
import Reader from './pages/Reader';
import Quiz from './pages/Quiz';
import Result from './pages/Result';
import Library from './pages/Library';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';

const NAV: { key: Route['name']; href: string; label: string; glyph: string }[] = [
  { key: 'home', href: '', label: '今日', glyph: '◍' },
  { key: 'generate', href: 'generate', label: '精读', glyph: '✎' },
  { key: 'library', href: 'library', label: '书架', glyph: '❏' },
  { key: 'settings', href: 'settings', label: '设置', glyph: '⚙' },
];

function NavRail({ active }: { active: Route['name'] }) {
  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="brand__mark">M</span>
        <div>
          <div className="brand__name">MaiMemo Reader</div>
          <div className="brand__sub">墨墨 · AI 精读</div>
        </div>
      </div>
      <nav className="rail__nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rail__link ${active === item.key ? 'is-active' : ''}`}
            onClick={() => navigate(item.href)}
          >
            <span className="rail__glyph">{item.glyph}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="rail__foot">
        <div className="rail__note">本地优先 · 无中央服务器</div>
        <div className="rail__ver">v1.0 · PWA</div>
      </div>
    </aside>
  );
}

function TopBar({ title }: { title: string }) {
  return (
    <header className="topbar">
      <button type="button" className="topbar__brand" onClick={() => navigate('')}>
        <span className="brand__mark brand__mark--sm">M</span>
        <div>
          <div className="brand__name brand__name--sm">MaiMemo Reader</div>
          <div className="brand__sub">{title}</div>
        </div>
      </button>
      <button type="button" className="topbar__icon" onClick={() => navigate('settings')} aria-label="设置">
        ⚙
      </button>
    </header>
  );
}

function BottomNav({ active }: { active: Route['name'] }) {
  return (
    <nav className="bottom-nav">
      {NAV.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`bottom-nav__item ${active === item.key ? 'is-active' : ''}`}
          onClick={() => navigate(item.href)}
        >
          <span className="bottom-nav__glyph">{item.glyph}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast--${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

function Boot() {
  return (
    <div className="boot">
      <div className="boot__mark">M</div>
      <p>正在打开你的精读本…</p>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const { ready, settings, applyOidcTokens, notify } = useApp();
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // 主题：跟随系统 / 手动，同时尊重「减少动态效果」
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const dark = settings.themeMode === 'dark' || (settings.themeMode === 'auto' && prefersDark);
      root.dataset.theme = dark ? 'dark' : 'light';
      root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.themeMode, settings.reduceMotion]);

  // 墨墨 OIDC 回调：URL 上带 code/state 时先换令牌，再清理地址栏
  useEffect(() => {
    const cb = readCallback(window.location.search);
    if (!cb.code && !cb.error) return;
    const run = async () => {
      setAuthBusy(true);
      try {
        if (cb.error) throw new Error(`授权被拒绝：${cb.error}${cb.errorDescription ? ` (${cb.errorDescription})` : ''}`);
        const tokens = await exchangeCode(cb.code as string, cb.state ?? '');
        await applyOidcTokens(tokens);
        notify('墨墨授权成功，已切换账号');
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState(null, '', url.toString());
        navigate('', { replace: true });
      } catch (err) {
        setAuthError(explainAny(err).detail);
      } finally {
        setAuthBusy(false);
      }
    };
    void run();
  }, [applyOidcTokens, notify]);

  if (!ready) return <Boot />;

  if (!settings.onboarded && route.name !== 'onboarding') {
    return (
      <div className="app app--plain">
        <main className="main">
          <Onboarding />
        </main>
        <Toasts />
      </div>
    );
  }

  const titles: Record<Route['name'], string> = {
    home: '今日学习',
    generate: '生成精读',
    read: '精读模式',
    quiz: '阅读训练',
    result: '成绩与解析',
    library: '我的书架',
    settings: '设置',
    onboarding: '开始使用',
    auth: '授权回调',
  };

  let body = <Home />;
  switch (route.name) {
    case 'generate':
      body = <Generate />;
      break;
    case 'read':
      body = <Reader articleId={route.param ?? ''} />;
      break;
    case 'quiz':
      body = <Quiz articleId={route.param ?? ''} />;
      break;
    case 'result':
      body = <Result articleId={route.param ?? ''} />;
      break;
    case 'library':
      body = <Library />;
      break;
    case 'settings':
      body = <Settings />;
      break;
    case 'auth':
      body = (
        <div className="page page--narrow">
          <h1 className="h1">{authBusy ? '正在完成授权…' : authError ? '授权没有完成' : '授权回调'}</h1>
          {authError ? <p className="lede">{authError}</p> : <p className="lede">正在与墨墨账号服务交换令牌，请稍候。</p>}
        </div>
      );
      break;
    default:
      body = <Home />;
  }

  const immersive = route.name === 'read' || route.name === 'quiz' || route.name === 'result';

  return (
    <div className={`app ${immersive ? 'app--immersive' : ''}`}>
      <NavRail active={route.name} />
      <div className="shell">
        <TopBar title={titles[route.name]} />
        <main className="main">{body}</main>
      </div>
      <BottomNav active={route.name} />
      <Toasts />
    </div>
  );
}
