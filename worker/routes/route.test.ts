import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import route from './route';
import { createFakeCache, createFakeExecutionCtx, makeLimiter, makeTestEnv } from '../lib/testFakes';

const BASE_URL = 'https://ride-weather-app.example.workers.dev';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/route/:id', () => {
  it('数字以外のルートIDは400を返し、fetchを一切呼ばない', async () => {
    const cache = createFakeCache();
    vi.stubGlobal('caches', { default: cache });
    const env = makeTestEnv();

    const res = await route.request(`${BASE_URL}/abc`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid route id' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('キャッシュヒット時はfetchを呼ばずキャッシュ内容をそのまま返す', async () => {
    const cache = createFakeCache();
    vi.stubGlobal('caches', { default: cache });
    const cacheKey = 'https://cache.internal/api/route/123';
    await cache.put(cacheKey, jsonResponse({ route: { id: 123, track_points: [] } }));

    const env = makeTestEnv();
    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ route: { id: 123, track_points: [] } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('レート制限超過時は429を返し、fetchを呼ばない', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const env = makeTestEnv({ ROUTE_RATE_LIMITER: makeLimiter(false) });

    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate limit exceeded' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('上流fetchが例外を投げた場合は502を返す(fetch-threw経路)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockRejectedValue(new TypeError('network error'));
    const env = makeTestEnv();

    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'failed to reach route upstream' });
  });

  it('上流fetchがError以外の値をreject理由にした場合も502を返す(String(err)フォールバック経路)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockRejectedValue('connection reset'); // Errorインスタンスでない拒否理由
    const env = makeTestEnv();

    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(502);
  });

  it('上流が非OK(例: 404)を返した場合はそのステータスのまま転送する', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(new Response('not found', { status: 404 }));
    const env = makeTestEnv();

    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'failed to fetch route (status 404)' });
  });

  it('リダイレクトを追従せず手動扱いにする(APIキー付きURLがリダイレクト先に漏れないための防御)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    // redirect:'manual'時、実際のfetchはstatus 0/type opaqueredirectを返すが、
    // ここではモックなのでstatus 302(2xx範囲外=okがfalse)で代用し、失敗として扱われることを確認する
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 302 }));
    const env = makeTestEnv();

    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(302);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/routes/123.json'),
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('上流のJSONが不正な場合は502を返す(invalid-json経路)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(new Response('not valid json{{{', { status: 200 }));
    const env = makeTestEnv();

    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream returned an invalid response' });
  });

  it('上流のJSON形状が想定と異なる場合は502を返す(unexpected-shape経路)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ notRoute: true }));
    const env = makeTestEnv();

    const res = await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream returned an unexpected response' });
  });

  it('正常系: 200・Cache-Controlヘッダー付与・キャッシュへの保存が行われる', async () => {
    const cache = createFakeCache();
    vi.stubGlobal('caches', { default: cache });
    const routeBody = { route: { id: 123, track_points: [{ x: 135, y: 35 }] } };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(routeBody));
    const env = makeTestEnv();
    const ctx = createFakeExecutionCtx();

    const res = await route.request(`${BASE_URL}/123`, {}, env, ctx);
    await Promise.all(ctx.pending);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    expect(await res.clone().json()).toEqual(routeBody);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('RWGPS_API_KEYがfetchのクエリパラメータに含まれる(サーバー側で付与している検証)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ route: { id: 1, track_points: [] } }));
    const env = makeTestEnv({ RWGPS_API_KEY: 'secret-key-123' });

    await route.request(`${BASE_URL}/123`, {}, env, createFakeExecutionCtx());

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('apikey=secret-key-123'),
      expect.anything()
    );
  });
});
