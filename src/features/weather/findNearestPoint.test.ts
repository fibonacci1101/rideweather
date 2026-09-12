import { describe, expect, it } from 'vitest';
import { findNearestPointByDistance } from './findNearestPoint';
import type { WeatherPoint } from './types';

function makePoint(name: string, distanceMeters: number): WeatherPoint {
  return {
    lat: 0,
    lon: 0,
    name,
    distanceMeters,
    estimatedArrivalTime: new Date().toISOString(),
    weather: null,
  };
}

describe('findNearestPointByDistance', () => {
  it('空配列の場合はnullを返す', () => {
    expect(findNearestPointByDistance([], 10)).toBeNull();
  });

  it('ちょうど一致する地点があればそれを返す', () => {
    const points = [makePoint('A', 0), makePoint('B', 10_000), makePoint('C', 20_000)];
    expect(findNearestPointByDistance(points, 10)).toBe(points[1]);
  });

  it('中間の距離は最も近い地点を返す(手前寄り)', () => {
    const points = [makePoint('A', 0), makePoint('B', 10_000), makePoint('C', 30_000)];
    // 12kmは10km地点の方が30km地点より近い
    expect(findNearestPointByDistance(points, 12)).toBe(points[1]);
  });

  it('中間の距離は最も近い地点を返す(奥寄り)', () => {
    const points = [makePoint('A', 0), makePoint('B', 10_000), makePoint('C', 30_000)];
    // 25kmは30km地点の方が10km地点より近い
    expect(findNearestPointByDistance(points, 25)).toBe(points[2]);
  });

  it('ルート範囲外(先頭より手前)の距離でも先頭地点を返す', () => {
    const points = [makePoint('A', 5_000), makePoint('B', 15_000)];
    expect(findNearestPointByDistance(points, -10)).toBe(points[0]);
  });

  it('ルート範囲外(末尾より先)の距離でも末尾地点を返す', () => {
    const points = [makePoint('A', 5_000), makePoint('B', 15_000)];
    expect(findNearestPointByDistance(points, 1000)).toBe(points[1]);
  });

  it('1地点のみの場合は常にその地点を返す', () => {
    const points = [makePoint('A', 5_000)];
    expect(findNearestPointByDistance(points, 999)).toBe(points[0]);
  });
});
