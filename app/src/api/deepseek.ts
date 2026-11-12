/**
 * OpenAI 兼容的 LLM 客户端（默认 DeepSeek 官方接口）。
 *
 * 浏览器直连：DeepSeek 对任意 Origin 回显 CORS 头（含错误响应）；
 * 自定义接口是否可直连取决于服务端的 CORS 配置。
 *
 * 文件名保留 deepseek.ts，是因为它最早只服务 DeepSeek；现在通过
 * ChatOptions.provider / baseUrl 支持任意兼容 POST /chat/completions 的服务。
 */
import { AppError, explainDeepSeek } from '../lib/errors';
import type { ApiProvider, AppSettings, ModelPrice } from '../types';

export const DEEPSEEK_BASE = 'https://api.deepseek.com';

export const MODELS: ModelPrice[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    inputCachedCny: 0.02,
    inputMissCny: 1,
    outputCny: 4,
    note: 'V4.1-Flash，速度快、成本低，适合日常精读生成',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    inputCachedCny: 0.15,
    inputMissCny: 4.5,
    outputCny: 13.5,
    note: 'V4-Pro，长文与命题质量更稳，成本约为 Flash 的 4.5 倍',
  },
];

/** 一次生成实际使用的接口参数（由设置解析而来，页面与管线共用） */
export interface ApiTarget {
  provider: ApiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 规范化用户填写的 Base URL：去掉首尾空白、末尾斜杠；
 * 允许直接粘贴完整的 .../chat/completions（会自动剥掉这一段）。
 */
export function normalizeBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '');
}

/** 从设置里解析出当前要用的接口；model 可覆盖（用于恢复旧任务时沿用任务里的模型） */
export function apiTargetOf(settings: AppSettings, model?: string): ApiTarget {
  if (settings.apiProvider === 'custom') {
    return {
      provider: 'custom',
      baseUrl: normalizeBaseUrl(settings.customApiBase),
      apiKey: settings.customApiKey.trim(),
      model: (model ?? settings.customApiModel).trim(),
    };
  }
  return {
    provider: 'deepseek',
    baseUrl: DEEPSEEK_BASE,
    apiKey: settings.deepseekKey.trim(),
    model: model ?? settings.model,
  };
}

/** 返回阻止请求的原因；null 表示配置可用。自定义接口允许空 Key（本地服务常见）。 */
export function apiConfigError(target: ApiTarget): string | null {
  if (target.provider === 'custom') {
    if (!target.baseUrl) return '还没有填写自定义 API 的 Base URL';
    if (!/^https?:\/\//i.test(target.baseUrl)) return 'Base URL 需要以 http:// 或 https:// 开头';
    if (!target.model) return '还没有填写自定义 API 的模型名';
    return null;
  }
  if (!target.apiKey) return '还没有填写 DeepSeek API Key';
  return null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface ChatResult {
  content: string;
  usage: TokenUsage;
  finishReason: string;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  /** 默认 deepseek；custom 时不发送 DeepSeek 专有的 thinking / reasoning_effort */
  provider?: ApiProvider;
  /** 默认 DEEPSEEK_BASE；custom 时必填 */
  baseUrl?: string;
  json?: boolean;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onDelta?: (delta: string) => void;
}

function priceOf(model: string): ModelPrice {
  return MODELS.find((m) => m.id === model) ?? MODELS[0];
}

/** 北京时间高峰时段：周一至周五 9:00-12:00、14:00-18:00（法定节假日无法在前端判断，仅作提示） */
export function isPeakNow(date = new Date()): boolean {
  const beijing = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const day = beijing.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = beijing.getHours() * 60 + beijing.getMinutes();
  return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
}

/**
 * 费用估算。自定义接口的计价方式未知，恒返回 0（UI 显示「由服务商结算」）；
 * provider 参数放在最后，保持旧调用与测试兼容。
 */
export function costOf(
  model: string,
  usage: TokenUsage | null,
  searchCalls = 0,
  provider: ApiProvider = 'deepseek',
): number {
  if (provider === 'custom') return 0;
  const price = priceOf(model);
  const peak = isPeakNow() ? 2 : 1;
  const hit = usage?.prompt_cache_hit_tokens ?? 0;
  const miss = usage?.prompt_cache_miss_tokens ?? Math.max((usage?.prompt_tokens ?? 0) - hit, 0);
  const out = usage?.completion_tokens ?? 0;
  const modelCost =
    ((hit * price.inputCachedCny + miss * price.inputMissCny + out * price.outputCny) / 1_000_000) * peak;
  const searchCost = (searchCalls * 5) / 1000;
  return modelCost + searchCost;
}

/** 流式响应两帧之间允许的最长静默；超过即判定网络卡死，不再无限等待 */
const STREAM_IDLE_TIMEOUT = 45_000;

async function post(
  path: string,
  apiKey: string,
  body: unknown,
  signal?: AbortSignal,
  timeoutMs = 240_000,
  baseUrl = DEEPSEEK_BASE,
  provider: ApiProvider = 'deepseek',
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // 本地模型服务通常不需要鉴权；只有拿到 Key 时才发 Authorization
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AppError(
        'deepseek',
        signal?.aborted ? '请求已取消' : `请求超时（${Math.round(timeoutMs / 1000)} 秒内没有完成）`,
        { provider },
      );
    }
    throw new AppError('deepseek', (err as Error).message || '网络请求失败', { provider });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readErrorBody(res: Response): Promise<{ text: string; payload: unknown }> {
  const text = await res.text().catch(() => '');
  try {
    return { text, payload: text ? JSON.parse(text) : null };
  } catch {
    return { text, payload: null };
  }
}

function httpError(status: number, payload: unknown, provider: ApiProvider, prefix = ''): AppError {
  const explained = explainDeepSeek(status, payload, provider);
  return new AppError('deepseek', `${prefix}${explained.title}`, {
    status,
    provider,
    raw: (payload as { error?: { message?: string } } | null)?.error?.message ?? undefined,
  });
}

function parseSseChunk(raw: string): { text: string; usage?: TokenUsage; finish?: string } | null {
  const lines = raw.split('\n').filter((l) => l.startsWith('data:'));
  if (!lines.length) return null;
  let text = '';
  let usage: TokenUsage | undefined;
  let finish: string | undefined;
  for (const line of lines) {
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload) as {
        choices?: { delta?: { content?: string }; finish_reason?: string }[];
        usage?: TokenUsage | null;
      };
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) text += delta;
      const fr = json.choices?.[0]?.finish_reason;
      if (fr) finish = fr;
      if (json.usage) usage = json.usage;
    } catch {
      // 单行解析失败不影响整体
    }
  }
  return { text, usage, finish };
}

export async function chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  const provider = opts.provider ?? 'deepseek';
  if (!opts.apiKey && provider === 'deepseek') {
    throw new AppError('deepseek', '尚未填写 DeepSeek API Key', { provider });
  }
  const baseUrl = opts.baseUrl ? normalizeBaseUrl(opts.baseUrl) : DEEPSEEK_BASE;
  if (provider === 'custom' && !baseUrl) {
    throw new AppError('deepseek', '尚未填写自定义 API 的 Base URL', { provider });
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: opts.maxTokens ?? 8000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  if (provider === 'deepseek') {
    body.thinking = { type: opts.thinking ? 'enabled' : 'disabled' };
    if (!opts.thinking) body.temperature = opts.temperature ?? 0.8;
    if (opts.thinking) body.reasoning_effort = 'high';
  } else if (opts.temperature !== undefined) {
    // 自定义接口不发送 DeepSeek 的思考参数；只透传调用方明确要求的温度
    body.temperature = opts.temperature;
  }

  const send = (payload: Record<string, unknown>) =>
    post('/chat/completions', opts.apiKey, payload, opts.signal, opts.timeoutMs, baseUrl, provider);

  let res = await send(body);
  if (!res.ok && provider === 'custom' && res.status === 400) {
    const { text, payload } = await readErrorBody(res);
    const lower = text.toLowerCase();
    const next = { ...body };
    let changed = false;
    // 不同 OpenAI 兼容服务的可选参数支持不一：只在 400 时按错误原文剥掉对应字段重试一次。
    // 400 表示请求没有被执行，重试不会产生额外计费。
    if (next.response_format && /response_format|json_object|json mode/.test(lower)) {
      delete next.response_format;
      changed = true;
    }
    if (next.stream_options && /stream_options|include_usage/.test(lower)) {
      delete next.stream_options;
      changed = true;
    }
    if (!changed) throw httpError(400, payload, provider);
    res = await send(next);
  }
  if (!res.ok) {
    const { payload } = await readErrorBody(res);
    throw httpError(res.status, payload, provider);
  }
  if (!res.body) throw new AppError('deepseek', '响应没有可读取的流', { provider });

  // 少数兼容服务忽略 stream:true，直接返回一整块 JSON；这里兼容这种回包。
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: TokenUsage | null;
    } | null;
    const text = json?.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new AppError('parse', '模型返回了空内容，请重试本阶段');
    return {
      content: text,
      usage: json?.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
      finishReason: json?.choices?.[0]?.finish_reason ?? 'stop',
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let finish = 'stop';
  for (;;) {
    // post() 的超时只覆盖到拿到响应头为止；进入流式读取后必须自己盯着心跳，
    // 否则网络半途卡死会一直挂着不退，用户既看不到进度也拿不到错误。
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      idleTimer = setTimeout(() => {
        reject(
          new AppError(
            'deepseek',
            `流式响应中断：连续 ${Math.round(STREAM_IDLE_TIMEOUT / 1000)} 秒没有收到新数据，请检查网络后重试本阶段`,
            { provider },
          ),
        );
      }, STREAM_IDLE_TIMEOUT);
    });

    let read: ReadableStreamReadResult<Uint8Array>;
    try {
      read = await Promise.race([reader.read(), idle]);
    } catch (err) {
      // 卡死时主动取消底层流，避免连接残留
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }

    const { value, done } = read;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const parsed = parseSseChunk(chunk);
      if (parsed) {
        if (parsed.text) {
          content += parsed.text;
          opts.onDelta?.(parsed.text);
        }
        if (parsed.usage) usage = parsed.usage;
        if (parsed.finish) finish = parsed.finish;
      }
      split = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) {
    const parsed = parseSseChunk(buffer);
    if (parsed) {
      if (parsed.text) {
        content += parsed.text;
        opts.onDelta?.(parsed.text);
      }
      if (parsed.usage) usage = parsed.usage;
      if (parsed.finish) finish = parsed.finish;
    }
  }
  if (!content.trim()) {
    throw new AppError('parse', '模型返回了空内容（JSON 模式偶发），请重试本阶段');
  }
  return { content, usage, finishReason: finish };
}

/** 从可能带 ```json 包装的文本里取出 JSON */
export function extractJson<T>(raw: string): T {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AppError('parse', '返回内容里找不到 JSON 对象');
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch (err) {
    throw new AppError('parse', `JSON 解析失败：${(err as Error).message}`);
  }
}

export interface SearchHit {
  title: string;
  url: string;
  summary: string;
  siteName?: string | null;
  authority?: number;
}

/** 官方 Search 工具（api.deepseek.com/v1/tools/search），按成功请求计费；自定义接口不提供 */
export async function searchWeb(apiKey: string, query: string, count = 6): Promise<SearchHit[]> {
  const res = await post('/v1/tools/search', apiKey, { query, count, need_content: false }, undefined, 60_000);
  if (!res.ok) {
    const { payload } = await readErrorBody(res);
    const explained = explainDeepSeek(res.status, payload);
    throw new AppError('deepseek', `联网检索失败：${explained.title}`, {
      status: res.status,
      raw: (payload as { error?: { message?: string } } | null)?.error?.message,
    });
  }
  const json = (await res.json()) as { results?: SearchHit[] };
  return json.results ?? [];
}

export interface KeyCheck {
  ok: boolean;
  detail: string;
  models: string[];
  /** 已在浏览器拿到真实响应（用于区分 CORS 与凭证问题） */
  reachable: boolean;
  latencyMs: number;
}

export interface VerifyOptions {
  provider?: ApiProvider;
  baseUrl?: string;
  model?: string;
}

/** 验证接口：直接发一个最小请求，读得回 401/200 即说明浏览器直连可用 */
export async function verifyKey(apiKey: string, opts: VerifyOptions = {}): Promise<KeyCheck> {
  const provider = opts.provider ?? 'deepseek';
  const baseUrl = provider === 'custom' ? normalizeBaseUrl(opts.baseUrl ?? '') : DEEPSEEK_BASE;
  const model = provider === 'custom' ? (opts.model ?? '').trim() : 'deepseek-flash';
  const started = performance.now();
  const fail = (detail: string, reachable = false): KeyCheck => ({
    ok: false,
    detail,
    models: [],
    reachable,
    latencyMs: Math.round(performance.now() - started),
  });

  if (provider === 'custom') {
    if (!baseUrl) return fail('先填写 Base URL。');
    if (!/^https?:\/\//i.test(baseUrl)) return fail('Base URL 需要以 http:// 或 https:// 开头。');
    if (!model) return fail('先填写模型名。');
  } else if (!apiKey) {
    return fail('先填写 API Key。');
  }

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false,
  };
  if (provider === 'deepseek') body.thinking = { type: 'disabled' };

  try {
    const res = await post('/chat/completions', apiKey, body, undefined, 30_000, baseUrl, provider);
    const latencyMs = Math.round(performance.now() - started);
    if (res.ok) {
      return {
        ok: true,
        detail:
          provider === 'custom'
            ? `连接正常，${model} 已返回响应（浏览器可直连）`
            : '连接正常，浏览器可直连 DeepSeek',
        models: provider === 'custom' ? [model] : MODELS.map((m) => m.id),
        reachable: true,
        latencyMs,
      };
    }
    const { payload } = await readErrorBody(res);
    const explained = explainDeepSeek(res.status, payload, provider);
    return {
      ok: false,
      detail: `${explained.title}：${explained.detail}`,
      models: [],
      reachable: true,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const hint =
      provider === 'custom'
        ? '请检查 Base URL、服务是否启动，以及服务端是否允许当前页面跨域（CORS）。'
        : '请检查网络或代理设置。';
    return {
      ok: false,
      detail: `未能读取响应：${(err as Error).message}。${hint}`,
      models: [],
      reachable: false,
      latencyMs,
    };
  }
}
