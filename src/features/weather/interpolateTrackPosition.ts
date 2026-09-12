import type { TrackPoint } from './types';

export type TrackPosition = { lat: number; lon: number };
export type TrackPointWithDistance = TrackPoint & { d: number };

/**
 * trackPointsからd(距離)を持つ点だけを抽出し、d昇順であることを検証する。
 * ホバーのたびに呼ぶとO(n)フィルタが再実行され二分探索の高速化が相殺されてしまうため
 * (コードレビューで発見)、trackPointsが変わらない限り結果を再利用できるよう
 * interpolateTrackPositionから分離した。呼び出し側(RouteMap.tsx)でuseMemo化して使う。
 * d昇順の前提が崩れている(GPXの周回・往復等でdが逆行する)場合は二分探索が誤った補間結果を
 * 静かに返しかねないため、空配列(=呼び出し元は「表示しない」という安全側に倒せる)を返す
 * (コードレビューで指摘)
 */
export function filterPointsWithDistance(trackPoints: TrackPoint[]): TrackPointWithDistance[] {
  const withDistance = trackPoints.filter(
    (p): p is TrackPointWithDistance => typeof p.d === 'number'
  );
  for (let i = 1; i < withDistance.length; i++) {
    if (withDistance[i].d < withDistance[i - 1].d) return [];
  }
  return withDistance;
}

/**
 * ルート起点からの距離(メートル)に対応する座標を、フィルタ済みの生座標列(dを持つ点、
 * d昇順)から線形補間して返す。代表地点(WeatherPoint、既定10点)には無い任意の位置
 * (峠のピーク等)を地図上に示すために使う(STEP6の地図・標高グラフ連動、ユーザーからの
 * 追加要望)。
 */
export function interpolateFromFiltered(
  withDistance: TrackPointWithDistance[],
  distanceMeters: number
): TrackPosition | null {
  if (withDistance.length === 0) return null;

  const first = withDistance[0];
  if (distanceMeters <= first.d) return { lat: first.y, lon: first.x };

  const last = withDistance[withDistance.length - 1];
  if (distanceMeters >= last.d) return { lat: last.y, lon: last.x };

  // dは昇順の前提のため二分探索で挟む2点を探す(数万点規模のルートでも高速に処理するため)
  let lo = 0;
  let hi = withDistance.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (withDistance[mid].d <= distanceMeters) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const before = withDistance[lo];
  const after = withDistance[hi];
  const span = after.d - before.d;
  const ratio = span > 0 ? (distanceMeters - before.d) / span : 0;

  return {
    lat: before.y + (after.y - before.y) * ratio,
    lon: before.x + (after.x - before.x) * ratio,
  };
}

/**
 * filterPointsWithDistance + interpolateFromFilteredをまとめて呼ぶ簡易版。フィルタ結果を
 * 再利用できない(=毎回O(n)フィルタが走る)ため、ホバー等で高頻度に呼ぶ場合は
 * RouteMap.tsxのようにfilterPointsWithDistanceの結果をuseMemoしてinterpolateFromFilteredを
 * 直接使うこと。単発の呼び出し(テスト等)ではこちらで十分
 */
export function interpolateTrackPosition(
  trackPoints: TrackPoint[],
  distanceMeters: number
): TrackPosition | null {
  return interpolateFromFiltered(filterPointsWithDistance(trackPoints), distanceMeters);
}
