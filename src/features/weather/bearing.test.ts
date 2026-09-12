import { describe, expect, it } from 'vitest';
import { calculateBearing, calculateRouteBearing, classifyWindRelation } from './bearing';

describe('calculateBearing', () => {
  it('緯度が増える方向(北)への移動は0度', () => {
    expect(calculateBearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 5);
  });

  it('経度が増える方向(東)への移動は90度', () => {
    expect(calculateBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 5);
  });

  it('緯度が減る方向(南)への移動は180度', () => {
    expect(calculateBearing({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 5);
  });

  it('経度が減る方向(西)への移動は270度', () => {
    expect(calculateBearing({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 5);
  });

  it('同一地点間は0度(定義上の値、実用上は発生しない想定)', () => {
    expect(calculateBearing({ lat: 35, lon: 135 }, { lat: 35, lon: 135 })).toBeCloseTo(0, 5);
  });
});

describe('calculateRouteBearing', () => {
  it('空配列は空配列を返す', () => {
    expect(calculateRouteBearing([])).toEqual([]);
  });

  it('1地点のみの場合は進行方向を定義できないためundefinedで埋める', () => {
    expect(calculateRouteBearing([{ lat: 0, lon: 0 }])).toEqual([undefined]);
  });

  it('隣接する地点の座標が完全一致する場合、その区間はundefinedになる(架空の北向き固定を防ぐ)', () => {
    const points = [
      { lat: 35, lon: 135 },
      { lat: 35, lon: 135 }, // 1つ前と座標完全一致(GPS停止区間を想定)
      { lat: 36, lon: 135 },
    ];
    const bearings = calculateRouteBearing(points);
    expect(bearings[0]).toBeUndefined(); // 先頭は次の地点(=自分と同座標)への区間
    expect(bearings[1]).toBeUndefined(); // 直前の地点と座標完全一致
    expect(bearings[2]).toBeCloseTo(0, 5); // 直前の地点とは座標が異なるため通常通り計算される
  });

  it('先頭地点は次の地点への区間のベアリングを代用する', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 }, // 北へ
      { lat: 1, lon: 1 }, // 東へ
    ];
    const bearings = calculateRouteBearing(points);
    expect(bearings[0]).toBeCloseTo(calculateBearing(points[0], points[1]), 5);
    expect(bearings[0]).toBeCloseTo(0, 5);
  });

  it('2地点目以降は直前の地点からのベアリングを使う', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 1, lon: 1 },
    ];
    const bearings = calculateRouteBearing(points);
    expect(bearings[1]).toBeCloseTo(calculateBearing(points[0], points[1]), 5);
    expect(bearings[2]).toBeCloseTo(calculateBearing(points[1], points[2]), 5);
    // 緯度1度の地点での「経度を1度進む」移動は子午線収束の影響でごく僅かに90度から
    // ずれる(実際に計算式が球面上の大圏方位角を正しく計算している証拠でもある)。
    // ここでは概ね東向きであることのみ確認する
    expect(bearings[2]).toBeCloseTo(90, 1);
  });
});

describe('classifyWindRelation', () => {
  it('相対角度0度は向かい風', () => {
    expect(classifyWindRelation(0, 0)).toBe('headwind');
  });

  it('相対角度ちょうど45度は向かい風(境界含む)', () => {
    expect(classifyWindRelation(45, 0)).toBe('headwind');
  });

  it('相対角度46度は横風', () => {
    expect(classifyWindRelation(46, 0)).toBe('crosswind');
  });

  it('相対角度134度は横風', () => {
    expect(classifyWindRelation(134, 0)).toBe('crosswind');
  });

  it('相対角度ちょうど135度は追い風(境界含む)', () => {
    expect(classifyWindRelation(135, 0)).toBe('tailwind');
  });

  it('相対角度180度は追い風', () => {
    expect(classifyWindRelation(180, 0)).toBe('tailwind');
  });

  it('360度をまたぐ相対角度も正しく正規化される(向かい風)', () => {
    // bearing=350, wind=10 → 相対角度は-340→20度に正規化され向かい風
    expect(classifyWindRelation(10, 350)).toBe('headwind');
  });

  it('マイナス側の相対角度も正しく判定される(追い風)', () => {
    // bearing=170, wind=0 → 相対角度は-170度→絶対値170度で追い風
    expect(classifyWindRelation(0, 170)).toBe('tailwind');
  });

  it('windDegがNaNの場合は判定不能としてundefinedを返す(横風への誤判定を防ぐ)', () => {
    expect(classifyWindRelation(NaN, 0)).toBeUndefined();
  });

  it('bearingDegがNaNの場合は判定不能としてundefinedを返す', () => {
    expect(classifyWindRelation(90, NaN)).toBeUndefined();
  });
});
