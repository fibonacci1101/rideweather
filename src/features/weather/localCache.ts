const STORAGE_KEY = 'ride-weather-app:lastInput';
const ROUTE_ID_PATTERN = /^\d+$/;

type CachedInput = {
  routeId: string;
  averageSpeedKmh: number;
};

// 出先での再入力の手間を減らすため、直近送信したルートID・平均時速をブラウザに保存する。
// 走行日・時刻は毎回変わるため対象外(今日・現在時刻を初期値にする既存の挙動をそのまま活かす)
export function loadCachedInput(): CachedInput | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedInput> | null;
    if (
      typeof parsed?.routeId !== 'string' ||
      !ROUTE_ID_PATTERN.test(parsed.routeId) ||
      typeof parsed.averageSpeedKmh !== 'number' ||
      !Number.isFinite(parsed.averageSpeedKmh) ||
      parsed.averageSpeedKmh <= 0
    ) {
      return null;
    }
    return { routeId: parsed.routeId, averageSpeedKmh: parsed.averageSpeedKmh };
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない環境でも致命的にしない
    return null;
  }
}

export function saveCachedInput(input: CachedInput): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  } catch {
    // 保存できなくても機能に支障はないため無視する
  }
}
