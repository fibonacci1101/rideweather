import { Hono } from 'hono';
import type { Env } from '../index';
import { checkRateLimit } from '../lib/rateLimit';
import {
  interpolateForecastEntry,
  selectNearbyForecastEntries,
  type OwmForecastEntry,
} from '../lib/forecast';
import { resolveDisplayPlaceName, type OwmGeoResult } from '../lib/reverseGeocode';

const app = new Hono<{ Bindings: Env }>();

// 近隣リクエストの重複を削減する程度のTTL
const CACHE_TTL_SECONDS = 60 * 30;
// 逆ジオコーディング結果のTTL。地名は時刻に依存しない(同じ座標なら何時の予報でも同じ)ため、
// weather本体(30分・分バケット単位)とは別に、座標だけをキーにして長めに保持する。
// これをしないと、同一ルートの各リクエストごと・分バケットが変わるたびにgeoを引き直し、
// 1ルートあたりのOWM呼び出しが地点数の2倍に膨らむ(レビューF-13)
const GEO_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
// 逆ジオコーディングのタイムアウト。地名は付加情報なので、ここが詰まって予報取得済みの
// レスポンス全体を巻き添えにしないよう短めに切る(レビューF-11)
const GEO_FETCH_TIMEOUT_MS = 4000;

type OwmForecastResponse = {
  list: OwmForecastEntry[];
  city: { name?: string; country?: string } | unknown;
};

// キャッシュの粒度を粗くするため座標を丸める
function roundCoord(value: number): string {
  return value.toFixed(2);
}

// 地名表示用の逆ジオコーディング。forecastのcity.nameは日本の地方部でローマ字/県名止まりに
// なりがちなため、OWM Geocoding reverse(local_names付き)で日本語名を引き直す。
// 取得失敗(非OK・タイムアウト・形状想定外)時はundefinedを返し、地名なしで天気は通す。
async function fetchReverseGeoResults(
  lat: number,
  lon: number,
  apiKey: string
): Promise<OwmGeoResult[] | undefined> {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=5&appid=${apiKey}`,
      { signal: AbortSignal.timeout(GEO_FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) {
      // 「地名が出ない」の原因を本番で切り分けられるようにする。URLはappidを含むため出さない(レビューF-14)
      console.warn('[geo-reverse-failed]', { lat, lon, reason: 'http-error', status: res.status });
      return undefined;
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      console.warn('[geo-reverse-failed]', { lat, lon, reason: 'unexpected-shape' });
      return undefined;
    }
    // OWMが要素にnull/非オブジェクトを混ぜても後続でクラッシュしないよう、この時点で除外する(レビューF-06)
    return body.filter((entry): entry is OwmGeoResult => typeof entry === 'object' && entry !== null);
  } catch (err) {
    console.warn('[geo-reverse-failed]', {
      lat,
      lon,
      reason: 'fetch-threw',
      name: err instanceof Error ? err.name : 'unknown',
    });
    return undefined;
  }
}

/**
 * 座標だけをキーにした専用キャッシュ越しに逆ジオコーディング地名を得る。
 * geoの取得に成功した場合のみキャッシュに焼き付ける(失敗をキャッシュすると次リクエストで
 * 再試行できず地名が出ないまま固定されるため。レビューF-12/F-14)。
 */
async function getReverseGeoPlaceName(
  lat: number,
  lon: number,
  city: { name?: string; country?: string } | undefined,
  apiKey: string,
  cache: Cache,
  // waitUntilだけ使えればよい。Honoの`c.executionCtx`とWorkersの`ExecutionContext<unknown>`で
  // 型が微妙に食い違う(tracing等)ため、必要な部分だけを構造的に受ける
  ctx: { waitUntil(promise: Promise<unknown>): void }
): Promise<string | undefined> {
  const geoCacheKey = new Request(
    `https://cache.internal/api/geo?lat=${roundCoord(lat)}&lon=${roundCoord(lon)}`
  );
  const cached = await cache.match(geoCacheKey);
  if (cached) {
    const { placeName } = (await cached.json()) as { placeName: string | null };
    return placeName ?? undefined;
  }

  const geoResults = await fetchReverseGeoResults(lat, lon, apiKey);
  const placeName = resolveDisplayPlaceName(geoResults, city);

  if (geoResults !== undefined) {
    ctx.waitUntil(
      cache.put(
        geoCacheKey,
        new Response(JSON.stringify({ placeName: placeName ?? null }), {
          headers: {
            'content-type': 'application/json',
            'cache-control': `public, max-age=${GEO_CACHE_TTL_SECONDS}`,
          },
        })
      )
    );
  }
  return placeName;
}

// ISO 8601 UTC(Z終端)のみ受け付ける。タイムゾーン指定のない日時文字列は
// パースするランタイムのローカルタイムゾーンで解釈される仕様のため、以前のように
// date+time文字列を個別に受け取ると、クライアント(JST)とWorkers(ローカルTZ=UTC)とで
// 解釈がズレ、最大9時間ずれた予報を返してしまっていた(本番で実際に発生・実測で確認済み)。
// 絶対時刻を1本の文字列として受け取ることで、この曖昧さ自体をなくす
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// WeatherMatrix(地点×時間の一覧表示)向けのバケット幅。ライド1本分の時間差を賄えれば十分なため、
// レスポンス肥大化・キャッシュ効率を考慮して上限を設ける
const MAX_WINDOW_HOURS = 48;
// OWM無料プランの予報は概ね5日先まで。明らかに壊れた日時(大昔・遠い未来)だけをここで弾く
const MIN_DATE_OFFSET_DAYS = -1;
const MAX_DATE_OFFSET_DAYS = 6;

function isTimestampInRange(epochSeconds: number, nowSeconds: number): boolean {
  const diffDays = (epochSeconds - nowSeconds) / (24 * 60 * 60);
  return diffDays >= MIN_DATE_OFFSET_DAYS && diffDays <= MAX_DATE_OFFSET_DAYS;
}

/**
 * timestampクエリパラメータをepoch秒に変換する。`Z`終端のISO 8601文字列のみを受け付け、
 * それ以外(タイムゾーン指定のない日時文字列、date+timeの分割など)は全て拒否する。
 * 妥当性チェックとパースを1関数に閉じ込めることで、ルートハンドラ側で誤って
 * タイムゾーン指定のない文字列を組み立てて渡してしまう(今回の本番バグの原因)経路を作れないようにする。
 */
export function parseTimestampParam(raw: string | undefined, now: Date = new Date()): number | null {
  if (!raw || !TIMESTAMP_PATTERN.test(raw)) return null;
  const epochSeconds = new Date(raw).getTime() / 1000;
  if (Number.isNaN(epochSeconds) || !isTimestampInRange(epochSeconds, now.getTime() / 1000)) return null;
  return epochSeconds;
}

/**
 * OpenWeatherMapのforecastエンドポイントをプロキシし、指定した日時に最も近い予報を
 * 前後バケットから線形補間して返す(補間ロジックはinterpolateForecastEntryに分離)。
 * Cache API(30分TTL、緯度経度を丸めた値+対象日時単位)でレスポンスをキャッシュする。
 */
app.get('/', async (c) => {
  const latParam = c.req.query('lat');
  const lonParam = c.req.query('lon');
  const timestampParam = c.req.query('timestamp');

  // Number('') は 0 になり空文字が通ってしまうため、変換前に非空を確認する
  if (!latParam || !lonParam) {
    return c.json({ error: 'lat and lon are required' }, 400);
  }

  const lat = Number(latParam);
  const lon = Number(lonParam);

  // Number.isFinite は Infinity/NaN の両方を弾く。あわせて緯度経度の有効範囲もチェックする
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return c.json({ error: 'lat and lon must be valid coordinates' }, 400);
  }
  if (!timestampParam) {
    return c.json({ error: 'timestamp is required' }, 400);
  }
  const targetTimestamp = parseTimestampParam(timestampParam);
  if (targetTimestamp === null) {
    return c.json(
      {
        error:
          'timestamp must be an ISO 8601 UTC string within the supported range (e.g. 2026-08-16T06:00:00.000Z)',
      },
      400
    );
  }

  // WeatherMatrix用に対象時刻前後の生バケットも欲しい場合のみ指定する任意パラメータ。
  // 省略時(0)は従来通り単一の補間結果のみを返す(後方互換)
  const windowHoursParam = c.req.query('windowHours');
  let windowHours = 0;
  if (windowHoursParam !== undefined) {
    windowHours = Number(windowHoursParam);
    if (!Number.isFinite(windowHours) || windowHours < 0 || windowHours > MAX_WINDOW_HOURS) {
      return c.json({ error: `windowHours must be between 0 and ${MAX_WINDOW_HOURS}` }, 400);
    }
  }

  const cache = caches.default;
  // 分単位に丸めてキャッシュキーの粒度を揃える(以前のdate+time文字列と同等の粒度)
  const bucketMinute = Math.floor(targetTimestamp / 60);
  const cacheKey = new Request(
    `https://cache.internal/api/weather?lat=${roundCoord(lat)}&lon=${roundCoord(lon)}&bucket=${bucketMinute}&window=${windowHours}`
  );
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await checkRateLimit(c.env.WEATHER_RATE_LIMITER, ip))) {
    console.warn('[rate-limit-exceeded]', { endpoint: 'weather', ip, lat, lon });
    return c.json({ error: 'rate limit exceeded' }, 429);
  }

  const upstream = await fetch(
    `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${c.env.OWM_API_KEY}&units=metric&lang=ja`
  );
  if (!upstream.ok) {
    console.error('[upstream-error]', {
      endpoint: 'weather',
      api: 'owm-forecast',
      status: upstream.status,
      lat,
      lon,
      ip,
    });
    return new Response(
      JSON.stringify({ error: `failed to fetch weather (status ${upstream.status})` }),
      { status: upstream.status, headers: { 'content-type': 'application/json' } }
    );
  }

  let data: OwmForecastResponse;
  try {
    data = (await upstream.json()) as OwmForecastResponse;
  } catch {
    console.error('[upstream-error]', { endpoint: 'weather', api: 'owm-forecast', reason: 'invalid-json', lat, lon, ip });
    return c.json({ error: 'upstream returned an invalid response' }, 502);
  }
  if (!Array.isArray(data.list)) {
    console.error('[upstream-error]', { endpoint: 'weather', api: 'owm-forecast', reason: 'unexpected-shape', lat, lon, ip });
    return c.json({ error: 'upstream returned an unexpected response' }, 502);
  }

  const forecast = interpolateForecastEntry(data.list, targetTimestamp);

  if (!forecast) {
    console.warn('[forecast-not-found]', { endpoint: 'weather', lat, lon, timestamp: timestampParam, ip });
    return c.json({ error: 'no forecast data found close to the requested date/time' }, 404);
  }

  const nearby =
    windowHours > 0
      ? selectNearbyForecastEntries(data.list, targetTimestamp, windowHours * 3600)
      : undefined;

  const placeName = await getReverseGeoPlaceName(
    lat,
    lon,
    data.city as { name?: string; country?: string } | undefined,
    c.env.OWM_API_KEY,
    cache,
    c.executionCtx
  );

  const resultBody = {
    forecast,
    city: data.city,
    ...(placeName ? { placeName } : {}),
    ...(nearby ? { nearby } : {}),
  };

  const response = new Response(JSON.stringify(resultBody), {
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
