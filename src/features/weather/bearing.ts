type LatLon = { lat: number; lon: number };

// 大圏方位角(0〜360度、真北基準)を算出する。地球を球体として近似する標準的な公式を使う。
// 本アプリが扱うルート規模(国内、最大でも数千km)では楕円体補正の誤差は無視できるため、
// シンプルな球体近似で十分と判断した
export function calculateBearing(from: LatLon, to: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLon = toRad(to.lon - from.lon);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearingRad = Math.atan2(y, x);
  return ((bearingRad * 180) / Math.PI + 360) % 360;
}

// 各地点の「進行方向ベアリング」を算出する。地点間は代表地点(既定10点)同士の直線距離で
// 十分と判断した(壁打ちの結論: 矢印アイコンが小さく、TrackPoint単位の精度差は体感できない
// ため。plans/STEP6_IMPLEMENTATION_PLAN.md 1.1参照)。出発地点(先頭)は「まだ来た方向」が
// 無いため、次の地点への区間で代用する。
// 戻り値がundefinedの地点は「進行方向を定義できない」ことを表す(区間の始点・終点の座標が
// 完全一致する、または代表地点が1つしかない場合)。0度(北向き)で埋めると、GPSロガーが
// 停止中(信号待ち・休憩)も記録し続けることで代表地点抽出が同じ停止区間から2点を選んだ場合に
// 「架空の北向き」が向かい風/追い風判定の根拠として使われてしまう不具合があった
// (コードレビューで発見。IEEE754の浮動小数点演算の性質上、座標完全一致時は決定論的に0度になる)
export function calculateRouteBearing(points: LatLon[]): (number | undefined)[] {
  if (points.length === 0) return [];
  // 代表地点が1つしかないルートは進行方向を定義できないため明示的にundefinedで埋める
  if (points.length === 1) return [undefined];

  return points.map((point, index) => {
    const from = index === 0 ? point : points[index - 1];
    const to = index === 0 ? points[1] : point;
    if (from.lat === to.lat && from.lon === to.lon) return undefined;
    return calculateBearing(from, to);
  });
}

export type WindRelation = 'headwind' | 'tailwind' | 'crosswind';

// 向かい風/追い風の判定閾値(度)。相対角度がこの範囲内なら向かい風、180度を挟んでこの範囲内
// なら追い風、それ以外(45〜135度)は横風とする3分割。4〜5段階への細分化は
// plans/STEP6_IMPLEMENTATION_PLAN.md 1.1の通り今回はスコープ外
const HEADWIND_THRESHOLD_DEG = 45;

// 角度差を-180〜180度の範囲に正規化する
function normalizeAngle(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

// wind.deg(気象学の慣例で「風が吹いてくる方向」)と進行方向ベアリングの相対角度から
// 向かい風・追い風・横風の3分類を判定する。相対角度が0度に近い(=風が向かってくる方向と
// 進行方向が一致)ほど向かい風、180度に近い(=風が背中から吹いている)ほど追い風になる。
// windDeg/bearingDegが非有限値(NaN等)の場合は判定不能としてundefinedを返す
// (コードレビューで発見: 非有限値のまま比較すると全比較がfalseになり、デフォルト分岐の
// 「横風」に静かに落ちて根拠のない具体的な判定を表示してしまう)
export function classifyWindRelation(windDeg: number, bearingDeg: number): WindRelation | undefined {
  if (!Number.isFinite(windDeg) || !Number.isFinite(bearingDeg)) return undefined;
  const absDiff = Math.abs(normalizeAngle(windDeg - bearingDeg));
  if (absDiff <= HEADWIND_THRESHOLD_DEG) return 'headwind';
  if (absDiff >= 180 - HEADWIND_THRESHOLD_DEG) return 'tailwind';
  return 'crosswind';
}
