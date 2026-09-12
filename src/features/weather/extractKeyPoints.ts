import type { PointExtractionStrategy, TrackPoint } from './types';

// Skeleton UI(ResultSkeleton.tsx)がプレースホルダーの枚数/行数を合わせるために参照する。
// ここを変えるとSkeleton側も自動的に追従する
export const DEFAULT_KEY_POINT_COUNT = 10;

const DEFAULT_STRATEGY: PointExtractionStrategy = { mode: 'fixedCount', count: DEFAULT_KEY_POINT_COUNT };

/**
 * ルート上から表示に使う代表地点を抽出する。既定は等間隔の固定数(10地点)。
 * strategyを切り替えることで将来「距離ベース」抽出にも対応できる(DESIGN.md 4.3参照)。
 */
export function extractKeyPoints(
  trackPoints: TrackPoint[],
  strategy: PointExtractionStrategy = DEFAULT_STRATEGY
): TrackPoint[] {
  if (trackPoints.length === 0) return [];

  switch (strategy.mode) {
    case 'fixedCount':
      return extractFixedCount(trackPoints, strategy.count);
    case 'byDistance':
      // 将来対応。DESIGN.md 9章の通り初期実装スコープ外
      throw new Error('"byDistance" strategy is not implemented yet');
  }
}

function extractFixedCount(trackPoints: TrackPoint[], count: number): TrackPoint[] {
  const total = trackPoints.length;
  if (count <= 0) return [];
  if (count >= total) return [...trackPoints];
  if (count === 1) return [trackPoints[0]];

  const points: TrackPoint[] = [trackPoints[0]];
  const interval = (total - 1) / (count - 1);
  for (let i = 1; i < count - 1; i++) {
    points.push(trackPoints[Math.round(interval * i)]);
  }
  points.push(trackPoints[total - 1]);
  return points;
}
