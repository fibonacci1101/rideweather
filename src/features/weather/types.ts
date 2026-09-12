export type TrackPoint = {
  x: number; // 経度
  y: number; // 緯度
  d?: number; // ルート起点からの累積距離 (メートル)
  n?: string; // 地点名 (RWGPS側で付与されている場合のみ)
  e?: number; // 標高 (メートル)
};

export type RwgpsRouteResponse = {
  route: {
    id: number;
    name?: string;
    track_points: TrackPoint[];
  };
};

export type PointExtractionStrategy =
  | { mode: 'fixedCount'; count: number }
  | { mode: 'byDistance'; intervalMeters: number };

// ルートの入力元。RWGPSはIDからサーバー経由で取得、アップロードはブラウザ上でパース済みの
// 座標列をそのまま持つ(ネットワーク不要)。URLでの共有・ローカルキャッシュはrwgps限定
// (STEP2, plans/STEP2_IMPLEMENTATION_PLAN.md 1.1/1.4参照)
export type RouteSource =
  | { type: 'rwgps'; routeId: string }
  | { type: 'upload'; fileId: string; fileName: string; trackPoints: TrackPoint[] };

// オフライン履歴(offlineHistory.ts)のレコードがどちらの入力元由来かを表す。RouteSourceと
// 似ているが、履歴には座標データ(trackPoints)は別フィールドで持つため、識別に必要な
// 最小限のフィールド(routeId/fileName)のみを持つ軽量な型として分けている
// (当初はアップロード限定だったが、RWGPSルートも「圏外で再取得できない」という
// STEP3の想定シーンに合わせて対象に含めるよう拡張した)
// titleはルート取得成功後(RwgpsRouteResponse.route.name)に初めて分かるため、
// ユーザー入力時点の値であるRouteSource側には持たせず、履歴専用の追加フィールドとして
// 交差型で足している(STEP5)。optionalなので既存の保存済みレコード(title無し)とも
// 型・実行時ともに後方互換(offlineHistory.ts参照)
export type OfflineHistorySource =
  | (Extract<RouteSource, { type: 'rwgps' }> & { title?: string })
  | { type: 'upload'; fileName: string };

export type OwmWeatherCondition = {
  id: number;
  main: string;
  description: string;
  icon: string;
};

// WeatherMatrix向け: 補間していない生の3時間バケット1件分
export type ForecastBucket = {
  dt: number; // unix timestamp (秒、UTC)
  weather?: OwmWeatherCondition[];
  tempC?: number;
  pop?: number;
  wind?: { speed: number; deg: number }; // STEP6の風向き矢印表示用
};

// /api/weather から返る天気情報(forecastのみ。3時間バケットを線形補間した値)
export type NormalizedWeather = {
  weather?: OwmWeatherCondition[];
  main?: {
    temp: number;
    feels_like: number;
  };
  wind?: {
    speed: number;
    deg: number;
  };
  rainMm?: number; // 降水量 (3h換算、補間対象外のため近い方のバケット値)
  pop?: number; // 降水確率
  locationName?: string; // worker側でOWM Geocoding reverseを整形した地名(local_names.ja優先。ローマ字のみの国内地点はundefined)
  sunrise?: number; // unix timestamp (秒、UTC)
  sunset?: number; // unix timestamp (秒、UTC)
  timezoneOffsetSeconds?: number; // 地点のUTCからのオフセット (秒)。sunrise/sunsetを地点のローカル時刻で表示するために使用
  nearbyBuckets?: ForecastBucket[]; // WeatherMatrix用。windowHours指定時のみ、対象時刻前後の生バケット群(dt昇順)
};

export type WeatherPoint = {
  lat: number;
  lon: number;
  name: string; // 表示タイトル("出発地点"/"到着地点"/"C-N"の連番固定)
  placeName?: string; // 補足の地名(RWGPSのキューポイント名 > OWMの逆ジオコーディング地名)
  distanceMeters: number;
  elevationMeters?: number;
  estimatedArrivalTime: string; // ISO文字列
  weather: NormalizedWeather | null;
  error?: string;
};

export type RouteWeatherParams = {
  routeSource: RouteSource | null;
  selectedDate: string; // YYYY-MM-DD
  selectedTime: string; // HH:mm
  averageSpeedKmh: number | null;
  // 到着予定時刻の獲得標高・休憩時間補正(STEP7)を適用するか。フォームは常に明示的な
  // 値を持つため必須にする(URL・オフライン履歴から復元する場合のデフォルトは、
  // それぞれurlState.ts/offlineHistory.tsのコメント参照)
  arrivalCorrectionEnabled: boolean;
};
