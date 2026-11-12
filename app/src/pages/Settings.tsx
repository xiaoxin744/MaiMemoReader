import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { idb } from '../lib/db';
import { MODELS, apiConfigError, apiTargetOf, isPeakNow, normalizeBaseUrl, verifyKey } from '../api/deepseek';
import { beginAuthorization } from '../api/oidc';
import { explainAny } from '../lib/errors';
import { maskSecret } from '../lib/vault';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { todayKey } from '../api/maimemo';
import { cny } from '../lib/format';
import type { AppSettings, ExportBundle } from '../types';

type Section = 'maimemo' | 'ai' | 'generate' | 'data' | 'about';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'maimemo', label: '墨墨背单词' },
  { key: 'ai', label: 'AI 接口' },
  { key: 'generate', label: '生成偏好' },
  { key: 'data', label: '数据与存储' },
  { key: 'about', label: '关于与说明' },
];

export default function SettingsPage() {
  const {
    settings,
    setSettings,
    persistNow,
    resetAll,
    connector,
    oidcTokens,
    logoutMaimemo,
    notify,
    refreshLibrary,
    refreshTasks,
    saveSnapshot,
  } = useApp();
  const [section, setSection] = useState<Section>('maimemo');
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [tokenTest, setTokenTest] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [keyTest, setKeyTest] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    void navigator.storage?.estimate?.().then((est) => setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 }));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSettings(patch);
  };

  const save = async () => {
    await persistNow({
      ...settings,
      ...draft,
      deepseekKey: draft.deepseekKey.trim(),
      customApiKey: draft.customApiKey.trim(),
      customApiBase: draft.customApiBase.trim(),
      customApiModel: draft.customApiModel.trim(),
      maimemoToken: draft.maimemoToken.trim(),
    });
    notify('设置已保存到本机', 'ok');
  };

  const testMaimemo = async () => {
    if (!connector) {
      setTokenTest('还没有可用的凭证：请填写 Token 或完成授权登录。');
      return;
    }
    setTesting(true);
    setTokenTest(null);
    try {
      const result = await connector.test(settings.relayUrl);
      setTokenTest(
        result.ok
          ? `连接正常（${result.latencyMs} ms）· 今日进度 ${result.progress?.finished ?? 0}/${result.progress?.total ?? '?'}`
          : `${result.detail}｜${result.reachable ? '已拿到 HTTP 响应，说明浏览器可达，问题在凭证或权限。' : '没有读到响应，可能是跨域限制、网络中断或 Token 错误（墨墨在错误响应上不返回跨域头，前端无法区分）。'}`,
      );
    } finally {
      setTesting(false);
    }
  };

  const testAi = async () => {
    const target = apiTargetOf(draft);
    const problem = apiConfigError(target);
    if (problem) {
      setKeyTest(problem);
      return;
    }
    setKeyBusy(true);
    setKeyTest(null);
    try {
      const result = await verifyKey(target.apiKey, {
        provider: target.provider,
        baseUrl: target.baseUrl,
        model: target.model,
      });
      setKeyTest(`${result.detail}${result.ok ? ` · ${result.latencyMs} ms` : ''}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const exportData = async () => {
    const [snapshots, articles, questions, attempts, tasks] = await Promise.all([
      idb.all('snapshots'),
      idb.all('articles'),
      idb.all('questions'),
      idb.all('attempts'),
      idb.all('tasks'),
    ]);
    const { deepseekKey: _k, customApiKey: _c, maimemoToken: _t, ...safeSettings } = settings;
    const bundle: ExportBundle = {
      app: 'memo-reader',
      version: 1,
      exportedAt: Date.now(),
      settings: safeSettings,
      snapshots,
      articles,
      questions,
      attempts,
      tasks,
    } as ExportBundle;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memo-reader-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('已导出（不含任何密钥）', 'ok');
  };

  const importData = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as ExportBundle;
      if (bundle.app !== 'memo-reader') throw new Error('不是本应用导出的文件');
      for (const s of bundle.snapshots ?? []) await idb.put('snapshots', s.id, s);
      for (const a of bundle.articles ?? []) await idb.put('articles', a.id, a);
      for (const q of bundle.questions ?? []) await idb.put('questions', q.id, q);
      for (const t of bundle.attempts ?? []) await idb.put('attempts', t.id, t);
      for (const t of bundle.tasks ?? []) await idb.put('tasks', t.id, t);
      await refreshLibrary();
      await refreshTasks();
      notify('导入完成，已合并到本机书架', 'ok');
    } catch (err) {
      notify(`导入失败：${(err as Error).message}`, 'error');
    }
  };

  const clearAll = async () => {
    if (!window.confirm('清除后将删除本机所有文章、题目、作答记录与凭证。确认继续？')) return;
    await resetAll();
    notify('本地数据已清空', 'warn');
  };

  const relayHint = useMemo(
    () =>
      settings.relayUrl
        ? `当前通过学习数据走中继：${settings.relayUrl}/maimemo。中继只转发请求、不落库。`
        : '未启用中继，浏览器直连 open.maimemo.com。',
    [settings.relayUrl],
  );

  return (
    <div className="page page--settings">
      <header className="settings__head">
        <p className="eyebrow">设置</p>
        <h1 className="display display--sm">把钥匙放在自己手里</h1>
        <p className="lede">所有凭证只存在这台设备。默认仅当前会话有效，除非你主动勾选长期保存。</p>
      </header>

      <div className="settings__tabs">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`settings__tab ${section === s.key ? 'is-active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'maimemo' ? (
        <section className="settings__panel">
          <h2 className="h2">连接方式</h2>
          <div className="segmented">
            <button
              type="button"
              className={`segmented__item ${draft.maimemoMode === 'token' ? 'is-active' : ''}`}
              onClick={() => update({ maimemoMode: 'token' })}
            >
              个人 Token
            </button>
            <button
              type="button"
              className={`segmented__item ${draft.maimemoMode === 'oidc' ? 'is-active' : ''}`}
              onClick={() => update({ maimemoMode: 'oidc' })}
            >
              官方授权（PKCE）
            </button>
          </div>

          {draft.maimemoMode === 'token' ? (
            <>
              <label className="field">
                <span className="field__label">墨墨个人 API Token</span>
                <input
                  className="input input--mono"
                  type="password"
                  autoComplete="off"
                  placeholder="在墨墨 App → 我的 → 更多设置 → 实验功能 → 开放 API 获取"
                  value={draft.maimemoToken}
                  onChange={(e) => update({ maimemoToken: e.target.value })}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.maimemoTokenPersist}
                  onChange={(e) => update({ maimemoTokenPersist: e.target.checked })}
                />
                <span>在本机长期保存（关闭后只在当前会话有效）</span>
              </label>
              {settings.maimemoToken ? (
                <p className="meta">当前密钥：{maskSecret(settings.maimemoToken)}</p>
              ) : null}
            </>
          ) : (
            <>
              <label className="field">
                <span className="field__label">OIDC client_id</span>
                <input
                  className="input input--mono"
                  placeholder="在 open.maimemo.com/app 创建「纯前端应用」后获得"
                  value={draft.oidcClientId}
                  onChange={(e) => update({ oidcClientId: e.target.value.trim() })}
                />
              </label>
              <label className="field">
                <span className="field__label">scope（需与审核通过的权限一致）</span>
                <input
                  className="input input--mono"
                  value={draft.oidcScope}
                  onChange={(e) => update({ oidcScope: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  try {
                    await save();
                    const url = await beginAuthorization(draft.oidcClientId, draft.oidcScope);
                    window.location.href = url;
                  } catch (err) {
                    notify(explainAny(err).detail, 'error');
                  }
                }}
              >
                {oidcTokens ? '重新授权' : '开始墨墨授权登录'}
              </button>
              {oidcTokens ? (
                <p className="meta">
                  授权账号：{oidcTokens.name ?? oidcTokens.sub ?? '未知'} · 过期时间{' '}
                  {new Date(oidcTokens.expires_at).toLocaleTimeString('zh-CN')}
                </p>
              ) : (
                <p className="meta">
                  需要先在开放平台创建「纯前端应用」，把 {window.location.origin}
                  {window.location.pathname} 填为回调地址，审核通过后才会允许跨域读取。
                </p>
              )}
            </>
          )}

          <div className="settings__row">
            <button type="button" className="btn btn--ghost" onClick={testMaimemo} disabled={testing}>
              {testing ? '测试中…' : '连接测试'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={save}>
              保存设置
            </button>
            {oidcTokens || settings.maimemoToken ? (
              <button type="button" className="btn btn--quiet" onClick={async () => { await logoutMaimemo(); notify('已退出墨墨账号', 'warn'); }}>
                断开连接
              </button>
            ) : null}
          </div>
          {tokenTest ? <div className="alert alert--info">{tokenTest}</div> : null}

          <label className="field">
            <span className="field__label">可选：Cloudflare Worker 中继地址</span>
            <input
              className="input input--mono"
              placeholder="https://your-worker.example.workers.dev"
              value={draft.relayUrl}
              onChange={(e) => update({ relayUrl: e.target.value.trim().replace(/\/$/, '') })}
            />
          </label>
          <p className="hint">
            {relayHint}
            <br />
            直连失败时才会用到中继：它只把 Authorization 头与请求体原样转发给 open.maimemo.com，不保存任何数据，也不接受任意 URL。
          </p>
        </section>
      ) : null}

      {section === 'ai' ? (
        <section className="settings__panel">
          <h2 className="h2">接口来源</h2>
          <div className="segmented">
            <button
              type="button"
              className={`segmented__item ${draft.apiProvider === 'deepseek' ? 'is-active' : ''}`}
              onClick={() => update({ apiProvider: 'deepseek' })}
            >
              DeepSeek 官方
            </button>
            <button
              type="button"
              className={`segmented__item ${draft.apiProvider === 'custom' ? 'is-active' : ''}`}
              onClick={() => update({ apiProvider: 'custom' })}
            >
              自定义（OpenAI 兼容）
            </button>
          </div>
          <p className="hint">
            两套配置各自保存，切换后立即生效；密钥都不写进导出的数据文件。
          </p>

          {draft.apiProvider === 'deepseek' ? (
            <>
              <h2 className="h2">API Key</h2>
              <label className="field">
                <span className="field__label">DeepSeek API Key</span>
                <input
                  className="input input--mono"
                  type="password"
                  autoComplete="off"
                  placeholder="sk-..."
                  value={draft.deepseekKey}
                  onChange={(e) => update({ deepseekKey: e.target.value })}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.deepseekKeyPersist}
                  onChange={(e) => update({ deepseekKeyPersist: e.target.checked })}
                />
                <span>在本机长期保存（关闭则只在当前会话有效，刷新页面后需重新输入）</span>
              </label>
              <div className="settings__row">
                <button type="button" className="btn btn--ghost" onClick={testAi} disabled={keyBusy}>
                  {keyBusy ? '验证中…' : '验证 Key'}
                </button>
                <button type="button" className="btn btn--quiet" onClick={save}>
                  保存
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={async () => {
                    update({ deepseekKey: '' });
                    await persistNow({ ...settings, deepseekKey: '' });
                    setKeyTest(null);
                    notify('已清除本机保存的 Key', 'warn');
                  }}
                >
                  清除
                </button>
              </div>
              {keyTest ? <div className="alert alert--info">{keyTest}</div> : null}

              <h2 className="h2">模型与能力</h2>
              <div className="model-list">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`model-card ${draft.model === m.id ? 'is-active' : ''}`}
                    onClick={() => update({ model: m.id })}
                  >
                    <div className="model-card__head">
                      <strong>{m.label}</strong>
                      <span className="model-card__id">{m.id}</span>
                    </div>
                    <p>{m.note}</p>
                    <p className="meta">
                      输入 {m.inputCachedCny} / {m.inputMissCny} 元 · 输出 {m.outputCny} 元（每百万 token，缓存命中/未命中）
                    </p>
                  </button>
                ))}
              </div>
              <p className="hint">
                当前为{isPeakNow() ? '高峰时段' : '空闲时段'}，价格按{isPeakNow() ? '高峰价' : '空闲价'}估算；法定节假日无法在前端判断，仅作提示。
              </p>
              <label className="toggle">
                <input type="checkbox" checked={draft.thinking} onChange={(e) => update({ thinking: e.target.checked })} />
                <span>默认开启深度思考（thinking: enabled，更慢但推理更稳）</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={draft.webSearch} onChange={(e) => update({ webSearch: e.target.checked })} />
                <span>默认联网检索真题风格参考（调用 /v1/tools/search，按次计费）</span>
              </label>
              <label className="field field--inline">
                <span className="field__label">单次成本提醒阈值（元）</span>
                <input
                  className="input input--num"
                  type="number"
                  step={0.1}
                  min={0}
                  value={draft.costWarnCny}
                  onChange={(e) => update({ costWarnCny: Number(e.target.value) || 0 })}
                />
              </label>
            </>
          ) : (
            <>
              <h2 className="h2">连接信息</h2>
              <label className="field">
                <span className="field__label">Base URL</span>
                <input
                  className="input input--mono"
                  autoComplete="off"
                  placeholder="https://api.openai.com/v1"
                  value={draft.customApiBase}
                  onChange={(e) => update({ customApiBase: e.target.value })}
                />
              </label>
              <p className="hint">
                填到版本根路径即可（通常以 <code>/v1</code> 结尾），应用会请求{' '}
                <code>{normalizeBaseUrl(draft.customApiBase) || 'https://…/v1'}/chat/completions</code>
                ；直接粘贴完整地址也会自动去掉多余部分。常见示例：OpenAI <code>https://api.openai.com/v1</code>、Ollama{' '}
                <code>http://localhost:11434/v1</code>、LM Studio <code>http://localhost:1234/v1</code>。
              </p>
              <label className="field">
                <span className="field__label">模型名</span>
                <input
                  className="input input--mono"
                  autoComplete="off"
                  placeholder="gpt-4o-mini / Qwen2.5-7B-Instruct / llama3.1"
                  value={draft.customApiModel}
                  onChange={(e) => update({ customApiModel: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">API Key（本地服务可留空）</span>
                <input
                  className="input input--mono"
                  type="password"
                  autoComplete="off"
                  placeholder="sk-... 或留空"
                  value={draft.customApiKey}
                  onChange={(e) => update({ customApiKey: e.target.value })}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.customApiKeyPersist}
                  onChange={(e) => update({ customApiKeyPersist: e.target.checked })}
                />
                <span>在本机长期保存这个 Key（关闭则只在当前会话有效）</span>
              </label>
              <div className="settings__row">
                <button type="button" className="btn btn--ghost" onClick={testAi} disabled={keyBusy}>
                  {keyBusy ? '连接中…' : '验证连接'}
                </button>
                <button type="button" className="btn btn--quiet" onClick={save}>
                  保存
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={async () => {
                    update({ customApiKey: '' });
                    await persistNow({ ...settings, customApiKey: '' });
                    setKeyTest(null);
                    notify('已清除本机保存的自定义接口 Key', 'warn');
                  }}
                >
                  清除 Key
                </button>
              </div>
              {keyTest ? <div className="alert alert--info">{keyTest}</div> : null}
              <p className="hint">
                只使用标准的 <code>/chat/completions</code> 流式协议；若服务不支持 JSON 模式或流式用量统计，会自动降级重试一次。
                费用由你的服务商结算，本应用无法估算金额；「深度思考」与「联网检索」是 DeepSeek 专有能力，自定义模式下不会发送。
                浏览器直连要求服务端允许当前页面跨域（CORS），本地 Ollama / LM Studio 需显式开启。
              </p>
            </>
          )}
        </section>
      ) : null}

      {section === 'generate' ? (
        <section className="settings__panel">
          <h2 className="h2">默认生成参数</h2>
          <div className="row">
            <label className="field field--inline">
              <span className="field__label">考试模式</span>
              <select className="select" value={draft.exam} onChange={(e) => update({ exam: e.target.value as AppSettings['exam'] })}>
                <option value="cet4">CET-4</option>
                <option value="cet6">CET-6</option>
                <option value="kaoyan1">考研英语一</option>
                <option value="kaoyan2">考研英语二</option>
              </select>
            </label>
            <label className="field field--inline">
              <span className="field__label">篇幅</span>
              <select className="select" value={draft.length} onChange={(e) => update({ length: e.target.value as AppSettings['length'] })}>
                <option value="short">短文</option>
                <option value="medium">标准</option>
                <option value="long">长文</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label className="field field--inline">
              <span className="field__label">题目数量</span>
              <input
                className="input input--num"
                type="number"
                min={3}
                max={6}
                value={draft.questionCount}
                onChange={(e) => update({ questionCount: Math.max(3, Math.min(6, Number(e.target.value) || 4)) })}
              />
            </label>
            <label className="field field--inline">
              <span className="field__label">组篇方式</span>
              <select
                className="select"
                value={draft.articleMode}
                onChange={(e) => update({ articleMode: e.target.value as AppSettings['articleMode'] })}
              >
                <option value="single">单篇</option>
                <option value="auto">自动组篇</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field__label">默认题材</span>
            <input className="input" value={draft.theme} onChange={(e) => update({ theme: e.target.value })} placeholder="留空则由 AI 决定" />
          </label>

          <h2 className="h2">外观</h2>
          <div className="segmented">
            {(['auto', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`segmented__item ${draft.themeMode === mode ? 'is-active' : ''}`}
                onClick={() => update({ themeMode: mode })}
              >
                {mode === 'auto' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
              </button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={draft.reduceMotion} onChange={(e) => update({ reduceMotion: e.target.checked })} />
            <span>减少动态效果（同时尊重系统的「减弱动态效果」设置）</span>
          </label>
          <div className="settings__row">
            <button type="button" className="btn btn--primary" onClick={save}>
              保存设置
            </button>
          </div>
        </section>
      ) : null}

      {section === 'data' ? (
        <section className="settings__panel">
          <h2 className="h2">本机数据</h2>
          <p className="meta">
            {storage ? `已用 ${(storage.usage / 1024 / 1024).toFixed(2)} MB · 配额约 ${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB` : '正在读取存储用量…'}
          </p>
          <div className="settings__row">
            <button type="button" className="btn btn--ghost" onClick={exportData}>
              导出全部数据
            </button>
            <label className="btn btn--quiet">
              导入
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importData(file);
                  e.target.value = '';
                }}
              />
            </label>
            <button type="button" className="btn btn--quiet btn--danger" onClick={clearAll}>
              清除本机数据
            </button>
          </div>
          <p className="hint">
            导出文件不包含任何 API Key 与墨墨 Token。清除会同时删除书架、作答记录与未完成任务。
            不同账号的记录按 accountId 隔离，切换账号后旧账号的文章不会出现在当前书架。
          </p>
          <div className="settings__row">
            <button
              type="button"
              className="btn btn--quiet"
              onClick={async () => {
                await saveSnapshot({
                  id: todayKey(settings.accountId),
                  accountId: settings.accountId,
                  date: new Date().toISOString().slice(0, 10),
                  fetchedAt: 0,
                  source: 'demo',
                  progress: null,
                  words: [],
                  note: '占位快照，可在首页重新同步。',
                });
                notify('已重置今日快照，可回首页重新同步', 'ok');
              }}
            >
              重置今日快照
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => navigate('')}>
              回首页
            </button>
          </div>
        </section>
      ) : null}

      {section === 'about' ? (
        <section className="settings__panel">
          <h2 className="h2">安装到主屏幕</h2>
          <div className="install">
            {installPrompt ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  const prompt = installPrompt as Event & { prompt?: () => Promise<void> };
                  await prompt.prompt?.();
                  setInstallPrompt(null);
                }}
              >
                立即安装
              </button>
            ) : null}
            <ol className="install__steps">
              <li>
                <strong>iPhone / iPad</strong>：Safari 打开本页 → 分享按钮 → 「添加到主屏幕」。之后从主屏幕图标进入即为独立窗口，支持离线阅读已保存文章。
              </li>
              <li>
                <strong>Windows</strong>：Chrome / Edge 地址栏右侧的安装图标，或菜单 → 「安装 MaiMemo Reader」。
              </li>
              <li>首次安装后建议联网打开一次，让 Service Worker 缓存静态资源。</li>
            </ol>
          </div>

          <h2 className="h2">接口与隐私</h2>
          <ul className="bullets">
            <li>学习数据来自墨墨开放 API（open.maimemo.com/open/api/v1/memo/study/*），仅读取当日学习进度与单词状态。</li>
            <li>文章、选词、题目、解析由你在「AI 接口」里选择的接口生成：DeepSeek 官方（api.deepseek.com）或你填写的 OpenAI 兼容服务；两者都由浏览器直连，不经过本项目任何服务器。</li>
            <li>浏览器直连结论：DeepSeek 对任意 Origin 回显 CORS（含错误响应）；墨墨开放 API 预检通过，但错误响应不带跨域头，因此「Token 错误」和「跨域失败」在浏览器里表现相同，需要靠连接测试或中继区分。自定义接口能否直连取决于其服务端的 CORS 配置。</li>
            <li>所有内容存于 IndexedDB，按账号隔离；不做跨设备同步，也没有中央数据库。</li>
            <li>Service Worker 只缓存应用静态资源，任何带 Authorization 的请求都不缓存。</li>
          </ul>

          <h2 className="h2">已知限制</h2>
          <ul className="bullets">
            <li>墨墨学习数据接口仍标注「公测」，字段与可用性可能调整；当天未在 App 内初始化学习时拿不到数据。</li>
            <li>官方授权需要先在开放平台创建「纯前端应用」并通过审核，回调域名必须与主页一致；未审核的应用只能先用个人 Token 或演示模式。</li>
            <li>iOS 切后台可能暂停网络请求，长文生成建议保持前台；中断后从已完成阶段继续，不会重复计费。</li>
            <li>费用仅在 DeepSeek 官方模式下按官方定价表估算，最终以 DeepSeek 账单为准；自定义接口由你的服务商结算，应用不显示金额。</li>
          </ul>

          <p className="meta">版本 1.0 · 本地优先 · 无追踪脚本</p>
        </section>
      ) : null}

      <p className="settings__foot meta">
        更多说明见仓库 docs/ 目录：使用说明、文件清单、接口测试报告。
      </p>
    </div>
  );
}
