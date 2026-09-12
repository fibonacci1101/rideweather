import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceLine,
} from 'recharts';
import Box from '@mui/material/Box';
import { tokens } from '../theme';
import { decimateElevationProfile } from '../features/weather/decimateElevationProfile';
import type { TrackPoint, WeatherPoint } from '../features/weather/types';

type ElevationChartProps = {
  trackPoints: TrackPoint[];
  weatherPoints: WeatherPoint[];
  // 地図・標高グラフ・天気表の連動ハイライト(STEP6)。onHoverPoint/onTogglePoint未指定
  // (ShareableView等)の場合はホバー/クリックのハンドラを付けない表示専用として振る舞う
  highlightedDistanceMeters?: number | null;
  onHoverPoint?: (distanceMeters: number | null) => void;
  onTogglePoint?: (distanceMeters: number) => void;
};

// Skeleton UI(ResultSkeleton.tsx)がElevationChartSkeletonの寸法をハードコピーせず
// ここから直接参照するためexportする(コードレビューで指摘された値ドリフトの再発防止)
export const ELEVATION_CHART_HEIGHT = 160;
export const ELEVATION_CHART_PADDING = '12px 16px 4px';

type ChartDatum = {
  distanceKm: number;
  elevationM: number;
};

function ElevationChart({
  trackPoints,
  weatherPoints,
  highlightedDistanceMeters,
  onHoverPoint,
  onTogglePoint,
}: ElevationChartProps) {
  const data = useMemo<ChartDatum[]>(
    () =>
      decimateElevationProfile(trackPoints).map((p) => ({
        distanceKm: p.d / 1000,
        elevationM: p.e,
      })),
    [trackPoints]
  );

  if (data.length === 0) return null;

  // タッチデバイス(hover非対応)ではホバーによる一時プレビューを行わない。UAではなく
  // メディアクエリ相当(hover:hover)で判定し、環境依存の誤動作を避ける。jsdom等
  // matchMedia非実装の環境でも落ちないようtypeof確認を挟む(STEP6)
  const supportsHover =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover)').matches;

  // Rechartsのマウスイベントが返す活性ラベル(activeLabel、XAxisのdataKey=distanceKmの値)を
  // メートルに変換する。代表地点(WeatherPoint)への丸め込みはここでは行わない
  // (峠のピーク等、代表地点に無い任意の位置も地図上に示せるようにするため。STEP6追加要望)。
  // 既存のTooltip labelFormatter(下記)と同じくNumber()で数値化する
  // (activeLabelは文字列で渡ってくることがあるため)
  const resolveDistanceMetersFromLabel = (label: unknown): number | null => {
    const distanceKm = Number(label);
    return Number.isFinite(distanceKm) ? distanceKm * 1000 : null;
  };

  return (
    <Box
      sx={{
        backgroundColor: tokens.paper,
        borderRadius: tokens.radiusForm,
        padding: ELEVATION_CHART_PADDING,
        height: ELEVATION_CHART_HEIGHT,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          onMouseMove={(state) => {
            if (!onHoverPoint || !supportsHover) return;
            onHoverPoint(resolveDistanceMetersFromLabel(state?.activeLabel));
          }}
          onMouseLeave={() => onHoverPoint?.(null)}
          onClick={(state) => {
            if (!onTogglePoint) return;
            const distanceMeters = resolveDistanceMetersFromLabel(state?.activeLabel);
            if (distanceMeters !== null) onTogglePoint(distanceMeters);
          }}
        >
          <defs>
            <linearGradient id="elevationFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={tokens.accent} stopOpacity={0.35} />
              <stop offset="95%" stopColor={tokens.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.borderSubtle} vertical={false} />
          <XAxis
            dataKey="distanceKm"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) => `${Math.round(value)}km`}
            tick={{ fontSize: 11, fill: tokens.textMuted }}
            axisLine={{ stroke: tokens.border }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value: number) => `${Math.round(value)}m`}
            tick={{ fontSize: 11, fill: tokens.textMuted }}
            axisLine={false}
            tickLine={false}
            // "1050m"のような4桁の目盛りラベルは右寄せ描画のため、widthが狭いと
            // ラベル左端がSVGの左境界(x=0)をわずかに超えてクリップされ、先頭の
            // 数字が欠けて見える不具合があった(実機のエクスポート画像で確認)。
            // 実測の必要幅(約33px)に余裕を持たせて確保する
            width={48}
          />
          {/* isAnimationActive=false: html2canvasでのキャプチャ時にアニメーション途中の
              状態が写り込む事故を防ぐ(大量点数での描画負荷軽減にもなる) */}
          <Tooltip
            formatter={(value) => [`${Math.round(Number(value))}m`, '標高']}
            labelFormatter={(label) => `${Number(label).toFixed(1)}km地点`}
          />
          <Area
            type="monotone"
            dataKey="elevationM"
            stroke={tokens.accent}
            strokeWidth={2}
            fill="url(#elevationFill)"
            isAnimationActive={false}
          />
          {/* elevationMetersが無い地点は0mとして打つと、標高不明なだけの地点が「海抜0m」
              として描画され、ifOverflow="extendDomain"でY軸ごと0まで引き伸ばされて
              グラフ全体が不正確に見えるバグがあった(実測)。値が無い地点はそもそも描かない */}
          {weatherPoints
            .filter((point): point is typeof point & { elevationMeters: number } =>
              point.elevationMeters !== undefined
            )
            .map((point) => (
              <ReferenceDot
                key={point.name}
                x={point.distanceMeters / 1000}
                y={point.elevationMeters}
                r={4}
                fill={tokens.accent}
                stroke={tokens.paper}
                strokeWidth={1.5}
                ifOverflow="extendDomain"
              />
            ))}
          {/* 地図・天気表と連動するハイライト位置(STEP6)。ホバー/クリック位置(代表地点への
              丸め込みなし、実際の位置)を縦線で強調する */}
          {highlightedDistanceMeters !== undefined && highlightedDistanceMeters !== null && (
            <ReferenceLine
              x={highlightedDistanceMeters / 1000}
              stroke={tokens.accent}
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

export default ElevationChart;
