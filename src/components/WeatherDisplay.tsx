import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { WeatherPoint } from '../features/weather/types';
import { getPointWarnings, getTemperatureSwing } from '../features/weather/warnings';
import { DASH, formatTime, getWindDirectionLabel, roundTemp } from '../features/weather/format';
import { calculateRouteBearing } from '../features/weather/bearing';
import WindArrow from './WindArrow';
import { tokens } from '../theme';

// Skeleton UI(ResultSkeleton.tsx)がWeatherCardSkeletonの寸法をハードコピーせず
// ここから直接参照するためexportする(コードレビューで指摘された値ドリフトの再発防止)。
// フォントサイズはMUIのTypography既定lineHeight(body1: 1.5、theme.tsに上書きなし)を
// 前提にSkeleton側で行高を計算する。温度表示のみlineHeight:1を明示しているため例外
export const WEATHER_CARD_GRID_MIN_WIDTH = 230;
export const WEATHER_CARD_GRID_GAP = '14px';
export const WEATHER_CARD_PADDING = '18px';
export const WEATHER_CARD_GAP = '10px';
export const WEATHER_CARD_ICON_SIZE = 40;
export const WEATHER_CARD_TEMP_FONT_SIZE = 22; // lineHeight:1を明示(WeatherDisplay.tsx参照)のため行高=フォントサイズ
export const WEATHER_CARD_DESC_FONT_SIZE = 12; // 既定lineHeight 1.5
export const WEATHER_CARD_STAT_FONT_SIZE = 13; // 既定lineHeight 1.5

type StatRowProps = {
  label: string;
  value: string;
  warning: boolean;
  // 風向き矢印(WindArrow)等、値の直前に添える小さいアイコン用のスロット(STEP6)
  icon?: ReactNode;
};

function StatRow({ label, value, warning, icon }: StatRowProps) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography component="span" sx={{ fontSize: WEATHER_CARD_STAT_FONT_SIZE, color: tokens.textMuted }}>
        {label}
      </Typography>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {icon}
        <Typography
          component="span"
          sx={{
            fontSize: WEATHER_CARD_STAT_FONT_SIZE,
            fontWeight: 700,
            color: warning ? tokens.warning : tokens.statValueNormal,
          }}
        >
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

type ElevationBarProps = {
  elevationMeters: number | undefined;
  minElevation: number;
  maxElevation: number;
};

// 標高プロファイルグラフとカード一覧のつながりを示す簡易インジケーター
function ElevationBar({ elevationMeters, minElevation, maxElevation }: ElevationBarProps) {
  if (elevationMeters === undefined) {
    // 他の未取得値と表示規約を揃える(行ごと消すのではなく"ー"を表示する)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Typography sx={{ fontSize: 11, color: tokens.textMuted }}>標高 {DASH}</Typography>
      </Box>
    );
  }
  const range = maxElevation - minElevation;
  const ratio = range > 0 ? (elevationMeters - minElevation) / range : 0;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <Box
        sx={{
          flex: 1,
          height: 4,
          borderRadius: '2px',
          backgroundColor: tokens.borderSubtle,
          position: 'relative',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            left: `${(ratio * 100).toFixed(1)}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: tokens.accent,
          }}
        />
      </Box>
      <Typography sx={{ fontSize: 11, color: tokens.textMuted, flexShrink: 0 }}>
        標高 {Math.round(elevationMeters)}m
      </Typography>
    </Box>
  );
}

type TempExtremeBadgeProps = {
  kind: 'max' | 'min';
};

function TempExtremeBadge({ kind }: TempExtremeBadgeProps) {
  const color = kind === 'max' ? tokens.warning : tokens.cold;
  const borderColor = kind === 'max' ? tokens.warningBorder : tokens.coldBorder;

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        fontSize: 11,
        fontWeight: 700,
        color,
        border: `1px solid ${borderColor}`,
        borderRadius: '999px',
        padding: '1px 6px',
        ml: '6px',
      }}
    >
      {kind === 'max' ? '▲最高' : '▼最低'}
    </Box>
  );
}

type WeatherCardProps = {
  point: WeatherPoint;
  minElevation: number;
  maxElevation: number;
  isTempMaxPoint: boolean;
  isTempMinPoint: boolean;
  // この地点の進行方向ベアリング(度)。calculateRouteBearingがルート単位で算出したものを
  // 親から渡す(WindArrowでの向かい風/追い風判定に使う。STEP6)。隣接地点の座標が完全一致する
  // 等、進行方向を定義できない地点はundefined(WindArrow側で中立色にフォールバックする)
  bearingDeg: number | undefined;
  // 地図・標高グラフ・天気表の連動ハイライト(STEP6)。既存の警告表示(hasWarning、枠線色)とは
  // 独立した概念のため、警告色を上書きせずboxShadowのリングで別途表現する
  isSelected: boolean;
};

function WeatherCard({
  point,
  minElevation,
  maxElevation,
  isTempMaxPoint,
  isTempMinPoint,
  bearingDeg,
  isSelected,
}: WeatherCardProps) {
  const warnings = getPointWarnings(point.weather);
  const hasWarning = warnings.length > 0;
  const condition = point.weather?.weather?.[0];

  return (
    <Box
      sx={{
        backgroundColor: '#ffffff',
        borderRadius: tokens.radiusCard,
        padding: WEATHER_CARD_PADDING,
        boxShadow: isSelected ? `${tokens.shadow}, 0 0 0 2px ${tokens.accent}` : tokens.shadow,
        border: `1.5px solid ${hasWarning ? tokens.warningBorder : tokens.borderSubtle}`,
        display: 'flex',
        flexDirection: 'column',
        gap: WEATHER_CARD_GAP,
      }}
    >
      <Box>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
          {point.name}
          {point.placeName && (
            <Typography
              component="span"
              sx={{ fontSize: 12, fontWeight: 500, color: tokens.textMuted, ml: '6px' }}
            >
              {point.placeName}
            </Typography>
          )}
          {isTempMaxPoint && <TempExtremeBadge kind="max" />}
          {isTempMinPoint && <TempExtremeBadge kind="min" />}
        </Typography>
        <Typography sx={{ fontSize: 12, color: tokens.textMuted, mt: '2px' }}>
          距離: {(point.distanceMeters / 1000).toFixed(1)} km ・ 到着予定:{' '}
          {formatTime(point.estimatedArrivalTime)}
        </Typography>
        <Box sx={{ mt: '6px' }}>
          <ElevationBar
            elevationMeters={point.elevationMeters}
            minElevation={minElevation}
            maxElevation={maxElevation}
          />
        </Box>
      </Box>

      {point.weather ? (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              py: '10px',
              borderTop: `1px solid ${tokens.borderSubtle}`,
              borderBottom: `1px solid ${tokens.borderSubtle}`,
            }}
          >
            <Box
              sx={{
                width: WEATHER_CARD_ICON_SIZE,
                height: WEATHER_CARD_ICON_SIZE,
                borderRadius: '50%',
                overflow: 'hidden',
                flexShrink: 0,
                backgroundColor: tokens.borderSubtle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {condition?.icon && (
                <img
                  src={`https://openweathermap.org/img/wn/${condition.icon}.png`}
                  alt={condition.description}
                  width={WEATHER_CARD_ICON_SIZE}
                  height={WEATHER_CARD_ICON_SIZE}
                  crossOrigin="anonymous"
                />
              )}
            </Box>
            <Box>
              <Typography
                sx={{
                  fontSize: WEATHER_CARD_TEMP_FONT_SIZE,
                  fontWeight: 800,
                  lineHeight: 1,
                  color:
                    warnings.includes('heat') || warnings.includes('cold')
                      ? tokens.warning
                      : 'inherit',
                }}
              >
                {roundTemp(point.weather.main?.temp)}°C
              </Typography>
              <Typography sx={{ fontSize: WEATHER_CARD_DESC_FONT_SIZE, color: tokens.textMuted }}>
                {condition?.description ?? DASH} ・ 体感 {roundTemp(point.weather.main?.feels_like)}°C
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <StatRow
              label="降水確率"
              value={point.weather.pop !== undefined ? `${(point.weather.pop * 100).toFixed(0)}%` : DASH}
              warning={warnings.includes('rain-probability')}
            />
            <StatRow
              label="風速・風向き"
              value={
                point.weather.wind?.speed !== undefined
                  ? `${point.weather.wind.speed.toFixed(1)} m/s ${getWindDirectionLabel(point.weather.wind?.deg)}`
                  : DASH
              }
              warning={warnings.includes('wind')}
              icon={<WindArrow windDeg={point.weather.wind?.deg} bearingDeg={bearingDeg} size={16} />}
            />
            <StatRow
              label="降水量 (3h)"
              value={point.weather.rainMm !== undefined ? `${point.weather.rainMm.toFixed(1)} mm` : DASH}
              warning={warnings.includes('rain-amount')}
            />
          </Box>
        </>
      ) : (
        <Typography sx={{ fontSize: 13, color: tokens.warning }}>
          天気予報を取得できませんでした{point.error ? `: ${point.error}` : ''}
        </Typography>
      )}
    </Box>
  );
}

type WeatherDisplayProps = {
  weatherData: WeatherPoint[];
  // 地図・標高グラフ・天気表の連動ハイライト(STEP6)。未指定(ShareableView等)の場合は
  // どのカードも選択強調しない
  highlightedDistanceMeters?: number | null;
};

function WeatherDisplay({ weatherData, highlightedDistanceMeters }: WeatherDisplayProps) {
  if (weatherData.length === 0) return null;

  const sorted = [...weatherData].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const elevations = sorted
    .map((p) => p.elevationMeters)
    .filter((e): e is number => e !== undefined);
  const minElevation = elevations.length > 0 ? Math.min(...elevations) : 0;
  const maxElevation = elevations.length > 0 ? Math.max(...elevations) : 0;
  const swing = getTemperatureSwing(sorted);
  const bearings = calculateRouteBearing(sorted);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${WEATHER_CARD_GRID_MIN_WIDTH}px, 1fr))`,
        gap: WEATHER_CARD_GRID_GAP,
      }}
    >
      {sorted.map((point, index) => (
        <WeatherCard
          key={`${point.distanceMeters}-${point.name}`}
          bearingDeg={bearings[index]}
          isSelected={highlightedDistanceMeters === point.distanceMeters}
          point={point}
          minElevation={minElevation}
          maxElevation={maxElevation}
          isTempMaxPoint={swing?.maxPoint === point}
          isTempMinPoint={swing?.minPoint === point}
        />
      ))}
    </Box>
  );
}

export default WeatherDisplay;
