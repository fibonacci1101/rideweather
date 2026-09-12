import type { NormalizedWeather, OwmWeatherCondition, WeatherPoint } from './types';

export type WarningReason = 'rain-probability' | 'wind' | 'rain-amount' | 'heat' | 'cold' | 'night';

// 夜間判定はsunrise/sunsetとの時刻比較ではなく、OWMアイコンコード末尾('n'=夜間, 'd'=日中)を使う。
// 地点・時刻ごとにOWM側で判定済みの値をそのまま使えるため、タイムゾーンや日付跨ぎを自前計算する
// 必要がない。WeatherMatrix.tsx(時間帯表の夜間列ハイライト)と共通で使うことで、同じ地点・
// 同じ時刻なのに片方は夜扱い・もう片方は昼扱いという判定基準のズレを防ぐ(コードレビューで、
// 両ファイルに同じロジックが個別実装されていた重複を指摘され、共通関数に切り出した)
export function isNightIcon(conditions: OwmWeatherCondition[] | undefined): boolean {
  return conditions?.[0]?.icon?.endsWith('n') ?? false;
}

export const WARNING_THRESHOLDS = {
  popRatio: 0.5, // 降水確率 50%以上
  windSpeedMps: 4, // 風速 4m/s超
  rainMm: 1, // 降水量(3h/1h) 1mm以上
  heatFeelsLikeC: 33, // 体感温度 33℃以上
  coldFeelsLikeC: 5, // 体感温度 5℃以下
  tempSwingC: 10, // ルート内気温差 10℃以上
} as const;

const REASON_LABELS: Record<WarningReason, string> = {
  'rain-probability': `降水確率${WARNING_THRESHOLDS.popRatio * 100}%以上`,
  wind: `風速${WARNING_THRESHOLDS.windSpeedMps}m/s超`,
  'rain-amount': `降水量${WARNING_THRESHOLDS.rainMm}mm以上`,
  heat: `体感温度${WARNING_THRESHOLDS.heatFeelsLikeC}℃以上`,
  cold: `体感温度${WARNING_THRESHOLDS.coldFeelsLikeC}℃以下`,
  night: '夜間の到着(ライト点灯推奨)',
};

// 地点単位の警告判定(カードの枠線・該当項目の色分けに使用)
export function getPointWarnings(weather: NormalizedWeather | null): WarningReason[] {
  if (!weather) return [];
  const reasons: WarningReason[] = [];

  if (weather.pop !== undefined && weather.pop >= WARNING_THRESHOLDS.popRatio) {
    reasons.push('rain-probability');
  }
  if (weather.wind?.speed !== undefined && weather.wind.speed > WARNING_THRESHOLDS.windSpeedMps) {
    reasons.push('wind');
  }
  if (weather.rainMm !== undefined && weather.rainMm >= WARNING_THRESHOLDS.rainMm) {
    reasons.push('rain-amount');
  }
  if (weather.main?.feels_like !== undefined) {
    if (weather.main.feels_like >= WARNING_THRESHOLDS.heatFeelsLikeC) reasons.push('heat');
    if (weather.main.feels_like <= WARNING_THRESHOLDS.coldFeelsLikeC) reasons.push('cold');
  }
  if (isNightIcon(weather.weather)) {
    reasons.push('night');
  }

  return reasons;
}

export type TemperatureSwing = {
  diffC: number;
  maxPoint: WeatherPoint;
  minPoint: WeatherPoint;
};

// ルート全体(最高体感温度地点 - 最低体感温度地点)の気温差判定
export function getTemperatureSwing(points: WeatherPoint[]): TemperatureSwing | null {
  const withFeelsLike = points.filter((p) => p.weather?.main?.feels_like !== undefined);
  if (withFeelsLike.length < 2) return null;

  let maxPoint = withFeelsLike[0];
  let minPoint = withFeelsLike[0];
  for (const p of withFeelsLike) {
    const temp = p.weather!.main!.feels_like;
    if (temp > maxPoint.weather!.main!.feels_like) maxPoint = p;
    if (temp < minPoint.weather!.main!.feels_like) minPoint = p;
  }

  const diffC = maxPoint.weather!.main!.feels_like - minPoint.weather!.main!.feels_like;
  if (diffC < WARNING_THRESHOLDS.tempSwingC) return null;

  return { diffC, maxPoint, minPoint };
}

export type WarningSummary = {
  reason: WarningReason;
  message: string;
};

const POINT_WARNING_ORDER: WarningReason[] = [
  'rain-probability',
  'rain-amount',
  'wind',
  'heat',
  'cold',
  'night',
];

// 該当地点のインデックス列(sorted配列内の昇順インデックス)から表示用ラベルを組み立てる。
// 連続する区間は「先頭〜末尾」、間に非該当地点を挟む場合は区間ごとに分けて「、」で列挙する
// (非連続なのに1つの連続区間であるかのように見せると、実際は安全な区間まで危険であるかのように誤解されるため)
function buildRangeLabel(indices: number[], sorted: WeatherPoint[]): string {
  const parts: string[] = [];
  let rangeStart = indices[0];
  let rangeEnd = indices[0];

  const flush = () => {
    parts.push(
      rangeStart === rangeEnd
        ? sorted[rangeStart].name
        : `${sorted[rangeStart].name}〜${sorted[rangeEnd].name}`
    );
  };

  for (let i = 1; i < indices.length; i++) {
    const current = indices[i];
    if (current === rangeEnd + 1) {
      rangeEnd = current;
      continue;
    }
    flush();
    rangeStart = current;
    rangeEnd = current;
  }
  flush();

  return parts.join('、');
}

/**
 * 要約バナー用: 警告該当地点を理由ごとにグルーピングし、区間+理由のメッセージ一覧を作る。
 * 気温差(ルート全体の相対的な注意)はこれとは性質が異なるため含めない(getTemperatureSwingを別途使う)。
 */
export function buildPointWarningSummaries(points: WeatherPoint[]): WarningSummary[] {
  const sorted = [...points].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const summaries: WarningSummary[] = [];

  for (const reason of POINT_WARNING_ORDER) {
    const affectedIndices = sorted
      .map((p, index) => (getPointWarnings(p.weather).includes(reason) ? index : -1))
      .filter((index) => index !== -1);
    if (affectedIndices.length === 0) continue;

    const range = buildRangeLabel(affectedIndices, sorted);
    summaries.push({ reason, message: `${range}で${REASON_LABELS[reason]}` });
  }

  return summaries;
}
