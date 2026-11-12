/**
 * 墨墨官方 OIDC 授权（Authorization Code + PKCE，公开客户端）。
 * 依据 https://accounts.maimemo.com/oidc/.well-known/openid-configuration 的实际字段实现。
 */
import { AppError } from '../lib/errors';

export const OIDC = {
  issuer: 'https://accounts.maimemo.com/oidc',
  authorizationEndpoint: 'https://accounts.maimemo.com/oidc/auth',
  tokenEndpoint: 'https://accounts.maimemo.com/oidc/token',
  userinfoEndpoint: 'https://accounts.maimemo.com/oidc/me',
  endSessionEndpoint: 'https://accounts.maimemo.com/oidc/session/end',
  revocationEndpoint: 'https://accounts.maimemo.com/oidc/token/revocation',
};

const PENDING_KEY = 'memo-reader.oidc.pending';
const TOKEN_KEY_PREFIX = 'memo-reader.oidc.tokens.';

export interface OidcTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_at: number;
  sub?: string;
  name?: string;
}

interface PendingAuth {
  state: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  clientId: string;
  createdAt: number;
}

function base64Url(bytes: Uint8Array): string {
  let str = '';
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes = 48): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** 回调地址：与站点根路径保持一致，GitHub Pages 子路径下也能正确回到应用 */
export function defaultRedirectUri(): string {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  return url.toString();
}

export function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const decoded = decodeURIComponent(
      Array.from(json)
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function beginAuthorization(clientId: string, scope: string): Promise<string> {
  if (!clientId.trim()) {
    throw new AppError('oidc', '还没有填写 OIDC client_id（开放平台创建应用后获得）');
  }
  const verifier = randomToken(48);
  const challenge = await s256(verifier);
  const pending: PendingAuth = {
    state: randomToken(16),
    verifier,
    nonce: randomToken(16),
    redirectUri: defaultRedirectUri(),
    clientId: clientId.trim(),
    createdAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = new URL(OIDC.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', pending.clientId);
  url.searchParams.set('redirect_uri', pending.redirectUri);
  url.searchParams.set('scope', scope || 'openid profile');
  url.searchParams.set('state', pending.state);
  url.searchParams.set('nonce', pending.nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export function readPending(): PendingAuth | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingAuth) : null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function tokenRequest(form: Record<string, string>): Promise<Record<string, unknown>> {
  const { signal, done } = withTimeout(30_000);
  let res: Response;
  try {
    res = await fetch(OIDC.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal,
    });
  } catch (err) {
    throw new AppError('oidc', `令牌请求未完成：${(err as Error).message}`);
  } finally {
    done();
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = json.error as string | undefined;
    const desc = json.error_description as string | undefined;
    throw new AppError('oidc', `令牌端点返回 ${res.status}${err ? `（${err}）` : ''}${desc ? `：${desc}` : ''}`);
  }
  return json;
}

export async function exchangeCode(code: string, expectedState: string): Promise<OidcTokens> {
  const pending = readPending();
  if (!pending) throw new AppError('oidc', '找不到待完成的授权上下文，请重新点击授权登录');
  if (pending.state !== expectedState) throw new AppError('oidc', 'state 不匹配，这次回调可能是伪造或被中断的');
  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    throw new AppError('oidc', '授权上下文已过期（超过 10 分钟），请重新发起');
  }
  const json = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.verifier,
  });
  clearPending();
  return normaliseTokens(json);
}

function normaliseTokens(json: Record<string, unknown>): OidcTokens {
  const accessToken = String(json.access_token ?? '');
  if (!accessToken) throw new AppError('oidc', '令牌响应里没有 access_token');
  const expiresIn = Number(json.expires_in ?? 3600);
  const idToken = json.id_token ? String(json.id_token) : undefined;
  const claims = decodeJwtPayload(idToken);
  const tokens: OidcTokens = {
    access_token: accessToken,
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    id_token: idToken,
    token_type: json.token_type ? String(json.token_type) : 'Bearer',
    scope: json.scope ? String(json.scope) : undefined,
    expires_at: Date.now() + Math.max(expiresIn - 60, 30) * 1000,
    sub: claims?.sub ? String(claims.sub) : undefined,
    name: claims?.name ? String(claims.name) : undefined,
  };
  if (tokens.sub) {
    // 只在本地保存，用于回显与账号隔离；不含 client_secret
    try {
      localStorage.setItem(TOKEN_KEY_PREFIX + tokens.sub, JSON.stringify(tokens));
    } catch {
      /* ignore */
    }
  }
  return tokens;
}

export async function getValidAccessToken(tokens: OidcTokens, clientId: string): Promise<OidcTokens> {
  if (tokens.expires_at > Date.now()) return tokens;
  if (!tokens.refresh_token) {
    throw new AppError('oidc', '授权已过期，且没有 refresh_token，请重新授权');
  }
  const json = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  });
  const next = normaliseTokens({ ...json, refresh_token: json.refresh_token ?? tokens.refresh_token });
  return { ...next, sub: next.sub ?? tokens.sub, name: next.name ?? tokens.name };
}

export function loadStoredTokens(sub: string): OidcTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY_PREFIX + sub);
    return raw ? (JSON.parse(raw) as OidcTokens) : null;
  } catch {
    return null;
  }
}

export function listStoredAccounts(): { sub: string; name?: string }[] {
  const out: { sub: string; name?: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(TOKEN_KEY_PREFIX)) {
        const tokens = JSON.parse(localStorage.getItem(key) ?? '{}') as OidcTokens;
        out.push({ sub: key.slice(TOKEN_KEY_PREFIX.length), name: tokens.name });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * 清除本机保存的全部 OIDC 令牌与授权上下文。
 *
 * 「清除本机所有数据」必须调用这里，否则 IndexedDB 清空了，
 * localStorage 里的 access_token / refresh_token 依然留着，
 * 列表还会列出已"删除"的账号。
 * @returns 实际清除的令牌条目数
 */
export function clearAllStoredTokens(): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(TOKEN_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      localStorage.removeItem(key);
      removed += 1;
    }
    // 未完成的授权流程也一并丢弃
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  return removed;
}

export async function revokeTokens(tokens: OidcTokens): Promise<void> {
  try {
    await fetch(OIDC.revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.access_token }).toString(),
    });
  } catch {
    /* 撤销失败不阻断本地登出 */
  }
  try {
    if (tokens.sub) localStorage.removeItem(TOKEN_KEY_PREFIX + tokens.sub);
  } catch {
    /* ignore */
  }
}

/** 回调地址里可能带 code/state，也可能带 error */
export function readCallback(search: string): { code?: string; state?: string; error?: string; errorDescription?: string } {
  const params = new URLSearchParams(search);
  return {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
    errorDescription: params.get('error_description') ?? undefined,
  };
}
