import { describe, expect, it } from 'vitest';
import { buildPointWarningSummaries, getPointWarnings, getTemperatureSwing, isNightIcon } from './warnings';
import type { NormalizedWeather, WeatherPoint } from './types';

describe('isNightIcon', () => {
  it('末尾がnなら夜間と判定する(STEP5レビュー対応: WeatherMatrix.tsxと共通化)', () => {
    expect(isNightIcon([{ id: 800, main: 'Clear', description: '晴れ', icon: '01n' }])).toBe(true);
  });

  it('末尾がdなら夜間ではないと判定する', () => {
    expect(isNightIcon([{ id: 800, main: 'Clear', description: '晴れ', icon: '01d' }])).toBe(false);
  });

  it('conditionsが未定義/空配列でもクラッシュせずfalseを返す', () => {
    expect(isNightIcon(undefined)).toBe(false);
    expect(isNightIcon([])).toBe(false);
  });
});

function makeWeather(overrides: Partial<NormalizedWeather> = {}): NormalizedWeather {
  return {
    main: { temp: 20, feels_like: 20 },
    wind: { speed: 1, deg: 0 },
    ...overrides,
  };
}

function makePoint(overrides: Partial<WeatherPoint> = {}): WeatherPoint {
  return {
    lat: 0,
    lon: 0,
    name: '地点',
    distanceMeters: 0,
    estimatedArrivalTime: new Date().toISOString(),
    weather: makeWeather(),
    ...overrides,
  };
}

describe('getPointWarnings', () => {
  it('天気データがnullなら警告なし', () => {
    expect(getPointWarnings(null)).toEqual([]);
  });

  it('穏やかな天気なら警告なし', () => {
    expect(getPointWarnings(makeWeather())).toEqual([]);
  });

  it('降水確率50%ちょうどで警告になる', () => {
    expect(getPointWarnings(makeWeather({ pop: 0.5 }))).toContain('rain-probability');
    expect(getPointWarnings(makeWeather({ pop: 0.49 }))).not.toContain('rain-probability');
  });

  it('風速は4m/s超で警告(4.0ちょうどは対象外)', () => {
    expect(getPointWarnings(makeWeather({ wind: { speed: 4, deg: 0 } }))).not.toContain('wind');
    expect(getPointWarnings(makeWeather({ wind: { speed: 4.1, deg: 0 } }))).toContain('wind');
  });

  it('降水量1mm以上で警告', () => {
    expect(getPointWarnings(makeWeather({ rainMm: 1 }))).toContain('rain-amount');
    expect(getPointWarnings(makeWeather({ rainMm: 0.9 }))).not.toContain('rain-amount');
  });

  it('体感温度33℃以上で高温警告(32.9は対象外)', () => {
    expect(getPointWarnings(makeWeather({ main: { temp: 30, feels_like: 33 } }))).toContain('heat');
    expect(
      getPointWarnings(makeWeather({ main: { temp: 30, feels_like: 32.9 } }))
    ).not.toContain('heat');
  });

  it('体感温度5℃以下で低温警告(5.1は対象外)', () => {
    expect(getPointWarnings(makeWeather({ main: { temp: 6, feels_like: 5 } }))).toContain('cold');
    expect(
      getPointWarnings(makeWeather({ main: { temp: 6, feels_like: 5.1 } }))
    ).not.toContain('cold');
  });

  it('複数条件に該当する場合はすべて返す', () => {
    const reasons = getPointWarnings(
      makeWeather({ pop: 0.8, wind: { speed: 5, deg: 0 }, rainMm: 2 })
    );
    expect(reasons).toEqual(
      expect.arrayContaining(['rain-probability', 'wind', 'rain-amount'])
    );
  });

  it('天気アイコンが夜間(末尾n)なら夜間警告になる(STEP5)', () => {
    expect(
      getPointWarnings(makeWeather({ weather: [{ id: 800, main: 'Clear', description: '晴れ', icon: '01n' }] }))
    ).toContain('night');
  });

  it('天気アイコンが日中(末尾d)なら夜間警告にならない(STEP5)', () => {
    expect(
      getPointWarnings(makeWeather({ weather: [{ id: 800, main: 'Clear', description: '晴れ', icon: '01d' }] }))
    ).not.toContain('night');
  });

  it('天気アイコン自体が無い場合は夜間警告にならない(クラッシュしない、STEP5)', () => {
    expect(getPointWarnings(makeWeather({ weather: [] }))).not.toContain('night');
    expect(getPointWarnings(makeWeather())).not.toContain('night');
  });
});

describe('getTemperatureSwing', () => {
  it('地点が0件ならnull', () => {
    expect(getTemperatureSwing([])).toBeNull();
  });

  it('地点が1つ以下ならnull', () => {
    expect(getTemperatureSwing([makePoint()])).toBeNull();
  });

  it('気温差が10℃未満ならnull', () => {
    const points = [
      makePoint({ name: 'A', weather: makeWeather({ main: { temp: 20, feels_like: 20 } }) }),
      makePoint({ name: 'B', weather: makeWeather({ main: { temp: 25, feels_like: 25 } }) }),
    ];
    expect(getTemperatureSwing(points)).toBeNull();
  });

  it('気温差がちょうど9℃ならnull(10℃境界の1つ内側)', () => {
    const points = [
      makePoint({ name: 'A', weather: makeWeather({ main: { temp: 24, feels_like: 24 } }) }),
      makePoint({ name: 'B', weather: makeWeather({ main: { temp: 15, feels_like: 15 } }) }),
    ];
    expect(getTemperatureSwing(points)).toBeNull();
  });

  it('気温差がちょうど10℃なら最高・最低地点を返す(境界ちょうど)', () => {
    const points = [
      makePoint({ name: 'A', weather: makeWeather({ main: { temp: 25, feels_like: 25 } }) }),
      makePoint({ name: 'B', weather: makeWeather({ main: { temp: 15, feels_like: 15 } }) }),
    ];
    const swing = getTemperatureSwing(points);
    expect(swing).not.toBeNull();
    expect(swing?.diffC).toBe(10);
  });

  it('気温差が10℃以上なら最高・最低地点を返す', () => {
    const points = [
      makePoint({ name: 'A', weather: makeWeather({ main: { temp: 25, feels_like: 26 } }) }),
      makePoint({ name: 'B', weather: makeWeather({ main: { temp: 15, feels_like: 15 } }) }),
      makePoint({ name: 'C', weather: makeWeather({ main: { temp: 20, feels_like: 20 } }) }),
    ];
    const swing = getTemperatureSwing(points);
    expect(swing).not.toBeNull();
    expect(swing?.diffC).toBe(11);
    expect(swing?.maxPoint.name).toBe('A');
    expect(swing?.minPoint.name).toBe('B');
  });
});

describe('buildPointWarningSummaries', () => {
  it('警告がなければ空配列', () => {
    const points = [makePoint({ name: 'A' }), makePoint({ name: 'B' })];
    expect(buildPointWarningSummaries(points)).toEqual([]);
  });

  it('該当地点が1つなら地点名のみのメッセージになる', () => {
    const points = [
      makePoint({ name: 'A', distanceMeters: 0 }),
      makePoint({ name: 'B', distanceMeters: 1000, weather: makeWeather({ pop: 0.9 }) }),
    ];
    const summaries = buildPointWarningSummaries(points);
    expect(summaries).toContainEqual({
      reason: 'rain-probability',
      message: 'Bで降水確率50%以上',
    });
  });

  it('該当地点が複数(距離順で先頭〜末尾)なら範囲表記になる', () => {
    const points = [
      makePoint({ name: 'A', distanceMeters: 0 }),
      makePoint({ name: 'B', distanceMeters: 1000, weather: makeWeather({ wind: { speed: 5, deg: 0 } }) }),
      makePoint({ name: 'C', distanceMeters: 2000, weather: makeWeather({ wind: { speed: 6, deg: 0 } }) }),
    ];
    const summaries = buildPointWarningSummaries(points);
    expect(summaries).toContainEqual({ reason: 'wind', message: 'B〜Cで風速4m/s超' });
  });

  it('該当地点が非連続の場合は連続区間ごとに分けて列挙する(先頭〜末尾のひとまとめにしない)', () => {
    const points = [
      makePoint({ name: 'A', distanceMeters: 0, weather: makeWeather({ wind: { speed: 5, deg: 0 } }) }),
      makePoint({ name: 'B', distanceMeters: 1000 }),
      makePoint({ name: 'C', distanceMeters: 2000 }),
      makePoint({ name: 'D', distanceMeters: 3000, weather: makeWeather({ wind: { speed: 5, deg: 0 } }) }),
    ];
    const summaries = buildPointWarningSummaries(points);
    expect(summaries).toContainEqual({ reason: 'wind', message: 'A、Dで風速4m/s超' });
  });

  it('夜間到着の地点は「夜間の到着」として要約に含まれる(STEP5)', () => {
    const points = [
      makePoint({ name: 'A', distanceMeters: 0 }),
      makePoint({
        name: 'B',
        distanceMeters: 1000,
        weather: makeWeather({ weather: [{ id: 800, main: 'Clear', description: '晴れ', icon: '01n' }] }),
      }),
    ];
    const summaries = buildPointWarningSummaries(points);
    expect(summaries).toContainEqual({ reason: 'night', message: 'Bで夜間の到着(ライト点灯推奨)' });
  });

  it('気温差警告は含まれない(getTemperatureSwingで別途扱う)', () => {
    const points = [
      makePoint({ name: 'A', distanceMeters: 0, weather: makeWeather({ main: { temp: 28, feels_like: 28 } }) }),
      makePoint({ name: 'B', distanceMeters: 1000, weather: makeWeather({ main: { temp: 15, feels_like: 15 } }) }),
    ];
    const summaries = buildPointWarningSummaries(points);
    expect(summaries.some((s) => (s.reason as string) === 'temp-swing')).toBe(false);
  });
});
