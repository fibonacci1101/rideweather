import { describe, expect, it } from 'vitest';
import {
  ELEVATION_CORRECTION_MINUTES_PER_100M,
  REST_MINUTES_PER_RIDING_HOUR,
  calculateArrivalTime,
  elevationGainAtDistances,
} from './calculateArrivalTime';
import type { TrackPoint } from './types';

const START = new Date('2026-06-01T08:00:00');

describe('calculateArrivalTime', () => {
  it('applyCorrection:falseは獲得標高を無視し「距離÷平均時速」の単純計算のみ返す', () => {
    // 20km/hで10km、獲得標高500mを渡してもOFF時は影響しない
    const arrival = calculateArrivalTime(START, 10_000, 20, 500, false);
    expect(arrival.getTime() - START.getTime()).toBe(30 * 60 * 1000);
  });

  it('applyCorrection:true・獲得標高0は平坦計算に休憩補正のみ上乗せする', () => {
    // 平坦30分(1800秒) → 休憩補正は移動時間(30分=0.5時間)×10分/時間 = 5分
    const arrival = calculateArrivalTime(START, 10_000, 20, 0, true);
    const expectedSeconds = 30 * 60 + 0.5 * REST_MINUTES_PER_RIDING_HOUR * 60;
    expect(arrival.getTime() - START.getTime()).toBe(expectedSeconds * 1000);
  });

  it('applyCorrection:true・獲得標高ありは獲得標高補正→休憩補正の順で加算する', () => {
    // 平坦30分(1800秒) + 獲得標高500m×4分/100m=20分(1200秒) = 移動50分(3000秒)
    // 休憩補正は移動時間(50/60時間)×10分/時間
    const flatSeconds = 30 * 60;
    const elevationSeconds = (500 / 100) * ELEVATION_CORRECTION_MINUTES_PER_100M * 60;
    const movingSeconds = flatSeconds + elevationSeconds;
    const restSeconds = (movingSeconds / 3600) * REST_MINUTES_PER_RIDING_HOUR * 60;

    const arrival = calculateArrivalTime(START, 10_000, 20, 500, true);
    expect(arrival.getTime() - START.getTime()).toBe((movingSeconds + restSeconds) * 1000);
  });

  it('applyCorrectionを省略するとtrue扱い(デフォルトON)', () => {
    const withDefault = calculateArrivalTime(START, 10_000, 20, 500);
    const explicitTrue = calculateArrivalTime(START, 10_000, 20, 500, true);
    expect(withDefault.getTime()).toBe(explicitTrue.getTime());
  });
});

describe('elevationGainAtDistances', () => {
  it('空のtrackPointsは全て0を返す', () => {
    expect(elevationGainAtDistances([], [0, 1000])).toEqual([0, 0]);
  });

  it('上りのみ加算し、下りは無視する(上りの標高差の合計)', () => {
    const trackPoints: TrackPoint[] = [
      { x: 0, y: 0, d: 0, e: 100 },
      { x: 0, y: 0, d: 1000, e: 300 }, // +200 (上り)
      { x: 0, y: 0, d: 2000, e: 150 }, // -150 (下り、無視)
      { x: 0, y: 0, d: 3000, e: 250 }, // +100 (上り)
    ];
    expect(elevationGainAtDistances(trackPoints, [1000, 2000, 3000])).toEqual([200, 200, 300]);
  });

  it('代表地点間の細かい登り下りも、間引き前の全trackPointsを見ることで拾う', () => {
    // 代表地点(0mと2000m)の標高だけを見ると差分は0(100→100)だが、間に100m登って100m下る
    // 峠がある。elevationGainAtDistancesはtrackPoints全体を走査するのでこれを拾えるはず
    const trackPoints: TrackPoint[] = [
      { x: 0, y: 0, d: 0, e: 100 },
      { x: 0, y: 0, d: 1000, e: 200 }, // +100
      { x: 0, y: 0, d: 2000, e: 100 }, // -100
    ];
    expect(elevationGainAtDistances(trackPoints, [2000])).toEqual([100]);
  });

  it('標高(e)が欠けている地点は直前の標高を引き継ぐ(差分0扱い)', () => {
    const trackPoints: TrackPoint[] = [
      { x: 0, y: 0, d: 0, e: 100 },
      { x: 0, y: 0, d: 1000 }, // eなし
      { x: 0, y: 0, d: 2000, e: 150 },
    ];
    expect(elevationGainAtDistances(trackPoints, [2000])).toEqual([50]);
  });

  it('目標距離がルート終点より先の場合はルート全体の累積獲得標高で埋める', () => {
    const trackPoints: TrackPoint[] = [
      { x: 0, y: 0, d: 0, e: 0 },
      { x: 0, y: 0, d: 1000, e: 100 },
    ];
    expect(elevationGainAtDistances(trackPoints, [1000, 999_999])).toEqual([100, 100]);
  });

  it('目標距離0(出発地点)は、まだ走査していない時点の累積獲得標高(0)を返す(最初の区間の標高差で汚染されない、コードレビューで発見)', () => {
    const trackPoints: TrackPoint[] = [
      { x: 0, y: 0, d: 0, e: 0 },
      { x: 0, y: 0, d: 50, e: 30 }, // 最初の区間の登り(+30)
      { x: 0, y: 0, d: 2000, e: 100 },
    ];
    expect(elevationGainAtDistances(trackPoints, [0, 2000])).toEqual([0, 100]);
  });

  it('先頭地点の標高が欠けている場合、最初に現れた実測標高を基準にし、架空の獲得標高を加算しない(コードレビューで発見したバグの回帰テスト)', () => {
    const trackPoints: TrackPoint[] = [
      { x: 0, y: 0, d: 0 }, // eなし(先頭)
      { x: 0, y: 0, d: 500 }, // eなし
      { x: 0, y: 0, d: 1000, e: 450 }, // 実測標高が初めて現れる地点。ここを基準にするだけで、
      // 基準確定前の区間を「0→450への登り」として加算してはならない
      { x: 0, y: 0, d: 1500, e: 500 }, // +50 (上り)
    ];
    expect(elevationGainAtDistances(trackPoints, [1000, 1500])).toEqual([0, 50]);
  });

  it('全地点の標高が欠けている場合は全区間0を返す', () => {
    const trackPoints: TrackPoint[] = [
      { x: 0, y: 0, d: 0 },
      { x: 0, y: 0, d: 1000 },
      { x: 0, y: 0, d: 2000 },
    ];
    expect(elevationGainAtDistances(trackPoints, [0, 1000, 2000])).toEqual([0, 0, 0]);
  });
});
