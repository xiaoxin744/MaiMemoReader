/** 极简 hash 路由：GitHub Pages 子路径与 PWA 独立窗口下都不需要服务端回退配置。 */
import { useEffect, useState } from 'react';

export interface Route {
  name: 'home' | 'generate' | 'read' | 'quiz' | 'result' | 'library' | 'settings' | 'onboarding' | 'auth';
  param?: string;
  query: URLSearchParams;
  raw: string;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, search] = raw.split('?');
  const query = new URLSearchParams(search ?? '');
  const [head, param] = path.split('/');
  switch (head) {
    case 'generate':
      return { name: 'generate', query, raw };
    case 'read':
      return { name: 'read', param, query, raw };
    case 'quiz':
      return { name: 'quiz', param, query, raw };
    case 'result':
      return { name: 'result', param, query, raw };
    case 'library':
      return { name: 'library', query, raw };
    case 'settings':
      return { name: 'settings', query, raw };
    case 'onboarding':
      return { name: 'onboarding', query, raw };
    case 'auth':
      return { name: 'auth', query, raw };
    default:
      return { name: 'home', query, raw };
  }
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = `#/${to.replace(/^#?\/?/, '')}`;
  if (opts.replace) {
    const url = new URL(window.location.href);
    url.hash = target.slice(1);
    window.history.replaceState(null, '', url.toString());
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = target.slice(1);
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
