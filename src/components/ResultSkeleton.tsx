import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { tokens } from '../theme';
import { DEFAULT_KEY_POINT_COUNT } from '../features/weather/extractKeyPoints';
import {
  DATA_COLUMN_MIN_WIDTH,
  LABEL_COLUMN_MIN_WIDTH,
  MATRIX_DATA_FONT_SIZE,
  MATRIX_ICON_SIZE,
} from './WeatherMatrix';
import { ROUTE_MAP_ASPECT_RATIO, ROUTE_MAP_ASPECT_RATIO_MOBILE } from './RouteMap';
import { ELEVATION_CHART_HEIGHT, ELEVATION_CHART_PADDING } from './ElevationChart';
import {
  WEATHER_CARD_DESC_FONT_SIZE,
  WEATHER_CARD_GAP,
  WEATHER_CARD_GRID_GAP,
  WEATHER_CARD_GRID_MIN_WIDTH,
  WEATHER_CARD_ICON_SIZE,
  WEATHER_CARD_PADDING,
  WEATHER_CARD_STAT_FONT_SIZE,
  WEATHER_CARD_TEMP_FONT_SIZE,
} from './WeatherDisplay';

// 天気APIのデータ取得中(Promise.allの待ち時間)・動的import(RouteMap/ElevationChart)の
// チャンク読み込み中の両方で使う、枠組みだけのプレースホルダー群。実コンポーネントと表示後に
// ガタつかないよう、寸法(aspectRatio/height/padding/gap等)は各実コンポーネントからexportされた
// 定数を直接参照する(ハードコピーの値ドリフトでレイアウトシフトが再発した反省を踏まえた設計。
// 詳細はplans/STEP4_PROGRESS.md、docs/review/STEP4レビュー依頼プロンプト.mdの指摘G参照)

// MUIのTypography既定lineHeight(body1: 1.5、theme.tsに上書きなし)に基づき、
// フォントサイズからテキスト1行の実測行高を算出する。Skeletonのheightをこの値に
// 揃えることで、フォントサイズ変更にも自動追従する
function bodyLineHeight(fontSizePx: number): number {
  return Math.round(fontSizePx * 1.5);
}

// WeatherMatrixの列数(ルートの走行時間ぶんの3時間バケット数)は事前に確定できないため、
// 短〜中距離ルートでの典型値を近似値として使う。長距離ルートでは実表示との差が大きくなりうるが、
// 「大きな崩れを避ける」現実的な妥協点として割り切る
const APPROX_MATRIX_COLUMN_COUNT = 8;

// RouteMap本体と同じ寸法(aspectRatio/borderRadius)。地図タイルの代わりに単色のプレースホルダーを敷く。
// 注意: MUIのSkeletonはvariant="rectangular"でもheight/widthを明示しない場合、既定で
// `height: 1.2em`を設定する。CSSのaspect-ratioは対象の辺がauto(未指定)の場合にのみ
// 高さを算出するため、この既定heightがある限りaspectRatioは無視され、実機で厚さ約19pxの
// 薄い帯になってしまう(実機のgetComputedStyleで実測して発見)。`height: 'auto'`で
// 既定値を明示的に打ち消す必要がある
function SkeletonBox({ sx }: { sx: object }) {
  return <Skeleton variant="rectangular" animation="wave" sx={{ height: 'auto', ...sx }} />;
}

export function RouteMapSkeleton() {
  return (
    <SkeletonBox
      sx={{
        borderRadius: tokens.radiusForm,
        aspectRatio: ROUTE_MAP_ASPECT_RATIO,
        width: '100%',
        '@media (max-width: 640px)': {
          aspectRatio: ROUTE_MAP_ASPECT_RATIO_MOBILE,
        },
      }}
    />
  );
}

// ElevationChart本体と同じ寸法(height:160・padding・背景)
export function ElevationChartSkeleton() {
  return (
    <Box
      sx={{
        backgroundColor: tokens.paper,
        borderRadius: tokens.radiusForm,
        padding: ELEVATION_CHART_PADDING,
        height: ELEVATION_CHART_HEIGHT,
      }}
    >
      <Skeleton variant="rectangular" animation="wave" sx={{ width: '100%', height: '100%', borderRadius: '8px' }} />
    </Box>
  );
}

// SummaryBanner本体(警告なし時の最小1行ケース)と同じ構造(Dot8px + テキスト1行)。
// 警告あり時は最大200px近くまで伸びる可変長要素のため完全一致は狙わず、
// 「無から出現する」という最も目立つガタつきを解消する最小ケース近似に留める
// (コードレビューで、このプレースホルダー自体が丸ごと欠落していたバグを指摘され追加した)
function SummaryBannerSkeleton() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <Skeleton variant="circular" width={8} height={8} />
      <Skeleton variant="text" width={240} height={bodyLineHeight(WEATHER_CARD_STAT_FONT_SIZE)} />
    </Box>
  );
}

// WeatherCard 1枚分のプレースホルダー。実カードの内訳(タイトル行/距離・到着予定/標高バー/
// 天気アイコン+気温/降水確率・風速風向き・降水量の3行)をそのまま模す
function WeatherCardSkeleton() {
  return (
    <Box
      sx={{
        backgroundColor: '#ffffff',
        borderRadius: tokens.radiusCard,
        padding: WEATHER_CARD_PADDING,
        boxShadow: tokens.shadow,
        border: `1.5px solid ${tokens.borderSubtle}`,
        display: 'flex',
        flexDirection: 'column',
        gap: WEATHER_CARD_GAP,
      }}
    >
      <Box>
        <Skeleton variant="text" width="60%" height={22} />
        <Skeleton variant="text" width="80%" height={18} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '6px' }}>
          <Skeleton variant="rectangular" sx={{ flex: 1, height: 4, borderRadius: '2px' }} />
          <Skeleton variant="text" width={56} height={16} />
        </Box>
      </Box>

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
        <Skeleton variant="circular" width={WEATHER_CARD_ICON_SIZE} height={WEATHER_CARD_ICON_SIZE} />
        <Box sx={{ flex: 1 }}>
          {/* 気温行はWeatherDisplay.tsx側もlineHeight:1を明示しているため、行高=フォントサイズそのもの */}
          <Skeleton variant="text" width={64} height={WEATHER_CARD_TEMP_FONT_SIZE} />
          <Skeleton variant="text" width="90%" height={bodyLineHeight(WEATHER_CARD_DESC_FONT_SIZE)} />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Skeleton variant="text" width={70} height={bodyLineHeight(WEATHER_CARD_STAT_FONT_SIZE)} />
            <Skeleton variant="text" width={50} height={bodyLineHeight(WEATHER_CARD_STAT_FONT_SIZE)} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

type WeatherCardsSkeletonProps = {
  count?: number;
};

// WeatherDisplay本体と同じグリッド(repeat(auto-fill, minmax(230px,1fr))・gap14px)。
// カード枚数は既定でextractKeyPointsの既定値(10地点)に合わせるが、ルート取得済みで
// 実際の代表地点数が判明している場合はApp.tsx側からその値を渡し、短距離ルート
// (trackPoints 10点未満)での枚数不一致を避ける(コードレビューで指摘)
export function WeatherCardsSkeleton({ count = DEFAULT_KEY_POINT_COUNT }: WeatherCardsSkeletonProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${WEATHER_CARD_GRID_MIN_WIDTH}px, 1fr))`,
        gap: WEATHER_CARD_GRID_GAP,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <WeatherCardSkeleton key={i} />
      ))}
    </Box>
  );
}

type WeatherMatrixSkeletonProps = {
  rows?: number;
  columns?: number;
};

// WeatherMatrix本体と同じテーブル構造・列幅算出式(LABEL/DATA_COLUMN_MIN_WIDTH)を再利用。
// rowsの既定値・意図はWeatherCardsSkeletonのcountと同じ(App.tsx参照)
export function WeatherMatrixSkeleton({
  rows = DEFAULT_KEY_POINT_COUNT,
  columns = APPROX_MATRIX_COLUMN_COUNT,
}: WeatherMatrixSkeletonProps) {
  const tableMinWidth = LABEL_COLUMN_MIN_WIDTH + columns * DATA_COLUMN_MIN_WIDTH;

  return (
    <Box
      sx={{
        overflowX: 'auto',
        borderRadius: tokens.radiusForm,
        border: `1px solid ${tokens.borderSubtle}`,
      }}
    >
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: tableMinWidth }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ padding: '10px 14px', borderBottom: `1px solid ${tokens.borderSubtle}` }}>
              <Skeleton variant="text" width={48} height={16} />
            </Box>
            {Array.from({ length: columns }, (_, i) => (
              <Box component="th" key={i} sx={{ padding: '10px 14px', borderBottom: `1px solid ${tokens.borderSubtle}` }}>
                <Skeleton variant="text" width={40} height={16} />
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {Array.from({ length: rows }, (_, r) => (
            <Box component="tr" key={r}>
              <Box component="td" sx={{ padding: '10px 14px', borderBottom: `1px solid ${tokens.borderSubtle}` }}>
                <Skeleton variant="text" width={80} height={16} />
              </Box>
              {Array.from({ length: columns }, (_, c) => (
                <Box component="td" key={c} sx={{ padding: '8px 12px', borderBottom: `1px solid ${tokens.borderSubtle}` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <Skeleton variant="circular" width={MATRIX_ICON_SIZE} height={MATRIX_ICON_SIZE} />
                    <Skeleton variant="text" width={24} height={bodyLineHeight(MATRIX_DATA_FONT_SIZE)} />
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

type ResultSkeletonProps = {
  viewMode: 'cards' | 'matrix';
  // ルート取得済み(routeQuery.data)なら実際の代表地点数(最大DEFAULT_KEY_POINT_COUNT)、
  // 未取得ならDEFAULT_KEY_POINT_COUNTのまま。App.tsx参照
  pointCount?: number;
};

// 結果セクション全体(地図・標高グラフ・見出し行・要約バナー・カード or 時間帯表)の
// プレースホルダー。App.tsxが「まだ結果が無い初回取得中」にのみ表示する(既に表示済みの
// 結果をこれで置き換えると、バックグラウンド再取得のたびに実データが一瞬消える退行になるため)
function ResultSkeleton({ viewMode, pointCount = DEFAULT_KEY_POINT_COUNT }: ResultSkeletonProps) {
  return (
    <>
      <RouteMapSkeleton />
      <ElevationChartSkeleton />

      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Skeleton variant="text" width={90} height={26} />
        <Skeleton variant="rectangular" width={180} height={32} sx={{ borderRadius: '8px' }} />
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 日の出日の入り(実際は条件付き表示)の代わりの1行。SummaryBannerは常に描画される
            要素のため、以前はこの1行だけで代替していたが、要素が丸ごと1つ足りていなかった
            (コードレビューで発見) */}
        <Skeleton variant="text" width={220} height={bodyLineHeight(WEATHER_CARD_STAT_FONT_SIZE)} />
        <SummaryBannerSkeleton />
        {viewMode === 'cards' ? (
          <WeatherCardsSkeleton count={pointCount} />
        ) : (
          <WeatherMatrixSkeleton rows={pointCount} />
        )}
      </Box>
    </>
  );
}

export default ResultSkeleton;
