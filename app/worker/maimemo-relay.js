/**
 * 墨墨开放 API 中继（Cloudflare Worker，可选组件）
 *
 * 只在浏览器直连失败时使用。职责非常窄：
 *   1. 只转发 /maimemo/api/v1/memo/** 这一小段只读接口；
 *   2. 原样透传 Authorization 与请求体，不解析、不记录、不缓存；
 *   3. 给响应补上 CORS 头，让浏览器能读到错误码（墨墨的错误响应本身不带跨域头）。
 *
 * 部署：
 *   npm i -g wrangler
 *   wrangler deploy worker/maimemo-relay.js --name memo-relay
 *   wrangler secret put ALLOWED_ORIGIN   # 例如 https://yourname.github.io
 *
 * 前端：设置 → 墨墨背单词 → 中继地址填 https://memo-relay.<account>.workers.dev
 */

const UPSTREAM = 'https://open.maimemo.com/open';
const ALLOWED_PREFIX = '/api/v1/memo/';

function corsHeaders(origin, allowed) {
  const allow = allowed && allowed !== '*' ? allowed : origin || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = env.ALLOWED_ORIGIN ?? '*';
    const origin = request.headers.get('Origin') ?? '';

    // 只允许白名单来源，避免变成公开代理
    if (allowed !== '*' && origin && origin !== allowed) {
      return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    // 必须 /maimemo 前缀，剥离后只接受学习数据相关路径
    if (!url.pathname.startsWith('/maimemo')) {
      return new Response(JSON.stringify({ error: 'bad_gateway_path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }
    const path = url.pathname.slice('/maimemo'.length);
    if (!path.startsWith(ALLOWED_PREFIX)) {
      return new Response(JSON.stringify({ error: 'path_not_allowed', path }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'missing_token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    const upstreamUrl = `${UPSTREAM}${path}${url.search}`;
    const init = {
      method: request.method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: request.method === 'POST' ? await request.text() : undefined,
    };

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, init);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'upstream_unreachable', detail: String(err) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
        ...corsHeaders(origin, allowed),
      },
    });
  },
};
