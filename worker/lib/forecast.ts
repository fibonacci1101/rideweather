export type OwmForecastEntry = {
  dt: number;
  [key: string]: unknown;
};

function lerp(a: number, b: number, weight: number): number {
  return a + (b - a) * weight;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// 対象時刻が予報開始(最初のバケット)より前でも、この許容差の範囲内(=丸め誤差や直近出発)なら
// 最初のバケットで代用してよい。これを超えて過去だと「その時刻の実データがそもそも無い」ため代用は誤り。
// 朝発のライドを日没後に開くと全地点の到着時刻が過去になり、全地点が「今(=最初のバケット、夜)」に
// スナップして『夜間の到着』警告が誤発火していた(実走行で発覚)。
// 値はバケット幅(3h)ではなく中間時刻の内挿と同じ「最近傍まで最大1.5h」に揃える。バケット幅だと、
// 日没前の到着でも最大3h先の夜バケットのアイコンが代用され、夜間警告の取りこぼしが残る(レビューF-01)。
const MAX_LOOKBACK_TO_FIRST_BUCKET_SECONDS = 90 * 60;

// 前後バケットのmainを線形補間する。tempとfeels_likeのみ対象、他フィールドは近い方を踏襲
function interpolateMain(nearest: unknown, before: unknown, after: unknown, weight: number): unknown {
  const b = before as { temp?: number; feels_like?: number } | undefined;
  const a = after as { temp?: number; feels_like?: number } | undefined;
  if (typeof b?.temp !== 'number' || typeof a?.temp !== 'number' || !isPlainObject(nearest)) {
    return nearest;
  }

  return {
    ...nearest,
    temp: lerp(b.temp, a.temp, weight),
    feels_like:
      typeof b.feels_like === 'number' && typeof a.feels_like === 'number'
        ? lerp(b.feels_like, a.feels_like, weight)
        : (nearest as { feels_like?: number } | undefined)?.feels_like,
  };
}

// 前後バケットのwind.speedのみ線形補間する。deg(風向き)は循環量のため近い方を踏襲
function interpolateWind(nearest: unknown, before: unknown, after: unknown, weight: number): unknown {
  const b = before as { speed?: number } | undefined;
  const a = after as { speed?: number } | undefined;
  if (typeof b?.speed !== 'number' || typeof a?.speed !== 'number' || !isPlainObject(nearest)) {
    return nearest;
  }

  return { ...nearest, speed: lerp(b.speed, a.speed, weight) };
}

function interpolatePop(nearest: unknown, before: unknown, after: unknown, weight: number): unknown {
  if (typeof before !== 'number' || typeof after !== 'number') return nearest;
  return lerp(before, after, weight);
}

/**
 * OWM無料プランの予報は3時間刻みのため、対象時刻を挟む前後バケットから
 * 気温・体感温度・風速・降水確率を線形補間する。天気アイコンや降水量、風向きのような
 * 補間になじまない値は、対象時刻に近い方のバケットの値をそのまま使う。
 */
export function interpolateForecastEntry(
  list: OwmForecastEntry[],
  targetTimestamp: number
): OwmForecastEntry | null {
  if (list.length === 0) return null;

  const sorted = [...list].sort((a, b) => a.dt - b.dt);
  // 予報範囲より未来の対象時刻は対応不可
  if (targetTimestamp > sorted[sorted.length - 1].dt) return null;

  let before: OwmForecastEntry | null = null;
  let after: OwmForecastEntry | null = null;
  for (const entry of sorted) {
    if (entry.dt <= targetTimestamp) before = entry;
    if (entry.dt >= targetTimestamp && !after) after = entry;
  }

  // 対象時刻が予報開始より前。バケット幅の範囲内なら直近の枠で代用する(丸め誤差・直近出発)。
  // それを超えて過去の場合は実データが存在しないためnullを返し、呼び出し側で「予報対象外」として扱わせる
  // (捏造した予報で夜アイコン由来の警告等が誤発火するのを防ぐ)。
  // dtは常に「クエリした対象時刻」を表す値として統一する(呼び出し側が経路によって意味が変わらないようにするため)
  if (!before) {
    if (after && after.dt - targetTimestamp <= MAX_LOOKBACK_TO_FIRST_BUCKET_SECONDS) {
      return { ...after, dt: targetTimestamp };
    }
    return null;
  }
  if (!after || before.dt === after.dt) return { ...before, dt: targetTimestamp };

  const weight = (targetTimestamp - before.dt) / (after.dt - before.dt);
  const nearest = weight <= 0.5 ? before : after;

  return {
    ...nearest,
    dt: targetTimestamp,
    main: interpolateMain(nearest.main, before.main, after.main, weight),
    wind: interpolateWind(nearest.wind, before.wind, after.wind, weight),
    pop: interpolatePop(nearest.pop, before.pop, after.pop, weight),
  };
}

/**
 * WeatherMatrix(地点×時間の一覧表示)向けに、対象時刻を中心とした前後windowSeconds以内の
 * 生バケットをdt昇順でそのまま返す(補間はしない。表示は各バケットの実際の値をそのまま使うため)。
 * OWMの`list`は既に取得済みのレスポンスから取り出すだけなので、追加のAPI呼び出しは発生しない。
 */
export function selectNearbyForecastEntries(
  list: OwmForecastEntry[],
  targetTimestamp: number,
  windowSeconds: number
): OwmForecastEntry[] {
  if (windowSeconds <= 0) return [];
  return [...list]
    .filter((entry) => Math.abs(entry.dt - targetTimestamp) <= windowSeconds)
    .sort((a, b) => a.dt - b.dt);
}
