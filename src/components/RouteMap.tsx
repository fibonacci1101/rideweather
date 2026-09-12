import { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import Box from '@mui/material/Box';
import { tokens } from '../theme';
import { filterPointsWithDistance, interpolateFromFiltered } from '../features/weather/interpolateTrackPosition';
import type { TrackPoint, WeatherPoint } from '../features/weather/types';

type RouteMapProps = {
  trackPoints: TrackPoint[];
  weatherPoints: WeatherPoint[];
  // 地図・標高グラフ・天気表の連動ハイライト(STEP6)。未指定(ShareableView等)の場合は
  // クリック操作を受け付けず、ハイライト表示も行わない
  highlightedDistanceMeters?: number | null;
  // 標高グラフのホバー/クリック位置(代表地点への丸め込みなし)。峠のピーク等、代表地点に
  // 無い任意の位置も地図上に示せるよう、専用のドットで表示する(STEP6追加要望)
  hoverPositionDistanceMeters?: number | null;
  onPointClick?: (distanceMeters: number) => void;
};

const MARKER_RADIUS = 8;
const MARKER_RADIUS_HIGHLIGHTED = 11;
const HOVER_DOT_RADIUS = 6;
// ホバー位置ドットとハイライト済みマーカーの「同じ地点」判定に使う許容誤差(メートル)。
// hoverPositionDistanceMetersはElevationChart側でkm→mの往復変換(d → d/1000 → *1000)を
// 経るため、厳密等価では同じ地点でも浮動小数点誤差でずれることがある(コードレビューで発見)
const SAME_POSITION_TOLERANCE_METERS = 1;

// Skeleton UI(ResultSkeleton.tsx)がRouteMapSkeletonの寸法をハードコピーせず
// ここから直接参照するためexportする(コードレビューで指摘された値ドリフトの再発防止)
export const ROUTE_MAP_ASPECT_RATIO = '16 / 6';
export const ROUTE_MAP_ASPECT_RATIO_MOBILE = '4 / 3';

// 上流(RWGPS)のレスポンス形状が変わったり座標が欠けたりすると、無検証のままLeafletに
// 渡した場合に例外を起こしうる。ErrorBoundaryはアプリ全体で1箇所しかなく、地図描画で
// 例外が起きると他の全表示(天気カード等)まで巻き込んで白画面になるため、ここで弾く
function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}

// html2canvasでの画像化に対応するため、Leafletのデフォルトマーカー画像(Vite環境では
// パス解決が壊れやすい既知の問題がある)は使わず、CircleMarkerで代替する
function RouteMap({
  trackPoints,
  weatherPoints,
  highlightedDistanceMeters,
  hoverPositionDistanceMeters,
  onPointClick,
}: RouteMapProps) {
  const polylinePositions = useMemo<LatLngTuple[]>(
    () => trackPoints.filter((p) => isValidCoordinate(p.y, p.x)).map((p) => [p.y, p.x]),
    [trackPoints]
  );
  const validWeatherPoints = useMemo(
    () => weatherPoints.filter((p) => isValidCoordinate(p.lat, p.lon)),
    [weatherPoints]
  );
  // ホバーのたびに再実行されるinterpolateFromFilteredからdを持つ点の抽出(O(n))を分離し、
  // trackPointsが変わらない限り再利用する(未メモ化のフィルタが二分探索の高速化を
  // 相殺していたとコードレビューで指摘された)
  const trackPointsWithDistance = useMemo(() => filterPointsWithDistance(trackPoints), [trackPoints]);

  if (polylinePositions.length === 0) return null;

  // ホバー位置がちょうど代表地点(丸いマーカー)と一致する場合、同じ場所に重ねて描くと
  // 見た目が煩雑になるため、その場合はドットを省略する(マーカー自体が強調表示される)。
  // 厳密等価ではなく許容誤差付きで比較する(上記SAME_POSITION_TOLERANCE_METERS参照)
  const isSameAsHighlighted =
    highlightedDistanceMeters != null &&
    hoverPositionDistanceMeters != null &&
    Math.abs(hoverPositionDistanceMeters - highlightedDistanceMeters) <= SAME_POSITION_TOLERANCE_METERS;
  const hoverPosition =
    hoverPositionDistanceMeters != null && !isSameAsHighlighted
      ? interpolateFromFiltered(trackPointsWithDistance, hoverPositionDistanceMeters)
      : null;
  const isValidHoverPosition = hoverPosition !== null && isValidCoordinate(hoverPosition.lat, hoverPosition.lon);

  // ルートを切り替えても(TanStack Queryのキャッシュヒット時など)MapContainerは
  // 再マウントされず、bounds propは初回マウント時にしか反映されない。前のルートの
  // 表示範囲が残り続けるバグがあったため、ルートが変わったら確実に再マウントさせる
  const first = polylinePositions[0];
  const last = polylinePositions[polylinePositions.length - 1];
  const routeKey = `${polylinePositions.length}:${first.join(',')}:${last.join(',')}`;

  return (
    <Box
      sx={{
        borderRadius: tokens.radiusForm,
        overflow: 'hidden',
        aspectRatio: ROUTE_MAP_ASPECT_RATIO,
        '@media (max-width: 640px)': {
          aspectRatio: ROUTE_MAP_ASPECT_RATIO_MOBILE,
        },
      }}
    >
      <MapContainer
        key={routeKey}
        bounds={polylinePositions}
        boundsOptions={{ padding: [16, 16] }}
        preferCanvas
        scrollWheelZoom={false}
        style={{ width: '100%', height: '100%' }}
      >
        {/* OSM標準タイル。crossOrigin="anonymous"はhtml2canvasでの画像化に必須
            (実機確認済み: tile.openstreetmap.orgはAccess-Control-Allow-Origin: *を返す) */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          crossOrigin="anonymous"
        />
        <Polyline positions={polylinePositions} color={tokens.accent} weight={4} />
        {validWeatherPoints.map((point, index) => {
          const isHighlighted = highlightedDistanceMeters === point.distanceMeters;
          return (
            <CircleMarker
              key={`${point.name}-${index}`}
              center={[point.lat, point.lon]}
              radius={isHighlighted ? MARKER_RADIUS_HIGHLIGHTED : MARKER_RADIUS}
              // color/weight/fillColor/fillOpacityはpathOptionsにまとめて渡す必要がある。
              // react-leaflet v5のCircleMarkerは再レンダー時にcenter/radiusのみ更新経路があり、
              // トップレベルpropとして渡したcolor等はマウント時の初期構築にしか使われず、
              // ハイライト時の色・線幅変更が実際には反映されない不具合だった
              // (node_modulesの実装ソースを読んで確認。コードレビューで発見)
              pathOptions={{
                color: isHighlighted ? tokens.accent : tokens.paper,
                weight: isHighlighted ? 3 : 2,
                fillColor: tokens.accent,
                fillOpacity: 1,
              }}
              // onClickではなくeventHandlersがreact-leaflet(v5)でLeafletのDOMイベントを
              // 受け取る正しい方法。onPointClick未指定(ShareableView等)の場合は
              // クリック不要な表示専用ビューなのでハンドラ自体を付けない
              eventHandlers={onPointClick ? { click: () => onPointClick(point.distanceMeters) } : undefined}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                {point.name}
              </Tooltip>
            </CircleMarker>
          );
        })}
        {/* 標高グラフのホバー/クリック位置(STEP6)。代表地点(丸いマーカー)の間、
            例えば峠のピーク等、代表地点以外の任意の位置も示せるようにする。
            チェックポイントの丸(fillColor=accent)と区別するため白丸+濃い縁取りにする */}
        {isValidHoverPosition && hoverPosition && (
          <CircleMarker
            center={[hoverPosition.lat, hoverPosition.lon]}
            radius={HOVER_DOT_RADIUS}
            color={tokens.accent}
            weight={2}
            fillColor={tokens.paper}
            fillOpacity={1}
            interactive={false}
          />
        )}
      </MapContainer>
    </Box>
  );
}

export default RouteMap;
