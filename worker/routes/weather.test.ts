import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import weather, { parseTimestampParam } from './weather';
import { createFakeCache, createFakeExecutionCtx, makeLimiter, makeTestEnv } from '../lib/testFakes';
import type { OwmForecastEntry } from '../lib/forecast';

describe('parseTimestampParam', () => {
  const now = new Date('2026-08-15T00:00:00.000Z');

  it('Z終端のISO 8601文字列を正しくepoch秒に変換する', () => {
    expect(parseTimestampParam('2026-08-15T21:00:00.000Z', now)).toBe(
      Date.UTC(2026, 7, 15, 21) / 1000
    );
  });

  it('ミリ秒なしのZ終端文字列も受け付ける', () => {
    expect(parseTimestampParam('2026-08-15T21:00:00Z', now)).toBe(
      Date.UTC(2026, 7, 15, 21) / 1000
    );
  });

  // 本番で実際に発生したバグの再現防止テスト。クライアント(JST)が「06:00に出発」の
  // つもりでdate+time文字列を分割して送ると、Workers側でタイムゾーン指定なしの日時文字列が
  // ランタイムのローカルTZ(=UTC)として解釈され、9時間ズレた予報を返してしまっていた。
  // タイムゾーン指定のない文字列は必ず拒否することで、この経路自体を塞ぐ
  it('タイムゾーン指定のない日時文字列は拒否する(本番の9時間ズレバグの再発防止)', () => {
    expect(parseTimestampParam('2026-08-16T06:00:00', now)).toBeNull();
  });

  it('未定義・空文字は拒否する', () => {
    expect(parseTimestampParam(undefined, now)).toBeNull();
    expect(parseTimestampParam('', now)).toBeNull();
  });

  it('UTCオフセット表記(+09:00等)は拒否する(Zのみ許可)', () => {
    expect(parseTimestampParam('2026-08-16T06:00:00+09:00', now)).toBeNull();
  });

  it('日付だけ・不正な形式は拒否する', () => {
    expect(parseTimestampParam('2026-08-16', now)).toBeNull();
    expect(parseTimestampParam('not-a-date', now)).toBeNull();
  });

  it('過去すぎる・未来すぎるタイムスタンプは拒否する', () => {
    expect(parseTimestampParam('2026-08-13T00:00:00Z', now)).toBeNull(); // 2日以上前
    expect(parseTimestampParam('2026-08-25T00:00:00Z', now)).toBeNull(); // 6日を超える未来
  });

  it('サポート範囲内の過去1日・未来6日は許可する', () => {
    expect(parseTimestampParam('2026-08-14T01:00:00Z', now)).not.toBeNull();
    expect(parseTimestampParam('2026-08-20T23:00:00Z', now)).not.toBeNull();
  });
});

const BASE_URL = 'https://ride-weather-app.example.workers.dev';

// parseTimestampParamはルートハンドラ内でnow(実行時刻)を省略して呼ばれるため、ここでの
// targetTimestampは固定の過去日文字列ではなく実行時刻からの相対値にする(過去に
// InputForm.test.tsxで固定の過去日文字列が「今日より前」判定に引っかかって壊れた
// 教訓を踏まえた書き方)
function futureTimestamp(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

function makeOwmEntry(dt: number, overrides: Partial<OwmForecastEntry> = {}): OwmForecastEntry {
  return {
    dt,
    main: { temp: 25, feels_like: 26 },
    weather: [{ id: 800, main: 'Clear', description: '晴れ', icon: '01d' }],
    wind: { speed: 3, deg: 180 },
    pop: 0.1,
    ...overrides,
  };
}

function owmResponse(list: OwmForecastEntry[], city: unknown = { name: 'Test City', timezone: 32400 }) {
  return new Response(JSON.stringify({ list, city }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/weather', () => {
  it('lat/lonが無い場合は400を返し、fetchを一切呼ばない', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const res = await weather.request(
      `${BASE_URL}/?timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'lat and lon are required' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lat/lonが範囲外の場合は400を返す', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const res = await weather.request(
      `${BASE_URL}/?lat=999&lon=0&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'lat and lon must be valid coordinates' });
  });

  it('timestampが無い場合は400を返す', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const res = await weather.request(`${BASE_URL}/?lat=35&lon=135`, {}, makeTestEnv(), createFakeExecutionCtx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'timestamp is required' });
  });

  it('timestampが不正な形式の場合は400を返す', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=not-a-date`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('ISO 8601');
  });

  it('windowHoursが範囲外(上限48超)の場合は400を返す', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(futureTimestamp(1))}&windowHours=100`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(400);
  });

  it('キャッシュヒット時はfetchを呼ばずキャッシュ内容をそのまま返す', async () => {
    const cache = createFakeCache();
    vi.stubGlobal('caches', { default: cache });
    const ts = futureTimestamp(1);
    const targetSeconds = Math.floor(new Date(ts).getTime() / 1000);
    const bucketMinute = Math.floor(targetSeconds / 60);
    const cacheKey = `https://cache.internal/api/weather?lat=35.00&lon=135.00&bucket=${bucketMinute}&window=0`;
    await cache.put(cacheKey, new Response(JSON.stringify({ forecast: { dt: targetSeconds }, city: {} })));

    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(ts)}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('レート制限超過時は429を返す', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const env = makeTestEnv({ WEATHER_RATE_LIMITER: makeLimiter(false) });
    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      env,
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('上流が非OKの場合はそのステータスのまま転送する', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(new Response('error', { status: 503 }));
    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(503);
  });

  it('上流のJSONが不正な場合は502を返す(invalid-json経路)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(new Response('not json{{{', { status: 200 }));
    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream returned an invalid response' });
  });

  it('上流のlistが配列でない場合は502を返す(unexpected-shape経路)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(owmResponse(undefined as unknown as OwmForecastEntry[]));
    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream returned an unexpected response' });
  });

  it('対象時刻が予報データの範囲より先の場合は404を返す(forecast-not-found経路)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(owmResponse([]));
    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no forecast data found close to the requested date/time' });
  });

  it('正常系: 200・補間結果・Cache-Controlヘッダー・キャッシュ保存を確認する', async () => {
    const cache = createFakeCache();
    vi.stubGlobal('caches', { default: cache });
    const ts = futureTimestamp(1);
    // parseTimestampParamはミリ秒を切り捨てない(epoch秒に小数部が残る)ため、比較用の
    // 期待値もMath.floorせずそのまま使う(実際に一度Math.floorして比較しズレを発見した)
    const targetSeconds = new Date(ts).getTime() / 1000;
    const list = [makeOwmEntry(targetSeconds - 3600), makeOwmEntry(targetSeconds + 3600)];
    vi.mocked(fetch).mockResolvedValue(owmResponse(list));
    const ctx = createFakeExecutionCtx();

    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(ts)}`,
      {},
      makeTestEnv(),
      ctx
    );
    await Promise.all(ctx.pending);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.clone().json()) as { forecast: { dt: number }; nearby?: unknown };
    expect(body.forecast.dt).toBe(targetSeconds);
    expect(body.nearby).toBeUndefined(); // windowHours未指定なのでnearbyは含まれない
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('windowHours指定時はnearbyフィールドが含まれる', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const ts = futureTimestamp(1);
    const targetSeconds = Math.floor(new Date(ts).getTime() / 1000);
    const list = [
      makeOwmEntry(targetSeconds - 3600),
      makeOwmEntry(targetSeconds),
      makeOwmEntry(targetSeconds + 3600),
    ];
    vi.mocked(fetch).mockResolvedValue(owmResponse(list));

    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(ts)}&windowHours=2`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );

    const body = (await res.json()) as { nearby?: unknown[] };
    expect(body.nearby).toBeDefined();
    expect(Array.isArray(body.nearby)).toBe(true);
    expect((body.nearby as unknown[]).length).toBeGreaterThan(0);
  });

  it('逆ジオコーディングのlocal_names.jaをplaceNameとしてレスポンスに添える', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const ts = futureTimestamp(1);
    const targetSeconds = new Date(ts).getTime() / 1000;
    const list = [makeOwmEntry(targetSeconds - 3600), makeOwmEntry(targetSeconds + 3600)];
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/geo/1.0/reverse')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: 'Matsusaka', local_names: { ja: '松阪市' }, state: 'Mie', country: 'JP' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
      }
      return Promise.resolve(owmResponse(list, { name: 'Matsusaka', country: 'JP', timezone: 32400 }));
    });

    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(ts)}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { placeName?: string };
    expect(body.placeName).toBe('松阪市');
  });

  it('逆ジオコーディングが失敗しても天気レスポンス自体は200で返す(placeNameは省略)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    const ts = futureTimestamp(1);
    const targetSeconds = new Date(ts).getTime() / 1000;
    const list = [makeOwmEntry(targetSeconds - 3600), makeOwmEntry(targetSeconds + 3600)];
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/geo/1.0/reverse')) return Promise.reject(new Error('network down'));
      return Promise.resolve(owmResponse(list, { name: 'Kamiyamada', country: 'JP', timezone: 32400 }));
    });

    const res = await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(ts)}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { placeName?: string; forecast: unknown };
    expect(body.forecast).toBeDefined();
    expect(body.placeName).toBeUndefined();
  });

  it('逆ジオ結果は座標キーの専用キャッシュに保存され、別時刻の再リクエストでは再fetchしない(F-13)', async () => {
    const cache = createFakeCache();
    vi.stubGlobal('caches', { default: cache });
    let geoCalls = 0;
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/geo/1.0/reverse')) {
        geoCalls++;
        return Promise.resolve(
          new Response(JSON.stringify([{ local_names: { ja: '伊勢市' }, country: 'JP' }]), { status: 200 })
        );
      }
      // forecastは十分広い範囲のバケットを返し、どの未来時刻でも補間が成立するようにする
      return Promise.resolve(owmResponse([makeOwmEntry(0), makeOwmEntry(4_102_444_800)]));
    });

    const ctx1 = createFakeExecutionCtx();
    await weather.request(
      `${BASE_URL}/?lat=34.49&lon=136.71&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      makeTestEnv(),
      ctx1
    );
    await Promise.all(ctx1.pending); // geoキャッシュへのput完了を待つ

    // 別時刻(分バケットが変わる) → weather本体のキャッシュはミスするが、geoは座標キーでヒットするはず
    await weather.request(
      `${BASE_URL}/?lat=34.49&lon=136.71&timestamp=${encodeURIComponent(futureTimestamp(2))}`,
      {},
      makeTestEnv(),
      createFakeExecutionCtx()
    );

    expect(geoCalls).toBe(1);
  });

  it('OWM_API_KEYがfetchのクエリパラメータに含まれる(サーバー側で付与している検証)', async () => {
    vi.stubGlobal('caches', { default: createFakeCache() });
    vi.mocked(fetch).mockResolvedValue(owmResponse([]));
    const env = makeTestEnv({ OWM_API_KEY: 'secret-owm-key' });

    await weather.request(
      `${BASE_URL}/?lat=35&lon=135&timestamp=${encodeURIComponent(futureTimestamp(1))}`,
      {},
      env,
      createFakeExecutionCtx()
    );

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('appid=secret-owm-key'));
  });
});
