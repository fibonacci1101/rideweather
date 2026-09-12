import { describe, expect, it } from 'vitest';
import { interpolateForecastEntry, selectNearbyForecastEntries } from './forecast';

function makeEntry(dt: number, temp: number, windSpeed: number, pop: number) {
  return {
    dt,
    main: { temp, feels_like: temp - 1 },
    wind: { speed: windSpeed, deg: dt }, // degはバケットごとに変える(近い方が採用されることの確認用)
    pop,
    weather: [{ id: dt, main: 'x', description: `desc-${dt}`, icon: 'icon' }],
  };
}

describe('interpolateForecastEntry', () => {
  it('空配列の場合はnullを返す', () => {
    expect(interpolateForecastEntry([], 100)).toBeNull();
  });

  it('予報範囲より未来の対象時刻はnullを返す', () => {
    const list = [makeEntry(100, 20, 2, 0.1), makeEntry(200, 22, 3, 0.2)];
    expect(interpolateForecastEntry(list, 500)).toBeNull();
  });

  it('対象時刻が予報開始より前でも許容差(1.5h)以内なら最初のバケットの値を使う(dtはクエリした対象時刻で統一)', () => {
    const list = [makeEntry(100, 20, 2, 0.1), makeEntry(200, 22, 3, 0.2)];
    const result = interpolateForecastEntry(list, 50);
    expect(result).toEqual({ ...list[0], dt: 50 });
  });

  it('対象時刻が予報開始より許容差(1.5h)を超えて過去ならnullを返す(過去の時刻を「今」の予報にスナップさせない)', () => {
    const grace = 90 * 60;
    const list = [makeEntry(grace + 1, 20, 2, 0.1), makeEntry(grace * 2, 22, 3, 0.2)];
    expect(interpolateForecastEntry(list, 0)).toBeNull();
    // 境界: ちょうど1.5h前は代用可
    expect(interpolateForecastEntry([makeEntry(grace, 20, 2, 0.1)], 0)).toEqual({
      ...makeEntry(grace, 20, 2, 0.1),
      dt: 0,
    });
    // バケット幅(3h)前は代用しない(日没前の到着に夜バケットが付く誤りを防ぐ。レビューF-01)
    expect(interpolateForecastEntry([makeEntry(3 * 60 * 60, 20, 2, 0.1)], 0)).toBeNull();
  });

  it('ぴったり一致するバケットがあればそのまま返す', () => {
    const list = [makeEntry(100, 20, 2, 0.1), makeEntry(200, 22, 3, 0.2)];
    const result = interpolateForecastEntry(list, 100);
    expect(result).not.toBeNull();
    const entry = result!;
    expect(entry.dt).toBe(100);
    expect((entry.main as { temp: number }).temp).toBe(20);
  });

  it('中間時刻は気温・風速・降水確率を線形補間する', () => {
    const list = [makeEntry(0, 20, 2, 0.2), makeEntry(300, 26, 5, 0.5)];
    const result = interpolateForecastEntry(list, 100); // 全体の1/3地点
    expect(result).not.toBeNull();
    const entry = result!;
    expect(entry.dt).toBe(100);
    expect((entry.main as { temp: number }).temp).toBeCloseTo(22, 5);
    expect((entry.wind as { speed: number }).speed).toBeCloseTo(3, 5);
    expect(entry.pop).toBeCloseTo(0.3, 5);
  });

  it('近い方のバケットの天気アイコン・風向きを踏襲する(50%未満は前方)', () => {
    const list = [makeEntry(0, 20, 2, 0.2), makeEntry(300, 26, 5, 0.5)];
    const result = interpolateForecastEntry(list, 100); // 前方(dt=0)に近い
    expect(result).not.toBeNull();
    const entry = result!;
    expect((entry.weather as Array<{ description: string }>)[0].description).toBe('desc-0');
    expect((entry.wind as { deg: number }).deg).toBe(0);
  });

  it('近い方のバケットの天気アイコン・風向きを踏襲する(50%超は後方)', () => {
    const list = [makeEntry(0, 20, 2, 0.2), makeEntry(300, 26, 5, 0.5)];
    const result = interpolateForecastEntry(list, 200); // 後方(dt=300)に近い
    expect(result).not.toBeNull();
    const entry = result!;
    expect((entry.weather as Array<{ description: string }>)[0].description).toBe('desc-300');
    expect((entry.wind as { deg: number }).deg).toBe(300);
  });
});

describe('selectNearbyForecastEntries', () => {
  const list = [
    makeEntry(0, 10, 1, 0.1),
    makeEntry(10800, 12, 1, 0.1), // +3h
    makeEntry(21600, 14, 1, 0.1), // +6h
    makeEntry(32400, 16, 1, 0.1), // +9h
    makeEntry(43200, 18, 1, 0.1), // +12h
  ];

  it('windowSecondsが0以下なら空配列を返す', () => {
    expect(selectNearbyForecastEntries(list, 21600, 0)).toEqual([]);
    expect(selectNearbyForecastEntries(list, 21600, -1)).toEqual([]);
  });

  it('対象時刻から±window以内のバケットをdt昇順で返す', () => {
    const result = selectNearbyForecastEntries(list, 21600, 10800); // 中心+6h、±3h
    expect(result.map((e) => e.dt)).toEqual([10800, 21600, 32400]);
  });

  it('windowが広ければ範囲内の全バケットを返す', () => {
    const result = selectNearbyForecastEntries(list, 21600, 43200); // ±12h
    expect(result.map((e) => e.dt)).toEqual([0, 10800, 21600, 32400, 43200]);
  });

  it('windowが狭ければ完全一致のバケットのみ返す', () => {
    const result = selectNearbyForecastEntries(list, 21600, 0.5);
    expect(result.map((e) => e.dt)).toEqual([21600]);
  });

  it('該当バケットがなければ空配列を返す', () => {
    const result = selectNearbyForecastEntries(list, 1_000_000, 100);
    expect(result).toEqual([]);
  });

  it('入力配列を破壊しない(元の順序を変えない)', () => {
    const shuffled = [list[2], list[0], list[4], list[1], list[3]];
    const original = [...shuffled];
    selectNearbyForecastEntries(shuffled, 21600, 43200);
    expect(shuffled).toEqual(original);
  });
});
