import { stripRouteFileExtension } from './gpxTcxParser';
import type { OfflineHistorySource, RouteSource, RouteWeatherParams, WeatherPoint } from './types';

const WIND_DIRECTION_LABELS = [
  '北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
  '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西',
];

export function getWindDirectionLabel(degree: number | undefined): string {
  if (degree === undefined || !Number.isFinite(degree)) return DASH;
  // JSの`%`は負数に対して負の値を返すため、+16した上で再度%16することで0-15に正規化する
  const index = ((Math.round(degree / 22.5) % 16) + 16) % 16;
  return WIND_DIRECTION_LABELS[index];
}

export const DASH = 'ー'; // 未取得値の表示。英語の"N/A"は和文UIに混ざると読みにくいため使わない

export function roundTemp(value: number | undefined): string {
  return value === undefined ? DASH : `${Math.round(value)}`;
}

// DateオブジェクトをブラウザのローカルタイムゾーンでYYYY-MM-DD/HH:mmに分解する。
// `toISOString()`はUTC基準になるため、UTC+9(JST等)では深夜0時〜9時台に日付がズレる
// (実際に発生したバグ)。日付・時刻をローカル値として扱いたい箇所は必ずこの関数を経由すること
export function getLocalDateTimeParts(date: Date): { date: string; time: string } {
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const hh = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

// "今日"のYYYY-MM-DDをブラウザのローカル日付で返す
export function getTodayLocalDateString(): string {
  return getLocalDateTimeParts(new Date()).date;
}

// 選択日が「今日より後」かどうかを判定する。
// どちらもYYYY-MM-DD形式(ゼロ埋め)であることが前提のため、Dateへの変換を挟まず
// 文字列のまま比較する(new Date()経由だとUTC解釈とローカル読み出しが混在し、
// JSTタイムゾーンバグと同種の問題を再発しうるため)
export function isDateAfterToday(selectedDate: string, todayString: string): boolean {
  return selectedDate > todayString;
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// sunrise/sunsetは地点のローカル時刻で表示する(ブラウザのタイムゾーンではなく)
export function formatUnixTimeAtLocation(
  unixSeconds: number | undefined,
  timezoneOffsetSeconds: number | undefined
): string {
  if (unixSeconds === undefined) return DASH;
  const localSeconds = unixSeconds + (timezoneOffsetSeconds ?? 0);
  const date = new Date(localSeconds * 1000);
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
}

// 日付(M/D)を地点のローカルタイムゾーンで返す。WeatherMatrixの列見出しで、
// 24時間を超える行程のときに同じ時刻ラベルが複数出て日を区別できなくなるのを防ぐ用途。
// formatUnixTimeAtLocationと同じくUTCゲッターで読み出す(オフセット加算済みのため)
export function formatUnixDateAtLocation(
  unixSeconds: number | undefined,
  timezoneOffsetSeconds: number | undefined
): string {
  if (unixSeconds === undefined) return DASH;
  const localSeconds = unixSeconds + (timezoneOffsetSeconds ?? 0);
  const date = new Date(localSeconds * 1000);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

// フォーム折りたたみ時のサマリー表示用(App.tsx)
export function formatSubmittedConditions(params: RouteWeatherParams): string {
  const dateLabel = params.selectedDate.replaceAll('-', '/');
  const routeLabel =
    params.routeSource?.type === 'upload'
      ? `ファイル ${params.routeSource.fileName}`
      : `ルートID ${params.routeSource?.routeId ?? ''}`;
  const conditions = [
    routeLabel,
    `走行日 ${dateLabel}`,
    `走行時間 ${params.selectedTime}`,
    `平均時速 ${params.averageSpeedKmh}km/h`,
  ];
  // 補正ONがデフォルトのため、通常時に毎回表示すると煩雑になる。OFF時のみ明示する(STEP7)
  if (!params.arrivalCorrectionEnabled) conditions.push('獲得標高・休憩の補正なし');
  return conditions.join(' ・ ');
}

// オフライン履歴のレコードが「RWGPS ルートID」か「アップロードファイル名」いずれ由来かを
// 表示用の一文に変換する(offlineHistory.ts参照)。RWGPSはtitle(ルート名)が取れていれば
// それを主表示にし、ルートIDは括弧書きで添える(識別・トラブルシュート用に残す、STEP5)。
// 旧形式(title無し)のレコードでも壊れないよう、無ければ従来通りルートIDのみにフォールバックする
export function formatOfflineHistorySourceLabel(source: OfflineHistorySource): string {
  if (source.type === 'upload') return source.fileName;
  return source.title ? `${source.title}(ID: ${source.routeId})` : `ルートID ${source.routeId}`;
}

// 画像保存ファイル名のサフィックス。RWGPSはルートID、アップロードはファイル名(拡張子除く)を使う。
// RouteSource(ライブ結果用)・OfflineHistorySource(履歴表示用)は必要なフィールドの形が
// 同じ(type + routeId/fileName)なので、共通のロジックとしてまとめている
export function exportFileNameSuffixFromSource(source: OfflineHistorySource): string {
  return source.type === 'rwgps' ? source.routeId : stripRouteFileExtension(source.fileName);
}

// オフライン履歴選択時のサマリー表示用(App.tsx)。formatSubmittedConditionsと同じ
// 整形ルール(日付のハイフン→スラッシュ変換等)を共有するため、格納形状は異なるが
// ここに並べて置く
export function formatOfflineHistoryConditions(record: {
  source: OfflineHistorySource;
  params: { selectedDate: string; selectedTime: string; averageSpeedKmh: number; arrivalCorrectionEnabled?: boolean };
}): string {
  const dateLabel = record.params.selectedDate.replaceAll('-', '/');
  // undefinedはSTEP7以前(補正機能が存在する前)に保存されたレコードを意味し、実際に
  // 補正なしの単純計算で保存されているため、明示的なfalseと同様に「補正なし」表示にする
  // (offlineHistory.tsのOfflineHistoryRecord.paramsのコメント参照)
  const correctionSuffix = record.params.arrivalCorrectionEnabled ? '' : ' ・ 獲得標高・休憩の補正なし';
  return `オフライン履歴: ${formatOfflineHistorySourceLabel(record.source)}(走行日 ${dateLabel} ・ 走行時間 ${record.params.selectedTime} ・ 平均時速 ${record.params.averageSpeedKmh}km/h${correctionSuffix})`;
}

// オフライン時のエラー文言(STEP3)。当初はアップロード由来のルートのみIndexedDBオフライン
// 履歴(STEP2)の対象だったが、「圏外の山中で出発前に見たルートを見返したい」という
// STEP3の想定シーンに合わせてRWGPSルートも履歴の保存対象に含めたため、入力元を問わず
// 案内文言を出す(ユーザーとの相談の上、STEP3完了後に対応)
export function offlineErrorMessage(routeSource: RouteSource | null): string {
  if (routeSource === null) return 'オフラインです。新しい天気情報は取得できません。';
  return 'オフラインです。新しい天気情報は取得できません。過去に一度天気情報を取得したルートであれば、フォーム内の「オフライン履歴」から確認できます。';
}

// IndexedDBの保存日時(ISO文字列)を表示用に整形する
export function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return savedAt;
  return date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

export type RouteSunTimes = {
  sunrise: string;
  sunset: string;
};

// 地点間で日の出・日の入りはほぼ同じ値になるため、カードごとの繰り返し表示はやめて
// ルート代表(最初に値が取れた地点)の1回だけ表示する
export function getRouteSunTimes(points: WeatherPoint[]): RouteSunTimes | null {
  const withSunTimes = points.find(
    (p) => p.weather?.sunrise !== undefined && p.weather?.sunset !== undefined
  );
  if (!withSunTimes?.weather) return null;

  return {
    sunrise: formatUnixTimeAtLocation(withSunTimes.weather.sunrise, withSunTimes.weather.timezoneOffsetSeconds),
    sunset: formatUnixTimeAtLocation(withSunTimes.weather.sunset, withSunTimes.weather.timezoneOffsetSeconds),
  };
}
