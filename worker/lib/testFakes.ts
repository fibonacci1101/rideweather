import { vi } from 'vitest';

// worker/配下のテストは(worker/lib/rateLimit.test.ts等の既存テスト同様)vitest.config.tsの
// 既定環境(jsdom)で動く。jsdomはCloudflare WorkersのCache API(`caches.default`)や
// ExecutionContextを提供しないため、route.ts/weather.ts/index.tsをHonoの`app.request()`で
// 実際に動かすテストにはこれらの簡易フェイクが必要になる。本物のworkerdランタイムを使う
// @cloudflare/vitest-pool-workers の導入は設定コストが大きいため見送り、Honoがランタイム
// 非依存であることを利用してフェイクで代替する方針を採った

/** caches.default(Cache API)の簡易フェイク。URLをキーにしたインメモリMap実装 */
export function createFakeCache() {
  const store = new Map<string, Response>();
  return {
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      const cached = store.get(key);
      return cached ? cached.clone() : undefined;
    }),
    put: vi.fn(async (req: Request | string, res: Response) => {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, res.clone());
    }),
  };
}

/**
 * ExecutionContext.waitUntilの簡易フェイク。実装コードは`waitUntil(cache.put(...))`のように
 * fire-and-forgetで呼ぶため、テスト側でその完了を待てるよう渡したPromiseを`pending`に集める。
 * `waitUntilThrows: true`にすると、waitUntil自体が同期的に例外を投げる(index.tsのonError
 * ハンドラが未捕捉例外を正しく処理できるかを検証するための注入ポイント)
 */
export function createFakeExecutionCtx(options: { waitUntilThrows?: boolean } = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    pending,
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      if (options.waitUntilThrows) throw new Error('waitUntil failed (test-injected)');
      pending.push(promise);
    }),
    passThroughOnException: vi.fn(),
    props: {},
  };
  return ctx as unknown as ExecutionContext & { pending: Promise<unknown>[] };
}

/** 常に許可/拒否するレート制限フェイク */
export function makeLimiter(success: boolean): RateLimit {
  return { limit: vi.fn(async () => ({ success })) } as unknown as RateLimit;
}

/** テスト用のダミーEnv(未使用のキー/bindingにはプレースホルダーを入れる) */
export function makeTestEnv(overrides: Partial<{
  RWGPS_API_KEY: string;
  OWM_API_KEY: string;
  ROUTE_RATE_LIMITER: RateLimit;
  WEATHER_RATE_LIMITER: RateLimit;
}> = {}) {
  return {
    RWGPS_API_KEY: 'test-rwgps-key',
    OWM_API_KEY: 'test-owm-key',
    ROUTE_RATE_LIMITER: makeLimiter(true),
    WEATHER_RATE_LIMITER: makeLimiter(true),
    ...overrides,
  };
}
