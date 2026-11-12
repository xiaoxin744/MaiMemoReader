/**
 * 墨墨数据访问层。
 * 两种认证方式（个人 Token / 官方 OIDC）实现同一份 MaimemoConnector 接口，
 * 上层页面只依赖这个接口，未来单独删掉任意一种都不需要改业务代码。
 */
import { AppError, explainMaimemo, explainNetwork } from '../lib/errors';
import type { StudyProgress, StudySnapshot, StudyWord } from '../types';
import { getValidAccessToken, type OidcTokens } from './oidc';

const DEFAULT_BASE = 'https://open.maimemo.com/open';

export interface ConnectorTest {
  ok: boolean;
  /** 是否拿到了 HTTP 响应（用于区分凭证问题与跨域/网络问题） */
  reachable: boolean;
  detail: string;
  latencyMs: number;
  progress?: StudyProgress | null;
}

export interface MaimemoConnector {
  readonly kind: 'token' | 'oidc';
  readonly label: string;
  /**
   * 稳定的本地账号标识，用于数据隔离。
   *
   * 修正记录（2026-10-28）：
   *   此前快照与文章都用 `connector.kind`（只有 'token' / 'oidc' 两个值）当 accountId，
   *   导致：
   *     ① 所有 Token 用户的待办/文章/答题记录混在一起，换 Token 后看到前任的数据；
   *     ② store 层写入的是 `oidc:<sub>`，这里却写 `oidc`，两边对不上，
   *        每次打开都得重新拉快照，永远命中不了缓存。
   *   现在改为返回按真实账号派生的稳定 key。
   */
  accountKey(): string;
  accessToken(): Promise<string>;
  test(relayUrl?: string): Promise<ConnectorTest>;
}

interface RawError {
  errors?: { code?: string; msg?: string; info?: string }[];
  success?: boolean;
}

export interface RawProgress {
  finished?: number;
  total?: number;
  study_time?: number;
}

export interface ProgressResponse {
  progress?: RawProgress;
}

export interface TodayItemRaw {
  voc_id?: string;
  voc_spelling?: string;
  order?: number;
  first_response?: string;
  is_new?: boolean;
  is_finished?: boolean;
}

export interface TodayItemsResponse {
  today_items?: TodayItemRaw[];
}

export function resolveBase(relayUrl: string): string {
  const relay = relayUrl.trim().replace(/\/$/, '');
  if (!relay) return DEFAULT_BASE;
  return `${relay}/maimemo`;
}

async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; token: string; relayUrl: string },
): Promise<T> {
  const base = resolveBase(init.relayUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${init.token}`,
      },
      body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
      signal: controller.signal,
    });
  } catch (err) {
    const explained = explainNetwork('maimemo', (err as Error).message);
    throw new AppError('maimemo', `${explained.title}｜${explained.detail}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const explained = explainMaimemo(res.status, payload);
    throw new AppError('maimemo', explained.title, {
      status: res.status,
      code: (payload as RawError | null)?.errors?.[0]?.code,
      raw: (payload as RawError | null)?.errors?.[0]?.msg ?? text.slice(0, 300),
    });
  }
  if (payload && typeof payload === 'object' && 'success' in payload && (payload as RawError).success === false) {
    const explained = explainMaimemo(res.status, payload);
    throw new AppError('maimemo', explained.title, {
      status: res.status,
      code: (payload as RawError).errors?.[0]?.code,
      raw: (payload as RawError).errors?.[0]?.msg,
    });
  }
  return payload as T;
}

const RESPONSE_MAP: Record<string, StudyWord['response']> = {
  FAMILIAR: 'FAMILIAR',
  VAGUE: 'VAGUE',
  FORGET: 'FORGET',
  WELL_FAMILIAR: 'WELL_FAMILIAR',
};

function toProgress(raw?: RawProgress): StudyProgress | null {
  if (!raw) return null;
  return {
    finished: raw.finished ?? 0,
    total: raw.total ?? 0,
    studyTimeMs: raw.study_time ?? 0,
  };
}

export function mapTodayItem(item: TodayItemRaw, fallbackOrder: number): StudyWord {
  return {
    vocId: item.voc_id,
    spelling: (item.voc_spelling ?? '').trim(),
    order: item.order ?? fallbackOrder,
    response: item.first_response ? RESPONSE_MAP[item.first_response] : undefined,
    isNew: Boolean(item.is_new),
    isFinished: Boolean(item.is_finished),
  };
}

export function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayKey(accountId: string, date = new Date()): string {
  return `${accountId}|${localDateString(date)}`;
}

/** 拉取当日学习数据；接口没有日期参数，语义恒为「账号时区的今天」 */
export async function fetchTodaySnapshot(connector: MaimemoConnector, relayUrl: string): Promise<StudySnapshot> {
  const token = await connector.accessToken();
  const [progressRes, itemsRes] = await Promise.all([
    request<ProgressResponse>('/api/v1/memo/study/get_study_progress', { token, relayUrl }),
    request<TodayItemsResponse>('/api/v1/memo/study/get_today_items', {
      token,
      relayUrl,
      body: { limit: 1000 },
    }),
  ]);
  const words = (itemsRes.today_items ?? [])
    .map((item, i) => mapTodayItem(item, i + 1))
    .filter((w) => w.spelling);
  const progress = toProgress(progressRes.progress);
  const note =
    words.length === 0
      ? '墨墨没有返回今日单词。常见原因：当天还没在 App 里打开学习、未开启自动同步，或今日任务尚未初始化。'
      : undefined;
  return {
    id: todayKey(connector.accountKey()),
    accountId: connector.accountKey(),
    date: localDateString(),
    fetchedAt: Date.now(),
    source: 'maimemo',
    progress,
    words,
    note,
  };
}

/** 单词查询接口，用于补全拼写校验或反查 id */
export async function lookupVocabulary(
  connector: MaimemoConnector,
  relayUrl: string,
  spelling: string,
): Promise<{ id: string; spelling: string } | null> {
  const token = await connector.accessToken();
  const res = await request<{ voc?: { id: string; spelling: string } }>(
    `/api/v1/memo/vocabulary?spelling=${encodeURIComponent(spelling)}`,
    { method: 'GET', token, relayUrl },
  );
  return res.voc ?? null;
}

/** 由 Token 派生的稳定指纹：不暴露原文，同一 Token 恒定映射到同一账号 */
function fingerprint(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export class TokenConnector implements MaimemoConnector {
  readonly kind = 'token' as const;
  readonly label = '个人 Token';
  private token: string;

  constructor(token: string) {
    this.token = token.trim();
  }

  /** 换 Token 即视为换账号，数据互不可见 */
  accountKey(): string {
    if (!this.token) return 'token:anonymous';
    return `token:${fingerprint(this.token)}`;
  }

  async accessToken(): Promise<string> {
    if (!this.token) throw new AppError('maimemo', '尚未填写墨墨个人 API Token');
    return this.token;
  }

  async test(relayUrl = ''): Promise<ConnectorTest> {
    const started = performance.now();
    try {
      const token = await this.accessToken();
      const res = await request<ProgressResponse>('/api/v1/memo/study/get_study_progress', { token, relayUrl });
      return {
        ok: true,
        reachable: true,
        detail: 'Token 有效，已读到今日学习进度',
        latencyMs: Math.round(performance.now() - started),
        progress: toProgress(res.progress),
      };
    } catch (err) {
      const e = err as AppError;
      return {
        ok: false,
        reachable: Boolean(e.status),
        detail: e.message,
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }
}

export class OidcConnector implements MaimemoConnector {
  readonly kind = 'oidc' as const;
  readonly label = '墨墨授权登录';
  private tokens: OidcTokens;
  private clientId: string;

  constructor(tokens: OidcTokens, clientId: string) {
    this.tokens = tokens;
    this.clientId = clientId;
  }

  /** 与 store 层的 `oidc:<sub>` 保持完全一致，否则快照永远命中不了缓存 */
  accountKey(): string {
    const sub = this.tokens.sub;
    return sub ? `oidc:${sub}` : 'oidc:unknown';
  }

  async accessToken(): Promise<string> {
    const fresh = await getValidAccessToken(this.tokens, this.clientId);
    this.tokens = fresh;
    return fresh.access_token;
  }

  async test(relayUrl = ''): Promise<ConnectorTest> {
    const started = performance.now();
    try {
      const token = await this.accessToken();
      const res = await request<ProgressResponse>('/api/v1/memo/study/get_study_progress', { token, relayUrl });
      return {
        ok: true,
        reachable: true,
        detail: '授权有效，已读到今日学习进度',
        latencyMs: Math.round(performance.now() - started),
        progress: toProgress(res.progress),
      };
    } catch (err) {
      const e = err as AppError;
      return {
        ok: false,
        reachable: Boolean(e.status),
        detail: e.message,
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }
}
