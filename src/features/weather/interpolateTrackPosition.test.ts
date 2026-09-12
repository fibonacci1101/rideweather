import { describe, expect, it } from 'vitest';
import { filterPointsWithDistance, interpolateTrackPosition } from './interpolateTrackPosition';
import type { TrackPoint } from './types';

function makePoint(x: number, y: number, d: number): TrackPoint {
  return { x, y, d };
}

describe('interpolateTrackPosition', () => {
  it('空配列の場合はnullを返す', () => {
    expect(interpolateTrackPosition([], 100)).toBeNull();
  });

  it('dを持つ点が1つも無い場合はnullを返す', () => {
    expect(interpolateTrackPosition([{ x: 135, y: 35 }], 100)).toBeNull();
  });

  it('ちょうど一致する距離の点はそのまま返す', () => {
    const points = [makePoint(135, 35, 0), makePoint(136, 36, 1000), makePoint(137, 37, 2000)];
    expect(interpolateTrackPosition(points, 1000)).toEqual({ lat: 36, lon: 136 });
  });

  it('中間の距離は2点間を線形補間する', () => {
    const points = [makePoint(0, 0, 0), makePoint(10, 20, 1000)];
    // 250m地点(全体の25%)は(0,0)と(10,20)の25%内分点
    expect(interpolateTrackPosition(points, 250)).toEqual({ lat: 5, lon: 2.5 });
  });

  it('先頭より手前の距離は先頭地点にクランプする', () => {
    const points = [makePoint(135, 35, 500), makePoint(136, 36, 1500)];
    expect(interpolateTrackPosition(points, -100)).toEqual({ lat: 35, lon: 135 });
  });

  it('末尾より先の距離は末尾地点にクランプする', () => {
    const points = [makePoint(135, 35, 500), makePoint(136, 36, 1500)];
    expect(interpolateTrackPosition(points, 9999)).toEqual({ lat: 36, lon: 136 });
  });

  it('dを持たない点(標高等が欠落した点)は無視して補間する', () => {
    const points: TrackPoint[] = [
      makePoint(0, 0, 0),
      { x: 999, y: 999 }, // dが無い点。補間対象から除外されるべき
      makePoint(10, 20, 1000),
    ];
    expect(interpolateTrackPosition(points, 500)).toEqual({ lat: 10, lon: 5 });
  });

  it('dが昇順でない(逆行する)場合は補間せずnullを返す(壊れた入力を安全側に倒す)', () => {
    const points: TrackPoint[] = [makePoint(0, 0, 0), makePoint(10, 20, 1000), makePoint(5, 10, 500)];
    expect(interpolateTrackPosition(points, 250)).toBeNull();
  });

  it('filterPointsWithDistanceはdが昇順でない場合に空配列を返す', () => {
    const points: TrackPoint[] = [makePoint(0, 0, 1000), makePoint(10, 20, 500)];
    expect(filterPointsWithDistance(points)).toEqual([]);
  });

  it('多数の点(数万点規模)でも正しく補間できる(二分探索の境界確認)', () => {
    const points: TrackPoint[] = Array.from({ length: 50_000 }, (_, i) => makePoint(i, i, i * 10));
    // 500,005m地点は index 50000と50001の間...ではなく範囲外(最大49999*10=499990)なので
    // 範囲内の値で検証する
    const result = interpolateTrackPosition(points, 123_455);
    expect(result).not.toBeNull();
    expect(result!.lon).toBeCloseTo(12345.5, 5);
    expect(result!.lat).toBeCloseTo(12345.5, 5);
  });
});
