import type { RouteWeatherParams } from './types';
import { getTodayLocalDateString, isDateAfterToday } from './format';

const PARAM_ROUTE = 'route';
const PARAM_DATE = 'date';
const PARAM_TIME = 'time';
const PARAM_SPEED = 'speed';
const PARAM_CORRECTION = 'correction';

// RWGPSのroute idは実運用上ここまで桁数が膨らむことはない。上限を設けず信頼しきらないための防御
const ROUTE_ID_PATTERN = /^\d{1,15}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// 自転車の走行速度として現実的な上限(電動アシスト等も考慮し余裕を持たせる)
const MAX_SPEED_KMH = 200;

// URLだけで結果を再現できるようにする(アカウント不要で共有できる強みを出すため)。
// route/date/time/speedが揃っていない状態は保存しない。
// アップロードされたファイルの座標データはURLに載せられる量ではないため、
// routeSource.type === 'rwgps' の場合のみエンコードする(STEP2, plans/STEP2_IMPLEMENTATION_PLAN.md 1.4参照)
export function encodeParamsToSearch(params: RouteWeatherParams): string {
  if (
    !params.routeSource ||
    params.routeSource.type !== 'rwgps' ||
    !params.selectedDate ||
    !params.selectedTime ||
    params.averageSpeedKmh === null
  ) {
    return '';
  }

  const sp = new URLSearchParams();
  sp.set(PARAM_ROUTE, params.routeSource.routeId);
  sp.set(PARAM_DATE, params.selectedDate);
  sp.set(PARAM_TIME, params.selectedTime);
  sp.set(PARAM_SPEED, String(params.averageSpeedKmh));
  sp.set(PARAM_CORRECTION, params.arrivalCorrectionEnabled ? '1' : '0');
  return sp.toString();
}

export function decodeParamsFromSearch(search: string): RouteWeatherParams | null {
  const sp = new URLSearchParams(search);
  const routeId = sp.get(PARAM_ROUTE);
  const selectedDate = sp.get(PARAM_DATE);
  const selectedTime = sp.get(PARAM_TIME);
  const speedValue = sp.get(PARAM_SPEED);
  if (
    !routeId ||
    !ROUTE_ID_PATTERN.test(routeId) ||
    !selectedDate ||
    !DATE_PATTERN.test(selectedDate) ||
    !selectedTime ||
    !TIME_PATTERN.test(selectedTime) ||
    !speedValue
  ) {
    return null;
  }

  const averageSpeedKmh = Number(speedValue);
  // Number.isFinite で Infinity/NaN を弾く(不正な共有リンクによる到着時刻計算の破綻を防ぐ)。
  // 上限も設け、桁外れの値がそのまま到着時刻計算に渡らないようにする
  if (!Number.isFinite(averageSpeedKmh) || averageSpeedKmh <= 0 || averageSpeedKmh > MAX_SPEED_KMH) {
    return null;
  }

  const todayString = getTodayLocalDateString();
  const isPastDate =
    selectedDate !== todayString && !isDateAfterToday(selectedDate, todayString);
  // 過去日のURLは古い/壊れた共有リンクとみなし採用しない
  if (isPastDate) return null;

  // correctionパラメータが省略されている場合はtrue(補正あり)として扱う。URLは過去の
  // 計算結果のスナップショットを持たず、開いた時点の現在ロジックで再計算するだけなので、
  // STEP7以前に作られた共有URLもそのまま新しい既定動作(補正あり)で自然に再現できる
  // (offlineHistory.tsは保存済みスナップショットとの整合性を優先し、逆にfalseをデフォルトにしている。理由はそちらのコメント参照)
  // '0'のみを明示的な「補正なし」として扱い、それ以外の値(手動編集された不正値も含む)は
  // 全て安全側の「補正あり」にフェイルオープンさせる意図的な設計(コードレビューで、
  // 他パラメータより判定が緩いのではという指摘があったため明記。route/date/time/speedと
  // 異なり、correction単体の不正値でURL全体を無効にする設計にはしていない)
  const arrivalCorrectionEnabled = sp.get(PARAM_CORRECTION) !== '0';

  return {
    routeSource: { type: 'rwgps', routeId },
    selectedDate,
    selectedTime,
    averageSpeedKmh,
    arrivalCorrectionEnabled,
  };
}
