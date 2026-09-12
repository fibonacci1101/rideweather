import { describe, expect, it } from 'vitest';
import { decimateElevationProfile } from './decimateElevationProfile';
import type { TrackPoint } from './types';

function makePoint(d: number, e: number): TrackPoint {
  return { x: 0, y: 0, d, e };
}

describe('decimateElevationProfile', () => {
  it('空配列の場合は空配列を返す', () => {
    expect(decimateElevationProfile([])).toEqual([]);
  });

  it('標高・距離が欠けている点は除外する', () => {
    const points: TrackPoint[] = [
      makePoint(0, 10),
      { x: 0, y: 0, d: 100 }, // 標高なし
      { x: 0, y: 0, e: 20 }, // 距離なし
      makePoint(200, 30),
    ];
    const result = decimateElevationProfile(points);
    expect(result.every((p) => typeof p.d === 'number' && typeof p.e === 'number')).toBe(true);
    expect(result).toEqual([
      { d: 0, e: 10 },
      { d: 200, e: 30 },
    ]);
  });

  it('総距離が0の場合はそのまま返す(バケット分割できないため)', () => {
    const points = [makePoint(0, 10), makePoint(0, 20)];
    expect(decimateElevationProfile(points)).toEqual([
      { d: 0, e: 10 },
      { d: 0, e: 20 },
    ]);
  });

  it('点数が少なければ実質そのまま残る', () => {
    const points = [makePoint(0, 10), makePoint(500, 50), makePoint(1000, 20)];
    const result = decimateElevationProfile(points);
    expect(result).toEqual([
      { d: 0, e: 10 },
      { d: 500, e: 50 },
      { d: 1000, e: 20 },
    ]);
  });

  it('出力は距離の昇順を保つ', () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 20000; i++) {
      points.push(makePoint(i * 30, Math.sin(i / 200) * 400 + 500));
    }
    const result = decimateElevationProfile(points);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].d).toBeGreaterThanOrEqual(result[i - 1].d);
    }
  });

  it('ルート長によらず点数が上限内に収まる', () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 40000; i++) {
      points.push(makePoint(i * 15, (i % 500) - 250));
    }
    const result = decimateElevationProfile(points);
    expect(result.length).toBeLessThanOrEqual(700 * 2);
  });

  // 等間隔抽出だとピークが漏れて山が平坦に潰れる問題(600kmブルベで顕在化)への回帰テスト
  it('鋭いピークが間引きで失われない', () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 30000; i++) {
      // 1点だけ突出した山を混ぜる
      points.push(makePoint(i * 20, i === 12345 ? 3000 : 100));
    }
    const result = decimateElevationProfile(points);
    expect(Math.max(...result.map((p) => p.e))).toBe(3000);
  });

  // バケット内で極値でない始点・終点が脱落し、グラフが途中で終わって
  // ゴール標高が別地点の値で表示されるバグへの回帰テスト
  it('始点と終点は極値でなくても必ず保持される', () => {
    const points: TrackPoint[] = [];
    // 先頭バケット: 始点(400m)より低い点と高い点が後続する
    points.push(makePoint(0, 400));
    points.push(makePoint(10, 10));
    points.push(makePoint(20, 900));
    for (let i = 1; i < 7000; i++) {
      points.push(makePoint(i * 100, 500));
    }
    // 最終バケット: 終点(400m)より低い点と高い点が先行する
    points.push(makePoint(699950, 10));
    points.push(makePoint(699980, 900));
    points.push(makePoint(700000, 400));

    const result = decimateElevationProfile(points);
    expect(result[0]).toEqual({ d: 0, e: 400 });
    expect(result[result.length - 1]).toEqual({ d: 700000, e: 400 });
  });

  it('始点・終点が極値の場合に重複して積まれない', () => {
    const points: TrackPoint[] = [];
    points.push(makePoint(0, 0)); // 全体の最低 = 始点
    for (let i = 1; i < 5000; i++) {
      points.push(makePoint(i * 100, 300));
    }
    points.push(makePoint(500000, 1000)); // 全体の最高 = 終点

    const result = decimateElevationProfile(points);
    expect(result.filter((p) => p.d === 0)).toHaveLength(1);
    expect(result.filter((p) => p.d === 500000)).toHaveLength(1);
  });

  it('鋭い谷も同様に保持される', () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 30000; i++) {
      points.push(makePoint(i * 20, i === 7777 ? -50 : 800));
    }
    const result = decimateElevationProfile(points);
    expect(Math.min(...result.map((p) => p.e))).toBe(-50);
  });
});
