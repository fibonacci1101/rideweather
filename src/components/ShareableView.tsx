import { forwardRef, lazy, Suspense } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SummaryBanner from './SummaryBanner';
import WeatherMatrix from './WeatherMatrix';
import WeatherDisplay from './WeatherDisplay';
import type { RouteSunTimes } from '../features/weather/format';
import type { TrackPoint, WeatherPoint } from '../features/weather/types';
import { tokens } from '../theme';

// App.tsxと同じモジュール指定子で動的importする(leaflet/rechartsをメインバンドルから
// 分離するため。ここを静的importのままにすると依存グラフ経由でメインチャンクに巻き戻る。
// plans/STEP4_IMPLEMENTATION_PLAN.md 1.3参照)。このビューは常に画面外
// (position:fixed; left:-9999px)なのでSuspense fallbackはnullで十分
const RouteMap = lazy(() => import('./RouteMap'));
const ElevationChart = lazy(() => import('./ElevationChart'));

type ShareableViewProps = {
  trackPoints: TrackPoint[];
  weatherPoints: WeatherPoint[];
  sunTimes: RouteSunTimes | null;
  conditionsLabel: string;
};

// 画像保存(SNS共有)専用のレイアウト。画面表示(カード/マトリックスの切り替え)とは
// 独立に、天気カードを縦に何個も並べると長大な画像になってしまう問題を避けるため、
// エクスポート時は常にコンパクトなWeatherMatrixを使う。
// 画面には表示しない(position:fixed + 画面外オフセット)が、display:noneにすると
// 幅/高さが0になりLeaflet/Rechartsが正しく描画できないため、その方式は使わない。
const ShareableView = forwardRef<HTMLDivElement, ShareableViewProps>(function ShareableView(
  { trackPoints, weatherPoints, sunTimes, conditionsLabel },
  ref
) {
  const hasForecastBuckets = weatherPoints.some(
    (point) => (point.weather?.nearbyBuckets?.length ?? 0) > 0
  );

  return (
    <Box
      ref={ref}
      sx={{
        position: 'fixed',
        top: 0,
        left: '-9999px',
        // 600kmブルベのように行程が長いルートでは時刻の列が増え、固定幅だと表が
        // 見切れてしまう。表の自然幅に合わせて伸ばし、短いルートでは720pxを保つ
        width: 'fit-content',
        minWidth: 720,
        backgroundColor: tokens.background,
        padding: '28px',
      }}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: tokens.accentLabel,
            }}
          >
            Ride Weather App
          </Typography>
          <Typography sx={{ fontSize: 13, color: tokens.textMuted, mt: '4px' }}>
            {conditionsLabel}
          </Typography>
        </Box>

        <Suspense fallback={null}>
          <RouteMap trackPoints={trackPoints} weatherPoints={weatherPoints} />
        </Suspense>
        <Suspense fallback={null}>
          <ElevationChart trackPoints={trackPoints} weatherPoints={weatherPoints} />
        </Suspense>

        {sunTimes && (
          <Typography sx={{ fontSize: 13, color: tokens.textMuted }}>
            日の出 {sunTimes.sunrise} ・ 日の入り {sunTimes.sunset}
          </Typography>
        )}
        <SummaryBanner weatherData={weatherPoints} />
        {/* マトリックスは予報バケットが1つも無いと何も描画しない。そのまま出すと画像から
            天気の情報が丸ごと消え、要約バナーだけが画像に存在しない「各地点のカード」を
            参照する不整合な画像になる(走行日を5日後にすると実際に発生)。
            その場合はカード表示にフォールバックし、地点ごとの取得できなかった理由を残す */}
        {hasForecastBuckets ? (
          <WeatherMatrix weatherData={weatherPoints} scrollable={false} />
        ) : (
          <WeatherDisplay weatherData={weatherPoints} />
        )}

        <Typography sx={{ fontSize: 11, color: tokens.textMuted, textAlign: 'center' }}>
          {typeof window !== 'undefined' ? window.location.host : ''}
        </Typography>
      </Stack>
    </Box>
  );
});

export default ShareableView;
