import { describe, expect, it } from 'vitest';
import {
  DASH,
  formatOfflineHistoryConditions,
  formatOfflineHistorySourceLabel,
  formatSubmittedConditions,
  formatUnixDateAtLocation,
  getRouteSunTimes,
  getWindDirectionLabel,
  offlineErrorMessage,
  roundTemp,
} from './format';
import type { NormalizedWeather, OfflineHistorySource, RouteSource, RouteWeatherParams, WeatherPoint } from './types';

function makePoint(overrides: Partial<WeatherPoint> = {}): WeatherPoint {
  return {
    lat: 0,
    lon: 0,
    name: '地点',
    distanceMeters: 0,
    estimatedArrivalTime: new Date().toISOString(),
    weather: null,
    ...overrides,
  };
}

describe('getWindDirectionLabel', () => {
  it('未定義ならダッシュを返す', () => {
    expect(getWindDirectionLabel(undefined)).toBe(DASH);
  });

  it('16方位を日本語表記で返す', () => {
    expect(getWindDirectionLabel(0)).toBe('北');
    expect(getWindDirectionLabel(90)).toBe('東');
    expect(getWindDirectionLabel(180)).toBe('南');
    expect(getWindDirectionLabel(270)).toBe('西');
    expect(getWindDirectionLabel(247.5)).toBe('西南西');
  });

  it('360度は北(0度)と同じ扱いになる', () => {
    expect(getWindDirectionLabel(360)).toBe('北');
  });

  it('負の角度でも例外にならず、360度を基準に正規化される', () => {
    expect(getWindDirectionLabel(-10)).toBe(getWindDirectionLabel(350));
  });

  it('NaN/Infinityはダッシュを返す(配列外参照にならない)', () => {
    expect(getWindDirectionLabel(NaN)).toBe(DASH);
    expect(getWindDirectionLabel(Infinity)).toBe(DASH);
  });
});

describe('roundTemp', () => {
  it('未定義ならダッシュを返す', () => {
    expect(roundTemp(undefined)).toBe(DASH);
  });

  it('小数点以下を四捨五入する', () => {
    expect(roundTemp(24.05)).toBe('24');
    expect(roundTemp(24.5)).toBe('25');
    expect(roundTemp(-1.6)).toBe('-2');
  });
});

describe('getRouteSunTimes', () => {
  it('sunrise/sunsetを持つ地点がなければnull', () => {
    expect(getRouteSunTimes([makePoint()])).toBeNull();
  });

  it('最初にsunrise/sunsetを持つ地点の値を地点ローカル時刻で返す', () => {
    const weather: NormalizedWeather = {
      sunrise: 1786250000,
      sunset: 1786300000,
      timezoneOffsetSeconds: 0,
    };
    const points = [makePoint({ weather: null }), makePoint({ weather })];
    const result = getRouteSunTimes(points);
    expect(result).not.toBeNull();
    expect(result?.sunrise).toMatch(/^\d{2}:\d{2}$/);
    expect(result?.sunset).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('offlineErrorMessage', () => {
  it('routeSourceがnullならオフライン履歴の案内を含めない', () => {
    expect(offlineErrorMessage(null)).toBe('オフラインです。新しい天気情報は取得できません。');
  });

  it('rwgpsルートもオフライン履歴への導線を案内に含める(RWGPSも保存対象のため)', () => {
    const routeSource: RouteSource = { type: 'rwgps', routeId: '123' };
    expect(offlineErrorMessage(routeSource)).toContain('オフライン履歴');
  });

  it('アップロードルートもオフライン履歴への導線を案内に含める', () => {
    const routeSource: RouteSource = { type: 'upload', fileId: 'f1', fileName: 'a.gpx', trackPoints: [] };
    expect(offlineErrorMessage(routeSource)).toContain('オフライン履歴');
  });
});

describe('formatOfflineHistorySourceLabel', () => {
  it('rwgpsはtitleが無ければルートIDのラベルを返す(STEP5より前の旧レコード互換)', () => {
    const source: OfflineHistorySource = { type: 'rwgps', routeId: '12345678' };
    expect(formatOfflineHistorySourceLabel(source)).toBe('ルートID 12345678');
  });

  it('rwgpsはtitleがあればルート名を主表示にし、ルートIDは括弧書きで添える(STEP5)', () => {
    const source: OfflineHistorySource = { type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' };
    expect(formatOfflineHistorySourceLabel(source)).toBe('琵琶湖一周(ID: 12345678)');
  });

  it('uploadはファイル名をそのまま返す', () => {
    const source: OfflineHistorySource = { type: 'upload', fileName: 'ride.gpx' };
    expect(formatOfflineHistorySourceLabel(source)).toBe('ride.gpx');
  });
});

describe('formatSubmittedConditions', () => {
  const BASE_PARAMS: RouteWeatherParams = {
    routeSource: { type: 'rwgps', routeId: '12345678' },
    selectedDate: '2026-08-20',
    selectedTime: '09:00',
    averageSpeedKmh: 20,
    arrivalCorrectionEnabled: true,
  };

  it('補正ありの場合は補正の言及なしで組み立てる(デフォルトのため煩雑にしない)', () => {
    expect(formatSubmittedConditions(BASE_PARAMS)).toBe(
      'ルートID 12345678 ・ 走行日 2026/08/20 ・ 走行時間 09:00 ・ 平均時速 20km/h'
    );
  });

  it('補正なしの場合は「獲得標高・休憩の補正なし」を明示する(STEP7)', () => {
    expect(formatSubmittedConditions({ ...BASE_PARAMS, arrivalCorrectionEnabled: false })).toBe(
      'ルートID 12345678 ・ 走行日 2026/08/20 ・ 走行時間 09:00 ・ 平均時速 20km/h ・ 獲得標高・休憩の補正なし'
    );
  });
});

describe('formatOfflineHistoryConditions', () => {
  it('rwgpsソースの条件文言を組み立てる(補正あり)', () => {
    const label = formatOfflineHistoryConditions({
      source: { type: 'rwgps', routeId: '12345678' },
      params: { selectedDate: '2026-08-20', selectedTime: '09:00', averageSpeedKmh: 20, arrivalCorrectionEnabled: true },
    });
    expect(label).toBe('オフライン履歴: ルートID 12345678(走行日 2026/08/20 ・ 走行時間 09:00 ・ 平均時速 20km/h)');
  });

  it('uploadソースの条件文言を組み立てる(補正あり)', () => {
    const label = formatOfflineHistoryConditions({
      source: { type: 'upload', fileName: 'ride.gpx' },
      params: { selectedDate: '2026-08-20', selectedTime: '09:00', averageSpeedKmh: 20, arrivalCorrectionEnabled: true },
    });
    expect(label).toBe('オフライン履歴: ride.gpx(走行日 2026/08/20 ・ 走行時間 09:00 ・ 平均時速 20km/h)');
  });

  it('arrivalCorrectionEnabled:falseは「補正なし」を明示する(STEP7)', () => {
    const label = formatOfflineHistoryConditions({
      source: { type: 'upload', fileName: 'ride.gpx' },
      params: { selectedDate: '2026-08-20', selectedTime: '09:00', averageSpeedKmh: 20, arrivalCorrectionEnabled: false },
    });
    expect(label).toBe(
      'オフライン履歴: ride.gpx(走行日 2026/08/20 ・ 走行時間 09:00 ・ 平均時速 20km/h ・ 獲得標高・休憩の補正なし)'
    );
  });

  it('arrivalCorrectionEnabled未設定(STEP7以前のレコード)も「補正なし」扱いにする', () => {
    const label = formatOfflineHistoryConditions({
      source: { type: 'upload', fileName: 'ride.gpx' },
      params: { selectedDate: '2026-08-20', selectedTime: '09:00', averageSpeedKmh: 20 },
    });
    expect(label).toBe(
      'オフライン履歴: ride.gpx(走行日 2026/08/20 ・ 走行時間 09:00 ・ 平均時速 20km/h ・ 獲得標高・休憩の補正なし)'
    );
  });
});

describe('formatUnixDateAtLocation', () => {
  it('未取得値はダッシュを返す', () => {
    expect(formatUnixDateAtLocation(undefined, 32400)).toBe(DASH);
  });

  it('地点のタイムゾーンで日付を返す(ブラウザのTZに依存しない)', () => {
    // 2026-08-15T00:00:00Z。JST(+9h)では 8/15 09:00
    const utcMidnight = Date.UTC(2026, 7, 15) / 1000;
    expect(formatUnixDateAtLocation(utcMidnight, 9 * 3600)).toBe('8/15');
  });

  it('タイムゾーン適用で日付がまたぐ場合も地点側の日付になる', () => {
    // 2026-08-15T20:00:00Z は JST では 8/16 05:00
    const evening = Date.UTC(2026, 7, 15, 20) / 1000;
    expect(formatUnixDateAtLocation(evening, 9 * 3600)).toBe('8/16');
  });

  // 24時間超の行程で同じ時刻ラベルが並ぶ問題(列見出しで日を区別できない)への対応
  it('24時間離れたバケットは異なる日付ラベルになる', () => {
    const base = Date.UTC(2026, 7, 15, 21) / 1000; // JSTで 8/16 06:00
    const nextDay = base + 24 * 3600;
    expect(formatUnixDateAtLocation(base, 9 * 3600)).toBe('8/16');
    expect(formatUnixDateAtLocation(nextDay, 9 * 3600)).toBe('8/17');
  });
});
