import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ForecastBucket, WeatherPoint } from '../features/weather/types';
import {
  DASH,
  formatUnixDateAtLocation,
  formatUnixTimeAtLocation,
  roundTemp,
} from '../features/weather/format';
import { isNightIcon } from '../features/weather/warnings';
import { calculateRouteBearing } from '../features/weather/bearing';
import WindArrow from './WindArrow';
import { tokens } from '../theme';

type WeatherMatrixProps = {
  weatherData: WeatherPoint[];
  // 画像保存(ShareableView)用。falseにするとスクロールコンテナを外し表を自然幅で描く。
  // html2canvasはスクロールで隠れた部分をキャプチャできず、そのままでは表が見切れるため
  scrollable?: boolean;
  // 地図・標高グラフ・天気表の連動ハイライト(STEP6)。未指定(ShareableView等)の場合は
  // どの行も選択強調しない
  highlightedDistanceMeters?: number | null;
};

// 選択中の行の背景色。到着予定時刻セルのHIGHLIGHT_BGとは意味が異なる別の強調表示のため、
// 混同を避けて別トークンとして持つ(STEP6)。地点列(sticky)は下にスクロールした内容が
// 透けないよう不透明色が必要なため、同じ色合いの不透明版を別に用意する
// (rgba(20,53,37,0.06)を白背景に重ねた場合の近似値)
const SELECTED_ROW_BG = 'rgba(20, 53, 37, 0.06)';
const SELECTED_ROW_LABEL_BG = '#f1f3f2';

// ハイライト色。tokens.accent(#143525)の半透明版だが、oklch()はhtml2canvasが解釈できない
// ためrgba固定で持つ(theme.tsのshadowトークンと同じ方針)
const HIGHLIGHT_BG = 'rgba(20, 53, 37, 0.12)';

// 夜間列の背景色。tokens.background(明度違いのみ)だと白地との差が小さく分かりにくいという
// フィードバックを受け、tokens.cold(最低気温バッジで使う青)の薄め版に変更。ページ全体が
// 緑系の配色の中で青みを差し色にすることで、明度だけでなく色相でも夜間だと分かるようにする
const NIGHT_BG = 'rgba(21, 101, 192, 0.08)';

// テーブル最小幅の算出に使う列あたりの目安幅。地点列(sticky)は地点名+失敗理由の折返しを
// 考慮しやや広め、時刻列は天気アイコン32px+気温表示+風向き矢印分を確保する。
// Skeleton UI(ResultSkeleton.tsx)がtableMinWidthの算出式を重複させないためexportする
export const LABEL_COLUMN_MIN_WIDTH = 130;
// 風向き矢印(STEP6)追加分(矢印14px+gap6px)を見込んで従来の88pxから拡大
export const DATA_COLUMN_MIN_WIDTH = 112;

// セルの天気アイコンサイズ。Skeleton UI(ResultSkeleton.tsx)がここから直接参照するため
// export する(コードレビューで、Skeleton側が24pxの独自値を持ち実際の32pxとズレていた
// バグを指摘され修正した経緯がある。値の一致を仕組みで保証する)
export const MATRIX_ICON_SIZE = 32;
export const MATRIX_DATA_FONT_SIZE = 14;
// アイコン(32px)+気温+矢印を横並びに収めるため、カード側(16px)より小さめにする(STEP6)
export const MATRIX_WIND_ARROW_SIZE = 14;

// 各地点の到着予定時刻に最も近い、その地点で取得できているバケットのdtを返す
function findClosestBucketDt(point: WeatherPoint): number | null {
  const buckets = point.weather?.nearbyBuckets;
  if (!buckets || buckets.length === 0) return null;
  const arrivalTs = new Date(point.estimatedArrivalTime).getTime() / 1000;
  return buckets.reduce<number | null>((closest, bucket) => {
    if (closest === null || Math.abs(bucket.dt - arrivalTs) < Math.abs(closest - arrivalTs)) {
      return bucket.dt;
    }
    return closest;
  }, null);
}

function WeatherMatrix({ weatherData, scrollable = true, highlightedDistanceMeters }: WeatherMatrixProps) {
  const sorted = useMemo(
    () => [...weatherData].sort((a, b) => a.distanceMeters - b.distanceMeters),
    [weatherData]
  );

  // 行(地点)ごとの進行方向ベアリング。WindArrowでの向かい風/追い風判定に使う(STEP6)
  const bearings = useMemo(() => calculateRouteBearing(sorted), [sorted]);

  // 地点ごとにwindowHoursが異なりうるが、OWMの予報バケットは絶対時刻の共通グリッドに
  // 乗っているため、全地点分のdtの和集合をそのまま列として使える。
  // ただし各地点は前後対称のウィンドウで取得しており、そのまま並べるとライド時間帯の
  // 外側まで大量の列が出る(実測: 600kmブルベ=行程30時間で23列)。出発前・到着後の
  // 予報は判断に使わないため、行程をカバーする範囲(前後1バケット分の余裕つき)に絞る
  const columns = useMemo(() => {
    const dtSet = new Set<number>();
    sorted.forEach((point) => {
      point.weather?.nearbyBuckets?.forEach((bucket) => dtSet.add(bucket.dt));
    });
    const allDts = Array.from(dtSet).sort((a, b) => a - b);

    const arrivalTimestamps = sorted
      .map((p) => new Date(p.estimatedArrivalTime).getTime() / 1000)
      .filter((ts) => Number.isFinite(ts));
    if (arrivalTimestamps.length === 0) return allDts;

    const margin = 3 * 3600; // 3時間バケット1つ分
    const from = Math.min(...arrivalTimestamps) - margin;
    const to = Math.max(...arrivalTimestamps) + margin;
    const withinRide = allDts.filter((dt) => dt >= from && dt <= to);
    // 予報が行程を全くカバーできていない場合に空表示にならないよう保険をかける
    return withinRide.length > 0 ? withinRide : allDts;
  }, [sorted]);

  const timezoneOffsetSeconds = useMemo(
    () => sorted.find((p) => p.weather?.timezoneOffsetSeconds !== undefined)?.weather?.timezoneOffsetSeconds,
    [sorted]
  );

  // 夜間の列を背景色で区別する。OWMのアイコンコードは末尾"n"が夜間・"d"が昼間を表すため、
  // 既に取得済みのアイコン情報からそのまま判定でき、日の出没時刻を別途計算する必要がない。
  // 同じdt(絶対時刻)なら国内ルートでは地点によらず昼夜は一致するはずだが、
  // 念のためいずれかの地点で夜間アイコンが取れていればそのdtは夜間列として扱う
  const nightColumnSet = useMemo(() => {
    const set = new Set<number>();
    sorted.forEach((point) => {
      point.weather?.nearbyBuckets?.forEach((bucket) => {
        if (isNightIcon(bucket.weather)) set.add(bucket.dt);
      });
    });
    return set;
  }, [sorted]);

  if (sorted.length === 0 || columns.length === 0) return null;

  // 固定のminWidth(700px)だと列数が少ないルート(短距離・高速巡航等で到着予定時刻が
  // 同じ3時間バケットに収まる場合)でも常に700px確保してしまい、少ない列がその幅いっぱいに
  // 間延びして表示される不具合があった(モバイル実機のスクリーンショットで発見)。
  // 列数に応じた妥当な幅を算出し、多列の場合の可読性は維持しつつ少列の場合の間延びを防ぐ
  const tableMinWidth = LABEL_COLUMN_MIN_WIDTH + columns.length * DATA_COLUMN_MIN_WIDTH;

  return (
    <Box
      sx={{
        overflowX: scrollable ? 'auto' : 'visible',
        borderRadius: tokens.radiusForm,
        border: `1px solid ${tokens.borderSubtle}`,
      }}
    >
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse',
          width: scrollable ? '100%' : 'max-content',
          minWidth: tableMinWidth,
        }}
      >
        <Box component="thead">
          <Box component="tr">
            <Box
              component="th"
              sx={{
                // position:stickyはオンスクリーンの横スクロール表示(scrollable=true)でのみ必要。
                // ShareableView(position:fixed; left:-9999pxで画面外に配置)内で使うと、
                // html2canvasがposition:stickyの位置計算を正しく再現できず、この列がDOM順とは
                // 無関係にテーブルの右端寄りに描画されてしまう不具合があった(実機で発見)
                position: scrollable ? 'sticky' : 'static',
                left: scrollable ? 0 : undefined,
                backgroundColor: tokens.paper,
                textAlign: 'left',
                padding: '10px 14px',
                fontSize: 13,
                color: tokens.textMuted,
                borderBottom: `1px solid ${tokens.borderSubtle}`,
                whiteSpace: 'nowrap',
              }}
            >
              地点
            </Box>
            {columns.map((dt, index) => {
              // 24時間を超える行程では同じ時刻ラベルが複数回現れるため、日付が変わる
              // 列(と先頭列)に日付を添えて、どの日の予報かを区別できるようにする
              const dateLabel = formatUnixDateAtLocation(dt, timezoneOffsetSeconds);
              const showDate =
                index === 0 ||
                formatUnixDateAtLocation(columns[index - 1], timezoneOffsetSeconds) !== dateLabel;

              return (
                <Box
                  component="th"
                  key={dt}
                  sx={{
                    padding: '10px 14px',
                    fontSize: 13,
                    color: tokens.textMuted,
                    backgroundColor: nightColumnSet.has(dt) ? NIGHT_BG : undefined,
                    borderBottom: `1px solid ${tokens.borderSubtle}`,
                    borderLeft: showDate && index > 0 ? `1px solid ${tokens.border}` : undefined,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {showDate && (
                    <Box sx={{ fontSize: 11, fontWeight: 700, color: tokens.accentLabel }}>
                      {dateLabel}
                    </Box>
                  )}
                  {formatUnixTimeAtLocation(dt, timezoneOffsetSeconds)}
                </Box>
              );
            })}
          </Box>
        </Box>
        <Box component="tbody">
          {sorted.map((point, rowIndex) => {
            const bucketByDt = new Map<number, ForecastBucket>(
              (point.weather?.nearbyBuckets ?? []).map((bucket) => [bucket.dt, bucket])
            );
            const highlightDt = findClosestBucketDt(point);
            const rowBearingDeg = bearings[rowIndex];
            // 地図・標高グラフと連動する行選択(STEP6)。到着予定時刻セルの強調(highlightDt、
            // 上のisHighlighted)とは別の概念のため、変数名を分けて混同を避ける
            const isRowSelected = highlightedDistanceMeters === point.distanceMeters;

            return (
              <Box component="tr" key={`${point.distanceMeters}-${point.name}`}>
                <Box
                  component="td"
                  sx={{
                    position: scrollable ? 'sticky' : 'static',
                    left: scrollable ? 0 : undefined,
                    backgroundColor: isRowSelected ? SELECTED_ROW_LABEL_BG : tokens.paper,
                    borderLeft: isRowSelected ? `3px solid ${tokens.accent}` : undefined,
                    padding: '10px 14px',
                    fontSize: 13,
                    fontWeight: 700,
                    borderBottom: `1px solid ${tokens.borderSubtle}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {point.name}
                  {/* この地点の天気取得自体が失敗している場合、その行の全列がーになるが、
                      理由が予報範囲外なのかAPIエラーなのか分からないと利用者は判断できない。
                      カード表示(WeatherDisplay)と同じ理由文言をここにも出す */}
                  {point.error && (
                    <Typography
                      sx={{ fontSize: 10, fontWeight: 500, color: tokens.warning, whiteSpace: 'normal', mt: '2px' }}
                    >
                      {point.error}
                    </Typography>
                  )}
                </Box>
                {columns.map((dt) => {
                  const bucket = bucketByDt.get(dt);
                  const isHighlighted = highlightDt === dt;
                  return (
                    <Box
                      component="td"
                      key={dt}
                      sx={{
                        padding: '8px 12px',
                        textAlign: 'center',
                        borderBottom: `1px solid ${tokens.borderSubtle}`,
                        backgroundColor: isHighlighted
                          ? HIGHLIGHT_BG
                          : isRowSelected
                            ? SELECTED_ROW_BG
                            : nightColumnSet.has(dt)
                              ? NIGHT_BG
                              : 'transparent',
                        border: isHighlighted ? `2px solid ${tokens.accent}` : undefined,
                      }}
                    >
                      {bucket ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          {bucket.weather?.[0]?.icon && (
                            <img
                              src={`https://openweathermap.org/img/wn/${bucket.weather[0].icon}.png`}
                              alt={bucket.weather[0].description}
                              width={MATRIX_ICON_SIZE}
                              height={MATRIX_ICON_SIZE}
                              crossOrigin="anonymous"
                            />
                          )}
                          <Typography sx={{ fontSize: MATRIX_DATA_FONT_SIZE, fontWeight: isHighlighted ? 700 : 500 }}>
                            {roundTemp(bucket.tempC)}°
                          </Typography>
                          <WindArrow
                            windDeg={bucket.wind?.deg}
                            bearingDeg={rowBearingDeg}
                            size={MATRIX_WIND_ARROW_SIZE}
                            showDashWhenUnknown
                          />
                        </Box>
                      ) : (
                        <Typography sx={{ fontSize: 13, color: tokens.textMuted }}>{DASH}</Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

export default WeatherMatrix;
