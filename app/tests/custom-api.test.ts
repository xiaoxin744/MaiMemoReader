import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiConfigError,
  apiTargetOf,
  chat,
  costOf,
  normalizeBaseUrl,
  verifyKey,
} from '../src/api/deepseek';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

const customSettings = {
  ...DEFAULT_SETTINGS,
  apiProvider: 'custom' as const,
  customApiBase: ' https://llm.example.com/v1/ ',
  customApiModel: ' qwen-plus ',
  customApiKey: ' sk-custom ',
};

function sseResponse(content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }): Response {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\n` +
    'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('自定义接口设置', () => {
  it('归一化 Base URL：去空格、去尾斜杠、剥掉完整请求路径', () => {
    expect(normalizeBaseUrl(' https://llm.example.com/v1/ ')).toBe('https://llm.example.com/v1');
    expect(normalizeBaseUrl('https://llm.example.com/v1/chat/completions')).toBe('https://llm.example.com/v1');
  });

  it('按服务商解析目标，并校验必填项', () => {
    const target = apiTargetOf(customSettings);
    expect(target).toEqual({
      provider: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'sk-custom',
      model: 'qwen-plus',
    });
    expect(apiConfigError(target)).toBeNull();
    expect(apiConfigError(apiTargetOf({ ...DEFAULT_SETTINGS, deepseekKey: 'sk-x' }))).toBeNull();
    expect(apiConfigError(apiTargetOf(DEFAULT_SETTINGS))).toContain('DeepSeek API Key');
    expect(apiConfigError(apiTargetOf({ ...customSettings, customApiBase: '' }))).toContain('Base URL');
    expect(apiConfigError(apiTargetOf({ ...customSettings, customApiBase: 'ftp://x' }))).toContain('http');
    expect(apiConfigError(apiTargetOf({ ...customSettings, customApiModel: '' }))).toContain('模型');
  });

  it('自定义接口允许本地服务不填 Key', () => {
    const target = apiTargetOf({ ...customSettings, customApiKey: '' });
    expect(target.apiKey).toBe('');
    expect(apiConfigError(target)).toBeNull();
  });
});

describe('OpenAI 兼容客户端', () => {
  it('请求发往自填地址，且不发送 DeepSeek 专有参数', async () => {
    const seen: { url: string; body: Record<string, unknown>; auth?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        seen.push({
          url: String(url),
          body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
          auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
        });
        return sseResponse('hello');
      }),
    );

    const result = await chat([{ role: 'user', content: 'hi' }], {
      apiKey: 'sk-custom',
      model: 'qwen-plus',
      provider: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      json: true,
      thinking: true,
    });

    expect(result.content).toBe('hello');
    expect(seen[0].url).toBe('https://llm.example.com/v1/chat/completions');
    expect(seen[0].auth).toBe('Bearer sk-custom');
    expect(seen[0].body.model).toBe('qwen-plus');
    expect(seen[0].body.response_format).toEqual({ type: 'json_object' });
    expect(seen[0].body.thinking).toBeUndefined();
    expect(seen[0].body.reasoning_effort).toBeUndefined();
    expect(seen[0].body.temperature).toBeUndefined();
  });

  it('兼容不支持 SSE 的服务：整包 JSON 回包也能读', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        }),
      ),
    );

    const result = await chat([{ role: 'user', content: 'hi' }], {
      apiKey: '',
      model: 'local-model',
      provider: 'custom',
      baseUrl: 'http://localhost:11434/v1',
      json: true,
    });

    expect(result.content).toBe('{"ok":true}');
    expect(result.usage.completion_tokens).toBe(3);
  });

  it('400 指出不支持 response_format 时，剥掉该字段重试一次', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return jsonResponse({ error: { message: 'response_format is not supported' } }, 400);
      })
      .mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return sseResponse('{"ok":true}');
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await chat([{ role: 'user', content: 'hi' }], {
      apiKey: '',
      model: 'local-model',
      provider: 'custom',
      baseUrl: 'http://localhost:11434/v1',
      json: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0].response_format).toBeTruthy();
    expect(bodies[1].response_format).toBeUndefined();
    expect(result.content).toBe('{"ok":true}');
  });

  it('400 与可选参数无关时不盲目重试', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'model not found' } }, 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      chat([{ role: 'user', content: 'hi' }], {
        apiKey: '',
        model: 'missing',
        provider: 'custom',
        baseUrl: 'http://localhost:11434/v1',
        json: true,
      }),
    ).rejects.toThrow(/请求参数不被接受|参数错误|not found/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('验证自定义接口：成功时返回模型名，缺模型不发请求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'pong' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const ok = await verifyKey('', {
      provider: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      model: 'qwen-plus',
    });
    expect(ok.ok).toBe(true);
    expect(ok.reachable).toBe(true);
    expect(ok.models).toEqual(['qwen-plus']);

    const missing = await verifyKey('', {
      provider: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      model: '',
    });
    expect(missing.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('自定义接口不按 DeepSeek 价格估算费用', () => {
    expect(costOf('qwen-plus', { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, 3, 'custom')).toBe(0);
    expect(costOf('deepseek-flash', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeGreaterThan(0);
  });
});
