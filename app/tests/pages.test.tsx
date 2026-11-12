import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AppProvider } from '../src/state/store';
import { idb, kv } from '../src/lib/db';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { DEMO_ARTICLE, DEMO_QUESTIONS, DEMO_SNAPSHOT } from '../src/ai/demo';
import type { Article, Question } from '../src/types';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const articleId = 'test-article';

async function seed() {
  await kv.set('settings', { ...DEFAULT_SETTINGS, onboarded: true, accountId: 'local' });
  const now = Date.now();
  const article: Article = {
    ...DEMO_ARTICLE,
    id: articleId,
    taskId: 'task-test',
    accountId: 'local',
    sessionId: 's',
    date: DEMO_SNAPSHOT.date,
    exam: 'cet6',
    createdAt: now,
    favorite: true,
  };
  await idb.put('articles', articleId, article);
  await idb.put('articles', `${articleId}-2`, { ...article, id: `${articleId}-2`, title: 'Second Piece' });
  const questions: Question[] = DEMO_QUESTIONS.map((q, i) => ({
    ...q,
    id: `${articleId}-q${i + 1}`,
    articleId,
    index: i,
  }));
  for (const q of questions) await idb.put('questions', q.id, q);
}

async function renderAt(hash: string) {
  window.location.hash = hash;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppProvider>
        <App />
      </AppProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
  return container;
}

/** 等异步读数（设置 → 文章 → 题目）落地，避免用固定 sleep 赌时序 */
async function waitFor(check: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!check() && Date.now() - start < timeout) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
}

beforeEach(async () => {
  await seed();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  window.location.hash = '';
});

describe('页面渲染', () => {
  it('阅读器：标题、目标词高亮与点词面板', async () => {
    const el = await renderAt(`#/read/${articleId}`);
    await waitFor(() => el.querySelectorAll('.w--target').length > 0);
    expect(el.textContent).toContain(DEMO_ARTICLE.title);
    expect(el.querySelectorAll('.w--target').length).toBeGreaterThan(10);
    expect(el.textContent).toContain('本篇词汇');

    const target = el.querySelector('.w--target') as HTMLButtonElement;
    await act(async () => {
      target.click();
      await new Promise((r) => setTimeout(r, 60));
    });
    await waitFor(() => Boolean(el.querySelector('.sheet')));
    expect(el.querySelector('.sheet')).not.toBeNull();
    expect(el.querySelector('.sheet__meaning')?.textContent).toMatch(/(adj\.|n\.|v\.)/);
  });

  it('书架：列出文章并显示收藏与题型标签', async () => {
    const el = await renderAt('#/library');
    expect(el.textContent).toContain('读过的，都留在这里');
    expect(el.querySelectorAll('.lib__item').length).toBeGreaterThanOrEqual(2);
    expect(el.textContent).toContain('CET6');
  });

  it('设置页：默认打开墨墨分区，含连接测试与中继说明', async () => {
    const el = await renderAt('#/settings');
    expect(el.textContent).toContain('把钥匙放在自己手里');
    expect(el.textContent).toContain('个人 Token');
    expect(el.textContent).toContain('连接测试');
    expect(el.textContent).toContain('中继');
  });

  it('设置页：AI 接口可切到自定义 OpenAI 兼容服务', async () => {
    const el = await renderAt('#/settings');
    const nav = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('AI 接口'));
    expect(nav).toBeTruthy();
    await act(async () => {
      nav!.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const customTab = Array.from(el.querySelectorAll('.segmented__item')).find((b) =>
      b.textContent?.includes('自定义'),
    ) as HTMLButtonElement | undefined;
    expect(customTab).toBeTruthy();
    await act(async () => {
      customTab!.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(el.textContent).toContain('Base URL');
    expect(el.textContent).toContain('模型名');
    expect(el.textContent).toContain('验证连接');
    expect(el.textContent).toContain('OpenAI 兼容');
    expect(el.textContent).not.toContain('DeepSeek API Key');
  });

  it('答题页：未作答时不泄露答案，全部选完后可交卷', async () => {
    const el = await renderAt(`#/quiz/${articleId}`);
    await waitFor(() => el.querySelectorAll('.qcard').length > 0);
    const cards = el.querySelectorAll('.qcard');
    expect(cards.length).toBe(DEMO_QUESTIONS.length);
    expect(el.textContent).not.toContain('原文依据');
    expect(el.textContent).toContain('交卷前不显示答案');
  });
});
