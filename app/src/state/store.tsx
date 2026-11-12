/** 应用状态：设置、账号、当日快照、书架、任务、提示条。 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { idb } from '../lib/db';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../lib/settings';
import { localDateString, OidcConnector, TokenConnector, type MaimemoConnector } from '../api/maimemo';
import {
  clearAllStoredTokens,
  listStoredAccounts,
  loadStoredTokens,
  revokeTokens,
  type OidcTokens,
} from '../api/oidc';
import type { AppSettings, Article, GenerationTask, StudySnapshot } from '../types';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'warn' | 'error';
}

export type ConnectorState = 'unknown' | 'ok' | 'error' | 'demo';

interface StoreValue {
  ready: boolean;
  settings: AppSettings;
  setSettings: (patch: Partial<AppSettings>) => void;
  persistNow: (next?: AppSettings) => Promise<void>;
  resetAll: () => Promise<void>;
  accountId: string;
  snapshot: StudySnapshot | null;
  saveSnapshot: (snapshot: StudySnapshot) => Promise<void>;
  loadTodaySnapshot: () => Promise<StudySnapshot | null>;
  connector: MaimemoConnector | null;
  connectorState: ConnectorState;
  setConnectorState: (s: ConnectorState) => void;
  oidcTokens: OidcTokens | null;
  applyOidcTokens: (tokens: OidcTokens) => Promise<void>;
  logoutMaimemo: () => Promise<void>;
  knownAccounts: { sub: string; name?: string }[];
  library: Article[];
  refreshLibrary: () => Promise<void>;
  tasks: GenerationTask[];
  refreshTasks: () => Promise<void>;
  toasts: Toast[];
  notify: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function snapshotKey(accountId: string, date: string): string {
  return `${accountId}|${date}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<StudySnapshot | null>(null);
  const [library, setLibrary] = useState<Article[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [oidcTokens, setOidcTokens] = useState<OidcTokens | null>(null);
  const [connectorState, setConnectorState] = useState<ConnectorState>('unknown');
  const [knownAccounts, setKnownAccounts] = useState<{ sub: string; name?: string }[]>([]);
  const toastId = useRef(1);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshLibrary = useCallback(async () => {
    const all = await idb.all<Article>('articles');
    setLibrary(all.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  const refreshTasks = useCallback(async () => {
    const all = await idb.all<GenerationTask>('tasks');
    setTasks(all.sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadSettings();
      if (cancelled) return;
      setSettingsState(loaded);
      setKnownAccounts(listStoredAccounts());
      if (loaded.maimemoMode === 'oidc' && loaded.accountId.startsWith('oidc:')) {
        const stored = loadStoredTokens(loaded.accountId.slice(5));
        if (stored) setOidcTokens(stored);
      }
      const key = snapshotKey(loaded.accountId, localDateString());
      const cached = await idb.get<StudySnapshot>('snapshots', key);
      if (!cancelled) setSnapshot(cached ?? null);
      await refreshLibrary();
      await refreshTasks();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLibrary, refreshTasks]);

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const persistNow = useCallback(
    async (next?: AppSettings) => {
      const value = next ?? settings;
      await saveSettings(value);
    },
    [settings],
  );

  const saveSnapshot = useCallback(async (next: StudySnapshot) => {
    const withKey: StudySnapshot = { ...next, id: snapshotKey(next.accountId, next.date) };
    await idb.put('snapshots', withKey.id, withKey);
    setSnapshot(withKey);
  }, []);

  const loadTodaySnapshot = useCallback(async () => {
    const key = snapshotKey(settings.accountId, localDateString());
    const cached = await idb.get<StudySnapshot>('snapshots', key);
    if (cached) {
      setSnapshot(cached);
      return cached;
    }
    return null;
  }, [settings.accountId]);

  const connector = useMemo<MaimemoConnector | null>(() => {
    if (settings.maimemoMode === 'token' && settings.maimemoToken.trim()) {
      return new TokenConnector(settings.maimemoToken);
    }
    if (settings.maimemoMode === 'oidc' && oidcTokens) {
      return new OidcConnector(oidcTokens, settings.oidcClientId);
    }
    return null;
  }, [settings.maimemoMode, settings.maimemoToken, settings.oidcClientId, oidcTokens]);

  /**
   * 账号标识同步：连接器换了（换 Token / 换 OIDC 账号）就必须切 accountId，
   * 否则数据会继续挂在上一个账号名下。
   */
  useEffect(() => {
    if (!ready) return;
    if (settings.maimemoMode === 'none') return;
    const expected = connector ? connector.accountKey() : '';
    if (!expected) return;
    if (settings.accountId === expected) return;
    const next: AppSettings = { ...settings, accountId: expected };
    setSettingsState(next);
    void saveSettings(next);
    void (async () => {
      const key = snapshotKey(expected, localDateString());
      const cached = await idb.get<StudySnapshot>('snapshots', key);
      setSnapshot(cached ?? null);
    })();
  }, [ready, connector, settings]);

  const applyOidcTokens = useCallback(
    async (tokens: OidcTokens) => {
      setOidcTokens(tokens);
      const sub = tokens.sub ?? 'unknown';
      const next: AppSettings = {
        ...settings,
        maimemoMode: 'oidc',
        accountId: `oidc:${sub}`,
      };
      setSettingsState(next);
      await saveSettings(next);
      setKnownAccounts(listStoredAccounts());
      const key = snapshotKey(next.accountId, localDateString());
      const cached = await idb.get<StudySnapshot>('snapshots', key);
      setSnapshot(cached ?? null);
      await refreshLibrary();
      await refreshTasks();
    },
    [settings, refreshLibrary, refreshTasks],
  );

  const logoutMaimemo = useCallback(async () => {
    if (oidcTokens) {
      try {
        await revokeTokens(oidcTokens);
      } catch {
        /* 撤销失败不阻断本地登出 */
      }
    }
    // 双保险：即使 revoke 失败，也把本地令牌清干净
    clearAllStoredTokens();
    setOidcTokens(null);
    setKnownAccounts([]);
    const next: AppSettings = { ...settings, maimemoMode: 'none', maimemoToken: '', accountId: 'local' };
    setSettingsState(next);
    await saveSettings(next);
    setConnectorState('unknown');
    setSnapshot(null);
  }, [oidcTokens, settings]);

  const resetAll = useCallback(async () => {
    // ① 先尽力撤销服务端授权（失败不阻断本地清理）
    if (oidcTokens) {
      try {
        await revokeTokens(oidcTokens);
      } catch {
        /* 网络失败也要继续清本地 */
      }
    }
    // ② 清掉 localStorage / sessionStorage 里的全部 OIDC 令牌与待授权上下文
    clearAllStoredTokens();
    // ③ 再清 IndexedDB
    for (const store of ['snapshots', 'articles', 'questions', 'attempts', 'tasks', 'glossary', 'sessions', 'secrets'] as const) {
      await idb.clear(store);
    }
    const next = { ...DEFAULT_SETTINGS, onboarded: true };
    setSettingsState(next);
    await saveSettings(next);
    setSnapshot(null);
    setLibrary([]);
    setTasks([]);
    setOidcTokens(null);
    setKnownAccounts([]);
    setConnectorState('unknown');
  }, [oidcTokens]);

  const value: StoreValue = {
    ready,
    settings,
    setSettings,
    persistNow,
    resetAll,
    accountId: settings.accountId,
    snapshot,
    saveSnapshot,
    loadTodaySnapshot,
    connector,
    connectorState,
    setConnectorState,
    oidcTokens,
    applyOidcTokens,
    logoutMaimemo,
    knownAccounts,
    library: library.filter((a) => !a.accountId || a.accountId === settings.accountId || a.taskId.startsWith('demo')),
    refreshLibrary,
    tasks: tasks.filter((t) => !t.accountId || t.accountId === settings.accountId || t.demo),
    refreshTasks,
    toasts,
    notify,
    dismissToast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
