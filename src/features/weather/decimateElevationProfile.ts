import type { TrackPoint } from './types';

// 標高が確定している(グラフに描ける)点だけを扱うための型
export type ElevationPoint = { d: number; e: number };

// 標高グラフの実描画幅の目安(px)。1ピクセル列あたり1バケットにすることで、
// 間引き後も「画面上で見える輪郭」が全点描画と一致する(実測: 600kmブルベで
// 最大ズレ0m・データ欠けの列0本)。これ以上細かくしてもピクセルに載らない
const BUCKET_COUNT = 700;

/**
 * 標高プロファイルを表示用に間引く。
 *
 * 単純な等間隔抽出だと山や谷のピークが抽出対象から漏れて山岳ルートが平坦に潰れる
 * (実測: 600kmブルベを500点に等間隔抽出すると獲得標高が真値の36%まで落ち、
 * 幅700pxのグラフ上でも最大64mズレ・228列がデータ欠けになった)。
 *
 * そのため「距離」で等分したバケットごとに最高地点と最低地点の2点を残す方式にしている。
 * X軸が距離なのでバケット境界はそのままピクセル列の境界に対応し、各列で描かれる
 * 標高の上端・下端が保存される。ルート長に関係なく出力は最大 BUCKET_COUNT * 2 点。
 */
export function decimateElevationProfile(trackPoints: TrackPoint[]): ElevationPoint[] {
  const points: ElevationPoint[] = [];
  for (const p of trackPoints) {
    if (typeof p.d === 'number' && typeof p.e === 'number') {
      points.push({ d: p.d, e: p.e });
    }
  }
  if (points.length === 0) return [];

  const totalDistance = points[points.length - 1].d;
  // 総距離が取れない(全点が同じ距離等)場合はバケット分割できないためそのまま返す
  if (!(totalDistance > 0)) return points;

  const bucketWidth = totalDistance / BUCKET_COUNT;
  const result: ElevationPoint[] = [];
  let currentBucket = 0;
  let lowest: ElevationPoint | null = null;
  let highest: ElevationPoint | null = null;

  // 距離が近い方を先に積み、間引き後も距離の昇順を保つ(折れ線が逆走しないように)
  const flushBucket = () => {
    if (!lowest || !highest) return;
    if (lowest === highest) {
      result.push(lowest);
    } else if (lowest.d <= highest.d) {
      result.push(lowest, highest);
    } else {
      result.push(highest, lowest);
    }
  };

  for (const point of points) {
    const bucket = Math.min(BUCKET_COUNT - 1, Math.floor(point.d / bucketWidth));
    if (bucket !== currentBucket) {
      flushBucket();
      currentBucket = bucket;
      lowest = point;
      highest = point;
      continue;
    }
    if (!lowest || point.e < lowest.e) lowest = point;
    if (!highest || point.e > highest.e) highest = point;
  }
  flushBucket();

  // スタート地点とゴール地点は、そのバケット内で最高でも最低でもないと上のループから
  // 漏れる。漏れるとグラフがルート途中で終わり、ゴールの標高も別地点の値が表示される。
  // 「ゴールの標高」はライド計画上そのものが意味を持つ値なので、必ず含める
  const first = points[0];
  const last = points[points.length - 1];
  if (result[0] !== first) result.unshift(first);
  if (last !== first && result[result.length - 1] !== last) result.push(last);

  return result;
}
