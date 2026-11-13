/* MaiMemo Reader Service Worker
 * 只缓存应用自身的静态资源；任何带 Authorization 的请求、跨域 API 响应都不进入缓存。
 * 版本号变更后，旧缓存会在 activate 阶段清理。
 */
const VERSION = 'v1.0.1';
const SHELL_CACHE = `memo-reader-shell-${VERSION}`;
const ASSET_CACHE = `memo-reader-assets-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            /* 单个资源失败不影响安装 */
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('memo-reader-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isApiRequest(url) {
  return /(^|\.)deepseek\.com$|(^|\.)maimemo\.com$|(^|\.)workers\.dev$/.test(url.hostname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 跨域、API、带凭证头的请求：一律直连，不缓存，避免把学习数据留在 Cache Storage
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;
  if (request.headers.get('authorization')) return;

  // 导航请求：网络优先，离线回落到 shell
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        }
      })(),
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })(),
  );
});
