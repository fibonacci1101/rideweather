import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from './index';
import { createFakeCache, createFakeExecutionCtx, makeTestEnv } from './lib/testFakes';

const ORIGIN = 'https://ride-weather-app.example.workers.dev';

const SECURITY_HEADER_EXPECTATIONS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), camera=(), microphone=()',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

function expectSecurityHeaders(res: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADER_EXPECTATIONS)) {
    expect(res.headers.get(name)).toBe(value);
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('セキュリティヘッダーの付与', () => {
  it('存在しないパス(Honoの既定404)にもセキュリティヘッダーが付与される', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const res = await app.request(`${ORIGIN}/api/nonexistent`, {}, makeTestEnv(), createFakeExecutionCtx());

    expect(res.status).toBe(404);
    expectSecurityHeaders(res);
  });

  it('originチェックで弾かれた403レスポンスにもセキュリティヘッダーが付与される', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const res = await app.request(
      `${ORIGIN}/api/route/123`,
      { headers: { origin: 'https://evil.example.com' } },
      makeTestEnv(),
      createFakeExecutionCtx()
    );

    expect(res.status).toBe(403);
    expectSecurityHeaders(res);
  });
});

describe('Origin/Refererチェックミドルウェア(/api/*)', () => {
  // いずれも/api/route/abc(数字以外のid)を叩き、通過すればroute.ts側の
  // 「400 invalid route id」に、弾かれれば「403 forbidden」になる。この違いで
  // ミドルウェアの通過可否を判定できるため、caches/fetchのモックが不要で済む

  it('OriginもRefererも無い場合は許可する(判定不能時は正規ユーザーを誤って弾かない設計)', async () => {
    const res = await app.request(`${ORIGIN}/api/route/abc`, {}, makeTestEnv(), createFakeExecutionCtx());
    expect(res.status).toBe(400); // route.ts側まで到達している = 通過した証拠
  });

  it('Originがリクエスト自身のoriginと一致すれば許可する', async () => {
    const res = await app.request(
      `${ORIGIN}/api/route/abc`,
      { headers: { origin: ORIGIN } },
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(400);
  });

  it('Originが一致しなければ403を返す', async () => {
    const res = await app.request(
      `${ORIGIN}/api/route/abc`,
      { headers: { origin: 'https://evil.example.com' } },
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('Origin未指定・Refererが一致すれば許可する(Refererへのフォールバック)', async () => {
    const res = await app.request(
      `${ORIGIN}/api/route/abc`,
      { headers: { referer: `${ORIGIN}/some/page` } },
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(400);
  });

  it('Origin未指定・Refererが一致しなければ403を返す', async () => {
    const res = await app.request(
      `${ORIGIN}/api/route/abc`,
      { headers: { referer: 'https://evil.example.com/some/page' } },
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(403);
  });

  it('Refererが不正なURL文字列の場合も403を返す(URLパース失敗時のcatch分岐)', async () => {
    const res = await app.request(
      `${ORIGIN}/api/route/abc`,
      { headers: { referer: 'not a valid url ::: %%%' } },
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(403);
  });

  it('/api/以外のパスにはOriginチェックが適用されない', async () => {
    // ルーティング自体は存在しないため404になるが、403(forbidden)にはならないことを確認する
    const res = await app.request(
      `${ORIGIN}/not-an-api-path`,
      { headers: { origin: 'https://evil.example.com' } },
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(404);
  });
});

describe('onError(未捕捉例外のセーフティネット)', () => {
  it('下流ハンドラの未捕捉例外を捕まえ、セキュリティヘッダー付きの汎用500を返す', async () => {
    // route.ts自身のtry/catchは上流fetch・JSONパースの失敗を全て捕まえるため、意図的な
    // 未捕捉例外を再現するには正常系まで到達させた上でexecutionCtx.waitUntil自体を
    // 同期的に例外を投げるフェイクに差し替える(index.tsのコメントが説明する
    // 「下流ハンドラの未捕捉例外はミドルウェアチェーンを素通りする」経路を実際に検証する)
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ route: { id: 1, track_points: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const throwingCtx = createFakeExecutionCtx({ waitUntilThrows: true });

    const res = await app.request(`${ORIGIN}/api/route/123`, {}, makeTestEnv(), throwingCtx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal server error' });
    expectSecurityHeaders(res);
  });
});
