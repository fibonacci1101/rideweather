import type { WeatherPoint } from './types';

// 距離(km)に最も近いWeatherPointを返す。ElevationChartのホバー/クリック位置(連続値、
// TrackPoint相当の粒度)から、地図・天気表と共有する代表地点(WeatherPoint、既定10点)を
// 逆引きするために使う(STEP6の地図・標高グラフ・天気表連動)
export function findNearestPointByDistance(
  points: WeatherPoint[],
  distanceKm: number
): WeatherPoint | null {
  if (points.length === 0) return null;

  let nearest = points[0];
  let minDiffKm = Math.abs(points[0].distanceMeters / 1000 - distanceKm);
  for (const point of points) {
    const diffKm = Math.abs(point.distanceMeters / 1000 - distanceKm);
    if (diffKm < minDiffKm) {
      nearest = point;
      minDiffKm = diffKm;
    }
  }
  return nearest;
}
