import { useQuery } from '@tanstack/react-query';
import { fetchRoute, fetchWeatherForPoint } from './api';
import { extractKeyPoints } from './extractKeyPoints';
import { calculateArrivalTime, elevationGainAtDistances } from './calculateArrivalTime';
import type { RouteWeatherParams, RwgpsRouteResponse, WeatherPoint } from './types';

// アップロードされたファイルは既にブラウザ上でパース済み(ネットワーク不要)なため、
// 既存のRwgpsRouteResponse形状にそのまま詰め替えるだけにする。これによりRouteMap等の
// 下流コンポーネントはルートの入力元を意識せず、trackPointsだけを見れば済む
async function fetchRouteBySource(
  routeSource: NonNullable<RouteWeatherParams['routeSource']>
): Promise<RwgpsRouteResponse> {
  if (routeSource.type === 'rwgps') {
    return fetchRoute(routeSource.routeId);
  }
  return { route: { id: 0, track_points: routeSource.trackPoints } };
}

// 地点名(表示タイトル)は"出発地点"/"到着地点"/"C-N"の連番固定にする。
// RWGPSのキューポイント名やOWMの逆ジオコーディング地名は、和文/ローマ字が混在し
// 表記が不揃いになるため、タイトルではなく補足情報(placeName)として添える
function buildCheckpointLabel(index: number, total: number): string {
  if (index === 0) return '出発地点';
  if (index === total - 1) return '到着地点';
  return `C-${index}`;
}

// OpenWeatherMap無料プランのforecastがカバーする範囲。これを外れる到着予定時刻は
// 取得しても必ず失敗するため、リクエスト前に弾く
const FORECAST_RANGE_DAYS = 5;
// 過去側の許容差。OWM無料予報は過去のデータを持たないが、走行中に直前に通過した地点まで
// 一律エラーにすると使い勝手が悪いため、この範囲の「少し前」までは取得を試みる
// (worker/lib/forecast.ts のバケット代用の許容差と揃える)。以前は過去側のガードが無く、
// 1日以上前のライドを開くとworkerが400を返して生の英語メッセージが表示されていた(レビューF-02)
const PAST_GRACE_MS = 90 * 60 * 1000;

function isWithinForecastRange(arrivalDate: Date): boolean {
  const now = Date.now();
  const upper = now + FORECAST_RANGE_DAYS * 24 * 60 * 60 * 1000;
  const lower = now - PAST_GRACE_MS;
  const t = arrivalDate.getTime();
  return t >= lower && t <= upper;
}

// バックエンドの/api/weather側の上限(worker/routes/weather.ts)と合わせる
const MAX_WINDOW_HOURS = 48;
// バケット境界での取りこぼしを避けるための余裕(3時間バケット1つ分)
const WINDOW_BUFFER_HOURS = 3;

// WeatherMatrix(地点×時間のマトリックス表示)は全地点で共通の時間軸を使うため、
// 各地点にはルート全体(出発〜最終到着)をカバーするだけの前後バケットを要求する。
// OWMへの追加呼び出しは発生しない(1回のforecast取得のうち返す範囲が変わるだけ)
function calculateWindowHours(arrivalDate: Date, routeStartDate: Date, routeEndDate: Date): number {
  const hoursSinceRouteStart = (arrivalDate.getTime() - routeStartDate.getTime()) / 3_600_000;
  const hoursUntilRouteEnd = (routeEndDate.getTime() - arrivalDate.getTime()) / 3_600_000;
  const required = Math.max(hoursSinceRouteStart, hoursUntilRouteEnd, 0);
  return Math.min(MAX_WINDOW_HOURS, Math.ceil(required) + WINDOW_BUFFER_HOURS);
}

// 地点ごとの天気取得失敗は(Promise.allが1地点の失敗で全体を落とさないよう)ここでtry/catchして
// resolveするため、weatherQuery自体はisErrorにならない。そのためApp.tsxのweatherQuery.isError
// を起点にしたオフライン向け文言はこの経路には届かない(コードレビューで発見)。カード単位で
// 表示されるこのメッセージ自体をオフライン時に分かりやすくすることで、生の英語エラー
// (例: "Failed to fetch")がそのままユーザーに表示されるのを防ぐ
function describeWeatherFetchError(err: unknown): string {
  if (!navigator.onLine) return 'オフラインのため取得できません';
  const message = err instanceof Error ? err.message : '';
  // /api/weather が404で返す「該当予報なし」(予報範囲外・過去の時刻)を、生の英語ではなく
  // 理由の分かる和文にする。過去のライドを後から開くと到着時刻がOWM無料予報の範囲より
  // 過去になり、この経路に入る(以前は「今」の予報にスナップして誤警告が出ていた。fix参照)
  if (message.includes('no forecast data')) {
    return 'この時刻の予報がありません(予報は5日先まで・過去の時刻は非対応)';
  }
  return message || '不明なエラーが発生しました';
}

async function fetchWeatherPoint(
  point: { x: number; y: number; d?: number; n?: string; e?: number },
  index: number,
  total: number,
  startDate: Date,
  averageSpeedKmh: number,
  routeStartDate: Date,
  routeEndDate: Date,
  elevationGainMeters: number,
  applyCorrection: boolean
): Promise<WeatherPoint> {
  const lat = point.y;
  const lon = point.x;
  const distanceMeters = point.d ?? 0;
  const elevationMeters = point.e;
  const checkpointLabel = buildCheckpointLabel(index, total);
  // RWGPS側のキューポイント名 > OWMの逆ジオコーディング地名、の優先順で補足の地名を決める
  const rwgpsName = point.n;

  // 到着予定時刻はエラー時の表示にも使うため、try/catchの外側で保持する。
  // (以前はcatch側でstartDateを代わりに詰めており、天気取得に失敗した地点の到着予定が
  // 一律「出発時刻」と表示される誤りがあった。4,210kmのルートで発覚)
  let arrivalDate: Date | null = null;

  // 到着時刻の算出も含めてtry/catchで囲む(1地点の座標・距離データが不正でも、
  // Promise.all全体を失敗させず「この地点だけエラー」として扱うため)
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(distanceMeters)) {
      throw new Error('地点の座標または距離データが不正です');
    }

    arrivalDate = calculateArrivalTime(startDate, distanceMeters, averageSpeedKmh, elevationGainMeters, applyCorrection);
    if (Number.isNaN(arrivalDate.getTime())) {
      arrivalDate = null;
      throw new Error('到着予定時刻の算出に失敗しました');
    }

    const base = {
      lat,
      lon,
      name: checkpointLabel,
      distanceMeters,
      elevationMeters,
      estimatedArrivalTime: arrivalDate.toISOString(),
    } as const;

    // 予報の対象範囲(5日先まで／過去は非対応)を外れる地点は、APIを叩いても必ず失敗する
    // (かつ技術的な英語メッセージがそのまま表示される)。無駄な呼び出しとレート制限の消費を
    // 避けるため手前で弾き、理由が伝わる和文メッセージにする
    if (!isWithinForecastRange(arrivalDate)) {
      return {
        ...base,
        placeName: rwgpsName,
        weather: null,
        error: `到着予定時刻が予報の対象範囲外です(予報は${FORECAST_RANGE_DAYS}日先まで・過去の時刻は非対応)`,
      };
    }

    const windowHours = calculateWindowHours(arrivalDate, routeStartDate, routeEndDate);
    const weather = await fetchWeatherForPoint({
      lat,
      lon,
      timestamp: arrivalDate.toISOString(),
      windowHours,
    });
    return { ...base, placeName: rwgpsName ?? weather.locationName, weather };
  } catch (err) {
    return {
      lat,
      lon,
      name: checkpointLabel,
      distanceMeters,
      elevationMeters,
      estimatedArrivalTime: (arrivalDate ?? startDate).toISOString(),
      placeName: rwgpsName,
      weather: null,
      error: describeWeatherFetchError(err),
    };
  }
}

/**
 * ルート天気機能のオーケストレーションフック。ルート取得(routeQuery)が成功したら、
 * 抽出した代表地点ぶんの天気取得(weatherQuery)を並列実行する。App.tsxはこのフックが
 * 返すクエリ結果をそのまま表示コンポーネントに渡すだけで、自前でfetchしない(DESIGN.md 7.1参照)。
 */
export function useRouteWeather(params: RouteWeatherParams) {
  const routeSource = params.routeSource;
  // routeSourceを一意に識別するキー(rwgps: routeId、upload: fileId)。
  // TanStack Queryのキャッシュ単位として使う
  const routeSourceKey =
    routeSource === null
      ? null
      : routeSource.type === 'rwgps'
        ? `rwgps:${routeSource.routeId}`
        : `upload:${routeSource.fileId}`;

  const routeQuery = useQuery({
    queryKey: ['route', routeSourceKey],
    queryFn: () => fetchRouteBySource(routeSource!),
    enabled: routeSource !== null,
  });

  const weatherQuery = useQuery({
    queryKey: [
      'weather',
      routeSourceKey,
      params.selectedDate,
      params.selectedTime,
      params.averageSpeedKmh,
      params.arrivalCorrectionEnabled,
    ],
    queryFn: async () => {
      const trackPoints = routeQuery.data?.route.track_points ?? [];
      const keyPoints = extractKeyPoints(trackPoints);
      const startDate = new Date(`${params.selectedDate}T${params.selectedTime}:00`);
      const averageSpeedKmh = params.averageSpeedKmh as number;
      const applyCorrection = params.arrivalCorrectionEnabled;

      // 各代表地点(keyPoints)までの累積獲得標高。補正OFF時は結果を使わないため計算自体を省く。
      // 表示用に間引いたkeyPoints同士の差分ではなく、間引き前の生trackPointsを1回スキャンして
      // 求める(elevationGainAtDistancesのコメント参照。10地点だけだと細かい峠を見落とすため)
      const keyPointDistances = keyPoints.map((p) => p.d ?? 0);
      const elevationGains = applyCorrection
        ? elevationGainAtDistances(trackPoints, keyPointDistances)
        : keyPointDistances.map(() => 0);

      // WeatherMatrixの共通時間軸用に、ルート全体(出発〜最終到着)の到着予定時刻の範囲を
      // 先に算出しておく(各地点の到着予定時刻の算出方法自体はfetchWeatherPoint内と同じ式)
      const lastDistanceMeters = keyPoints.length > 0 ? (keyPoints[keyPoints.length - 1].d ?? 0) : 0;
      const totalElevationGain = elevationGains.length > 0 ? elevationGains[elevationGains.length - 1] : 0;
      const routeEndDate = calculateArrivalTime(
        startDate,
        lastDistanceMeters,
        averageSpeedKmh,
        totalElevationGain,
        applyCorrection
      );

      return Promise.all(
        keyPoints.map((point, index) =>
          fetchWeatherPoint(
            point,
            index,
            keyPoints.length,
            startDate,
            averageSpeedKmh,
            startDate,
            routeEndDate,
            elevationGains[index],
            applyCorrection
          )
        )
      );
    },
    enabled:
      routeQuery.isSuccess &&
      params.selectedDate !== '' &&
      params.selectedTime !== '' &&
      params.averageSpeedKmh !== null &&
      Number.isFinite(params.averageSpeedKmh) &&
      params.averageSpeedKmh > 0,
  });

  return { routeQuery, weatherQuery };
}
