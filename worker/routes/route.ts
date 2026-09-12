import { Hono } from 'hono';
import type { Env } from '../index';
import { checkRateLimit } from '../lib/rateLimit';

const app = new Hono<{ Bindings: Env }>();

// ルートは頻繁に変わらないため長めのTTL
const CACHE_TTL_SECONDS = 60 * 60 * 6;

/**
 * Ride with GPSのルートJSON(track_points含む)をプロキシする。
 * Workers側でAPIキーを付与し、Cache API(6h TTL)でレスポンスをキャッシュする。
 */
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^\d+$/.test(id)) {
    return c.json({ error: 'invalid route id' }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/api/route/${id}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await checkRateLimit(c.env.ROUTE_RATE_LIMITER, ip))) {
    console.warn('[rate-limit-exceeded]', { endpoint: 'route', ip, routeId: id });
    return c.json({ error: 'rate limit exceeded' }, 429);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`https://ridewithgps.com/routes/${id}.json?apikey=${c.env.RWGPS_API_KEY}`, {
      // 既定(follow)だとリダイレクト先にAPIキー付きURLがそのまま送られてしまうため、手動扱いにする
      redirect: 'manual',
    });
  } catch (err) {
    console.error('[upstream-error]', {
      endpoint: 'route',
      api: 'rwgps',
      reason: 'fetch-threw',
      message: err instanceof Error ? err.message : String(err),
      routeId: id,
      ip,
    });
    return c.json({ error: 'failed to reach route upstream' }, 502);
  }

  // redirect: 'manual' により、RWGPSが万一リダイレクト(3xx)を返した場合もここでそのステータスのまま弾かれる
  // (追従してAPIキー付きURLをリダイレクト先へ送ってしまうことがない)
  if (!upstream.ok) {
    console.error('[upstream-error]', {
      endpoint: 'route',
      api: 'rwgps',
      status: upstream.status,
      routeId: id,
      ip,
    });
    return new Response(
      JSON.stringify({ error: `failed to fetch route (status ${upstream.status})` }),
      { status: upstream.status, headers: { 'content-type': 'application/json' } }
    );
  }

  const body = await upstream.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    console.error('[upstream-error]', {
      endpoint: 'route',
      api: 'rwgps',
      reason: 'invalid-json',
      routeId: id,
      ip,
    });
    return c.json({ error: 'upstream returned an invalid response' }, 502);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('route' in parsed) ||
    typeof (parsed as { route?: unknown }).route !== 'object'
  ) {
    console.error('[upstream-error]', {
      endpoint: 'route',
      api: 'rwgps',
      reason: 'unexpected-shape',
      routeId: id,
      ip,
    });
    return c.json({ error: 'upstream returned an unexpected response' }, 502);
  }

  const response = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });

  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

export default app;
