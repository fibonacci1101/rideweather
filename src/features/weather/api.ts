import type { ForecastBucket, NormalizedWeather, RwgpsRouteResponse } from './types';

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  const message = (body as { error?: string } | null)?.error;
  return message ? `${fallback}: ${message}` : `${fallback} (status ${res.status})`;
}

const FETCH_TIMEOUT_MS = 15000;

export async function fetchRoute(routeId: string): Promise<RwgpsRouteResponse> {
  const res = await fetch(`/api/route/${encodeURIComponent(routeId)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'ルート情報の取得に失敗しました'));
  }
  return res.json();
}

type OwmRawForecastEntry = {
  dt: number;
  weather?: NormalizedWeather['weather'];
  main?: { temp?: number };
  wind?: NormalizedWeather['wind'];
};

type OwmForecastResponse = {
  forecast: {
    weather?: NormalizedWeather['weather'];
    main?: NormalizedWeather['main'];
    wind?: NormalizedWeather['wind'];
    rain?: { '3h'?: number };
    pop?: number;
  };
  city?: { sunrise?: number; sunset?: number; timezone?: number; name?: string };
  // worker側で逆ジオコーディング(local_names.ja優先)して整形済みの地名。
  // 日本国内で日本語名が取れなかった場合はundefined(ローマ字のcity.nameは出さない方針)
  placeName?: string;
  nearby?: OwmRawForecastEntry[];
};

function normalizeNearbyBuckets(nearby: OwmRawForecastEntry[] | undefined): ForecastBucket[] | undefined {
  if (!nearby) return undefined;
  return nearby.map((entry) => ({
    dt: entry.dt,
    weather: entry.weather,
    tempC: entry.main?.temp,
    wind: entry.wind,
  }));
}

export async function fetchWeatherForPoint(params: {
  lat: number;
  lon: number;
  // ISO 8601 UTC文字列(例: arrivalDate.toISOString())。date+time文字列に分けて渡すと
  // サーバ側でのパース時にタイムゾーンの解釈がズレるため、必ず絶対時刻の1本の文字列で渡す
  timestamp: string;
  windowHours?: number; // WeatherMatrix用。指定時は対象時刻前後の生バケット群も取得する
}): Promise<NormalizedWeather> {
  const query = new URLSearchParams({
    lat: String(params.lat),
    lon: String(params.lon),
    timestamp: params.timestamp,
  });
  if (params.windowHours !== undefined) {
    query.set('windowHours', String(params.windowHours));
  }

  const res = await fetch(`/api/weather?${query.toString()}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, '天気情報の取得に失敗しました'));
  }

  const data: OwmForecastResponse = await res.json();
  if (!data.forecast) {
    throw new Error('天気情報の取得に失敗しました: unexpected response shape');
  }
  return {
    weather: data.forecast.weather,
    main: data.forecast.main,
    wind: data.forecast.wind,
    rainMm: data.forecast.rain?.['3h'],
    pop: data.forecast.pop,
    sunrise: data.city?.sunrise,
    sunset: data.city?.sunset,
    timezoneOffsetSeconds: data.city?.timezone,
    // worker整形済みの逆ジオコーディング地名。ローマ字しか無い国内地点ではundefinedになり、
    // その場合はplaceName自体を表示しない(生のcity.nameへはフォールバックしない)
    locationName: data.placeName,
    nearbyBuckets: normalizeNearbyBuckets(data.nearby),
  };
}
