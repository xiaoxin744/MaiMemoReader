import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AppProvider } from '../src/state/store';
import { kv } from '../src/lib/db';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { runPipeline } from '../src/ai/pipeline';
import { DEMO_SNAPSHOT } from '../src/ai/demo';
import type { GenerationTask } from '../src/types';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  // 等待 AppProvider 从 IndexedDB 读取设置
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('应用外壳', () => {
  it('首次打开显示引导，而不是空白页', async () => {
    await kv.set('settings', { ...DEFAULT_SETTINGS, onboarded: false, deepseekKey: '', maimemoToken: '' });
    const el = await render(
      <AppProvider>
        <App />
      </AppProvider>,
    );
    expect(el.textContent).toContain('MaiMemo Reader');
    expect(el.textContent).toContain('先看今天背了哪些词');
    expect(el.querySelector('.onboarding__card')).not.toBeNull();
  });

  it('已完成引导后落到首页，并给出生成入口', async () => {
    await kv.set('settings', { ...DEFAULT_SETTINGS, onboarded: true, accountId: 'local' });
    const el = await render(
      <AppProvider>
        <App />
      </AppProvider>,
    );
    expect(el.textContent).toContain('今天读点什么');
    expect(el.textContent).toContain('生成今日精读');
  });
});

function sseResponse(payload: unknown): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(payload) } }] })}\n\ndata: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 80, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100 },
  })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('生成管线（fetch 模拟）', () => {
  it('四个阶段依次完成，文章与题目落盘', async () => {
    const selection = {
      summary: '围绕注意力组织',
      picks: [
        { word: 'sustain', role: 'core', reason: '核心动词' },
        { word: 'subtle', role: 'support', reason: '修饰' },
      ],
      dropped: [],
      articles: [{ title: 'Attention', angle: '注意力经济', targetWords: ['sustain', 'subtle'] }],
      articleCount: 1,
    };
    const article = {
      title: 'Attention',
      paragraphs: [
        'Paragraph one about attention and how we sustain it over time. '.repeat(24),
        'Paragraph two adds more detail about subtle differences in focus. '.repeat(12),
        'Paragraph three concludes the discussion of sustained attention. '.repeat(6),
      ],
      translation: ['一', '二', '三'],
      words: [
        { word: 'sustain', surface: 'sustaining', meaning: '维持', inContext: 'sustaining attention' },
        { word: 'subtle', surface: 'subtle', meaning: '微妙的', inContext: 'subtle difference' },
      ],
    };
    const questions = {
      questions: [
        {
          type: 'detail',
          stem: 'What does the author say?',
          options: ['A1', 'B1', 'C1', 'D1'],
          answerIndex: 1,
          evidence: 'Paragraph one about attention and how we sustain it over time.',
          explanation: '解析'.repeat(30),
        },
      ],
    };
    const qa = { pass: true, notes: [], coverageIssues: [], questionIssues: [] };

    const queue = [selection, article, questions, qa];
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content: string }[] };
      calls.push(body.messages?.[0]?.content?.slice(0, 20) ?? '');
      const next = queue.shift() ?? qa;
      return sseResponse(next);
    });
    vi.stubGlobal('fetch', fetchMock);

    const now = Date.now();
    const task: GenerationTask = {
      id: `test-${now}`,
      accountId: 'local',
      date: DEMO_SNAPSHOT.date,
      exam: 'kaoyan1',
      createdAt: now,
      updatedAt: now,
      status: 'running',
      stage: 'snapshot',
      progress: 0,
      articleIndex: 0,
      totalArticles: 1,
      sessionId: 's1',
      options: {
        exam: 'kaoyan1',
        theme: '',
        length: 'medium',
        difficulty: 3,
        questionCount: 1,
        articleMode: 'single',
        continueSession: false,
        webSearch: false,
        model: 'deepseek-flash',
        thinking: false,
      },
      articles: [],
      questions: {},
    };

    const result = await runPipeline(
      {
        task,
        snapshot: DEMO_SNAPSHOT,
        target: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', model: 'deepseek-flash' },
        signal: new AbortController().signal,
        previousArticles: [],
      },
      { onProgress: () => undefined, onTask: () => undefined },
    );

    expect(calls).toHaveLength(4);
    expect(result.status).toBe('complete');
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].title).toBe('Attention');
    expect(result.questions[result.articles[0].id]).toHaveLength(1);
    expect(result.usage?.calls).toBe(4);
    expect(result.usage?.costCny).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('正文阶段失败后保留选词方案，可只重跑正文', async () => {
    const selection = {
      summary: 'x',
      picks: [{ word: 'sustain', role: 'core', reason: 'x' }],
      dropped: [],
      articles: [{ title: 'T', angle: 'a', targetWords: ['sustain'] }],
      articleCount: 1,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(selection))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const now = Date.now();
    const task: GenerationTask = {
      id: `test-fail-${now}`,
      accountId: 'local',
      date: DEMO_SNAPSHOT.date,
      exam: 'cet6',
      createdAt: now,
      updatedAt: now,
      status: 'running',
      stage: 'snapshot',
      progress: 0,
      articleIndex: 0,
      totalArticles: 1,
      sessionId: 's2',
      options: {
        exam: 'cet6',
        theme: '',
        length: 'medium',
        difficulty: 3,
        questionCount: 4,
        articleMode: 'single',
        continueSession: false,
        webSearch: false,
        model: 'deepseek-flash',
        thinking: false,
      },
      articles: [],
      questions: {},
    };

    await expect(
      runPipeline(
        {
          task,
          snapshot: DEMO_SNAPSHOT,
          target: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', model: 'deepseek-flash' },
          signal: new AbortController().signal,
          previousArticles: [],
        },
        { onProgress: () => undefined, onTask: () => undefined },
      ),
    ).rejects.toBeTruthy();

    expect(task.status).toBe('failed');
    expect(task.plan?.picks[0].word).toBe('sustain');
    expect(task.articles).toHaveLength(0);
    expect(task.error).toContain('DeepSeek');
    vi.unstubAllGlobals();
  });

  it('自定义接口：全部请求发往自填地址，费用标记为未知', async () => {
    const selection = {
      summary: '围绕注意力组织',
      picks: [
        { word: 'sustain', role: 'core', reason: '核心动词' },
        { word: 'subtle', role: 'support', reason: '修饰' },
      ],
      dropped: [],
      articles: [{ title: 'Attention', angle: '注意力经济', targetWords: ['sustain', 'subtle'] }],
      articleCount: 1,
    };
    const article = {
      title: 'Attention',
      paragraphs: [
        'Paragraph one about attention and how we sustain it over time. '.repeat(24),
        'Paragraph two adds more detail about subtle differences in focus. '.repeat(12),
        'Paragraph three concludes the discussion of sustained attention. '.repeat(6),
      ],
      translation: ['一', '二', '三'],
      words: [
        { word: 'sustain', surface: 'sustaining', meaning: '维持', inContext: 'sustaining attention' },
        { word: 'subtle', surface: 'subtle', meaning: '微妙的', inContext: 'subtle difference' },
      ],
    };
    const questions = {
      questions: [
        {
          type: 'detail',
          stem: 'What does the author say?',
          options: ['A1', 'B1', 'C1', 'D1'],
          answerIndex: 1,
          evidence: 'Paragraph one about attention and how we sustain it over time.',
          explanation: '解析'.repeat(30),
        },
      ],
    };
    const qa = { pass: true, notes: [], coverageIssues: [], questionIssues: [] };
    const queue = [selection, article, questions, qa];
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        });
        return sseResponse(queue.shift() ?? qa);
      }),
    );

    const now = Date.now();
    const task: GenerationTask = {
      id: `test-custom-${now}`,
      accountId: 'local',
      date: DEMO_SNAPSHOT.date,
      exam: 'cet6',
      createdAt: now,
      updatedAt: now,
      status: 'running',
      stage: 'snapshot',
      progress: 0,
      articleIndex: 0,
      totalArticles: 1,
      sessionId: 's3',
      options: {
        exam: 'cet6',
        theme: '',
        length: 'medium',
        difficulty: 3,
        questionCount: 1,
        articleMode: 'single',
        continueSession: false,
        webSearch: true,
        model: 'qwen-plus',
        thinking: true,
        apiProvider: 'custom',
      },
      articles: [],
      questions: {},
    };

    const result = await runPipeline(
      {
        task,
        snapshot: DEMO_SNAPSHOT,
        target: {
          provider: 'custom',
          baseUrl: 'https://llm.example.com/v1',
          apiKey: '',
          model: 'qwen-plus',
        },
        signal: new AbortController().signal,
        previousArticles: [],
      },
      { onProgress: () => undefined, onTask: () => undefined },
    );

    expect(result.status).toBe('complete');
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => r.url === 'https://llm.example.com/v1/chat/completions')).toBe(true);
    expect(requests.every((r) => r.body.model === 'qwen-plus')).toBe(true);
    expect(requests.every((r) => r.body.thinking === undefined)).toBe(true);
    expect(requests.every((r) => r.body.reasoning_effort === undefined)).toBe(true);
    expect(result.usage?.costKnown).toBe(false);
    expect(result.usage?.costCny).toBe(0);
    vi.unstubAllGlobals();
  });
});
