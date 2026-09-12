import { describe, expect, it } from 'vitest';
import { extractKeyPoints } from './extractKeyPoints';
import type { TrackPoint } from './types';

function makeTrackPoints(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: i, y: i, d: i * 1000 }));
}

describe('extractKeyPoints', () => {
  it('デフォルト(fixedCount, 10)で先頭・末尾を含む10地点を等間隔抽出する', () => {
    const points = makeTrackPoints(100);
    const result = extractKeyPoints(points);

    expect(result).toHaveLength(10);
    expect(result[0]).toEqual(points[0]);
    expect(result[9]).toEqual(points[99]);
  });

  it('要求地点数が総地点数以上の場合は全地点を返す', () => {
    const points = makeTrackPoints(5);
    const result = extractKeyPoints(points, { mode: 'fixedCount', count: 10 });

    expect(result).toEqual(points);
  });

  it('count が1の場合は先頭の地点のみ返す', () => {
    const points = makeTrackPoints(10);
    const result = extractKeyPoints(points, { mode: 'fixedCount', count: 1 });

    expect(result).toEqual([points[0]]);
  });

  it('空配列の場合は空配列を返す', () => {
    expect(extractKeyPoints([])).toEqual([]);
  });

  it('count が0の場合は空配列を返す', () => {
    const points = makeTrackPoints(10);
    expect(extractKeyPoints(points, { mode: 'fixedCount', count: 0 })).toEqual([]);
  });

  it('count が負数の場合は空配列を返す', () => {
    const points = makeTrackPoints(10);
    expect(extractKeyPoints(points, { mode: 'fixedCount', count: -1 })).toEqual([]);
  });

  it('track_pointsが1件のみの場合はその1件を返す', () => {
    const points = makeTrackPoints(1);
    expect(extractKeyPoints(points, { mode: 'fixedCount', count: 10 })).toEqual(points);
  });

  it('要求地点数が総地点数以上の場合、返り値は元配列と別参照になる(呼び出し側の変更で元データが壊れないように)', () => {
    const points = makeTrackPoints(5);
    const result = extractKeyPoints(points, { mode: 'fixedCount', count: 10 });
    expect(result).not.toBe(points);
  });

  it('byDistance戦略は未実装のためエラーを投げる', () => {
    const points = makeTrackPoints(10);
    expect(() =>
      extractKeyPoints(points, { mode: 'byDistance', intervalMeters: 20000 })
    ).toThrow();
  });
});
