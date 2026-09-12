import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import InputForm, { type InputFormSubmitParams } from './components/InputForm';
import WeatherDisplay from './components/WeatherDisplay';
import WeatherMatrix from './components/WeatherMatrix';
import ShareableView from './components/ShareableView';
import ExportImageButton from './components/ExportImageButton';
import CopyLinkButton from './components/CopyLinkButton';
import SummaryBanner from './components/SummaryBanner';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';
import InfoDialog from './components/InfoDialog';
import ResultSkeleton, { ElevationChartSkeleton, RouteMapSkeleton } from './components/ResultSkeleton';

// leaflet/rechartsはメインバンドルの大半を占めるため(STEP4時点で合計約550KB gzip前)、
// 結果が実際に表示されるまで読み込まない。ShareableView.tsx側も同じモジュール指定子で
// 動的importする(そちらを静的importのままにすると依存グラフ経由でメインチャンクに
// 巻き戻ってしまい、分割の効果が消える)
const RouteMap = lazy(() => import('./components/RouteMap'));
const ElevationChart = lazy(() => import('./components/ElevationChart'));
import { useRouteWeather } from './features/weather/useRouteWeather';
import { useUnreadAnnouncement } from './features/info/useUnreadAnnouncement';
import { DEFAULT_KEY_POINT_COUNT } from './features/weather/extractKeyPoints';
import { findNearestPointByDistance } from './features/weather/findNearestPoint';
import { exportFileNameSuffixFromSource, formatOfflineHistoryConditions, formatOfflineHistorySourceLabel, formatSavedAt, formatSubmittedConditions, getRouteSunTimes, offlineErrorMessage } from './features/weather/format';
import { useUrlSync } from './features/weather/useUrlSync';
import { useOfflineHistorySync } from './features/weather/useOfflineHistorySync';
import type { OfflineHistoryRecord } from './features/weather/offlineHistory';
import type { RouteSource, RouteWeatherParams, TrackPoint, WeatherPoint } from './features/weather/types';
import { tokens } from './theme';

function exportFileNameSuffix(routeSource: RouteSource | null): string {
  return routeSource ? exportFileNameSuffixFromSource(routeSource) : 'route';
}

function App() {
  const [params, setParams] = useUrlSync();
  const [formExpanded, setFormExpanded] = useState(() => params.routeSource === null);
  const [submitCount, setSubmitCount] = useState(0);
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards');
  // IndexedDBのオフライン履歴から選択した保存済みデータを表示中の場合に設定する。
  // 設定されている間はネットワーク経由の結果(routeQuery/weatherQuery)より優先して表示する
  const [offlineView, setOfflineView] = useState<OfflineHistoryRecord | null>(null);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  // 地図・標高グラフ・天気表(カード/マトリックス)の連動ハイライト(STEP6)。
  // クリック/タップでの固定選択(トグル)と、ホバー中の一時プレビューを別のstateに分ける。
  // 表示に使う実効値はホバー優先(ホバーが外れたら固定選択に戻る)。
  // 地点の同一性は配列インデックスではなくdistanceMeters(代表地点の一意なキー、
  // 既存コードでもkey={`${point.distanceMeters}-${point.name}`}として使われている)で
  // 判定する。RouteMap/ElevationChart/WeatherMatrix/WeatherDisplayは独立にソート/フィルタ
  // する可能性があり、配列インデックスの一致に依存すると将来の実装変更で暗黙に壊れうるため
  const [pinnedDistanceMeters, setPinnedDistanceMeters] = useState<number | null>(null);
  const [hoverDistanceMeters, setHoverDistanceMeters] = useState<number | null>(null);
  // 生の位置(代表地点への丸め込みなし)。峠のピーク等、代表地点に無い任意の位置も
  // 地図上に示せるようにするため、丸め込みは行わない(下記displayWeatherPoints算出後に
  // 天気表・マーカー強調用の丸め込み済み値を別途算出する)
  const rawHighlightDistanceMeters = hoverDistanceMeters ?? pinnedDistanceMeters;
  const handleTogglePinnedPoint = (distanceMeters: number) => {
    setPinnedDistanceMeters((prev) => (prev === distanceMeters ? null : distanceMeters));
  };
  // ElevationChartのクリックは代表地点への丸め込みをしない生の位置を渡すため、地図マーカーの
  // クリック(常に代表地点の固定値)と違い、同じ場所付近を再クリックしてもピクセル位置の
  // わずかなズレで別の(隣接する)distanceMetersになり、選択解除ではなく別位置への再ピンに
  // なってしまう不具合だった(コードレビューで発見)。トグルの基準値を代表地点の固定値に
  // 揃えるため、ここで一度丸め込んでからhandleTogglePinnedPointに渡す
  const handleToggleFromChart = (distanceMeters: number) => {
    const nearest = findNearestPointByDistance(displayWeatherPoints, distanceMeters / 1000);
    handleTogglePinnedPoint(nearest?.distanceMeters ?? distanceMeters);
  };
  const { hasUnread: hasUnreadAnnouncement, markAsRead: markAnnouncementAsRead } = useUnreadAnnouncement();
  const { routeQuery, weatherQuery } = useRouteWeather(params);
  const exportTargetRef = useRef<HTMLDivElement>(null);
  // エラー表示に使うのは「表示する瞬間のライブなisOnline」ではなく「そのエラーが
  // 発生した時点のisOnline」のスナップショットにする。ライブ値をそのまま使うと、
  // オンライン中に別の理由(不正なルートID等)で失敗した直後に電波が途切れた場合、
  // 表示が本当の原因とは無関係な「オフラインです」に化けてしまう不具合があった
  // (コードレビューで発見)。routeQuery.error/weatherQuery.errorが新しい値に
  // 変わった=新しい失敗が起きた瞬間にだけisOnlineを読み直して固定する
  const [routeErrorWasOffline, setRouteErrorWasOffline] = useState(false);
  const [weatherErrorWasOffline, setWeatherErrorWasOffline] = useState(false);
  useEffect(() => {
    if (routeQuery.error) setRouteErrorWasOffline(!navigator.onLine);
  }, [routeQuery.error]);
  useEffect(() => {
    if (weatherQuery.error) setWeatherErrorWasOffline(!navigator.onLine);
  }, [weatherQuery.error]);

  // RouteMap/ElevationChartのチャンクを、天気データ取得(routeQuery/weatherQuery)と並行して
  // 先読みする。Suspenseのfallback(RouteMapSkeleton/ElevationChartSkeleton)は`hasResult`が
  // 確定してから初めてマウントされるため、prefetchしないとチャンク取得が天気データ取得の
  // 「後に直列で」発生し、動的import化(STEP4)の効果を一部相殺してしまう
  // (コードレビューで指摘)。ここでのimport()は下記のReact.lazy()と同じモジュール指定子を
  // 呼ぶだけで、解決結果(モジュールキャッシュ)を共有するため重複ダウンロードは発生しない
  useEffect(() => {
    if (params.routeSource === null) return;
    import('./components/RouteMap').catch(() => {});
    import('./components/ElevationChart').catch(() => {});
  }, [params.routeSource]);

  const handleSubmit = (submitted: InputFormSubmitParams) => {
    const nextParams: RouteWeatherParams = {
      routeSource: submitted.routeSource,
      selectedDate: submitted.selectedDate,
      selectedTime: submitted.selectedTime,
      averageSpeedKmh: submitted.averageSpeedKmh,
      arrivalCorrectionEnabled: submitted.arrivalCorrectionEnabled,
    };
    setParams(nextParams);
    setSubmitCount((count) => count + 1);
    setOfflineView(null);
    // 新しいルートでは以前のハイライト対象(distanceMeters)が意味を持たなくなるためリセットする
    setPinnedDistanceMeters(null);
    setHoverDistanceMeters(null);
  };

  const hasLiveResult = routeQuery.isSuccess && weatherQuery.isSuccess;
  const hasResult = offlineView !== null || hasLiveResult;

  // 表示データソースの一本化: オフライン履歴選択時はそちらを優先し、それ以外は
  // 通常のライブクエリ結果を使う。RouteMap/ElevationChart等はこの2値だけを見れば済む
  const displayTrackPoints: TrackPoint[] = offlineView
    ? offlineView.trackPoints
    : (routeQuery.data?.route.track_points ?? []);
  const displayWeatherPoints: WeatherPoint[] = offlineView
    ? offlineView.weatherPoints
    : (weatherQuery.data ?? []);

  // 天気表(カード/マトリックス)・地図マーカーの強調は代表地点(WeatherPoint)単位でしか
  // 存在しないため、生のホバー/クリック位置(rawHighlightDistanceMeters)に最も近い
  // 代表地点に丸め込んだ値を使う。地図上の現在位置ドット(RouteMapのhoverPositionDistanceMeters)
  // は丸め込まない生の値をそのまま使う(STEP6)
  const highlightedPoint =
    rawHighlightDistanceMeters !== null
      ? findNearestPointByDistance(displayWeatherPoints, rawHighlightDistanceMeters / 1000)
      : null;
  const highlightedDistanceMeters = highlightedPoint?.distanceMeters ?? null;

  // ResultSkeleton用: ルート取得済みなら実際の代表地点数(最大DEFAULT_KEY_POINT_COUNT)、
  // 未取得ならDEFAULT_KEY_POINT_COUNTのまま。短距離ルート(trackPoints 10点未満)で
  // Skeletonのカード枚数/行数が実表示と食い違わないようにする(コードレビューで指摘)
  const skeletonPointCount = routeQuery.data
    ? Math.min(DEFAULT_KEY_POINT_COUNT, routeQuery.data.route.track_points.length)
    : DEFAULT_KEY_POINT_COUNT;

  const sunTimes = hasResult ? getRouteSunTimes(displayWeatherPoints) : null;
  const conditionsLabel = offlineView
    ? formatOfflineHistoryConditions(offlineView)
    : formatSubmittedConditions(params);

  // 送信「成功後」に畳む(失敗時はフォームを開いたままにし、入力値を直接見て修正できるようにする)。
  // submitCountも依存に含めることで、パラメータが変わらない再送信(キャッシュ済みで即成功)でも
  // 確実に折りたたみを再実行する
  useEffect(() => {
    if (hasLiveResult) setFormExpanded(false);
  }, [hasLiveResult, submitCount]);

  useOfflineHistorySync(params, hasLiveResult, routeQuery.data, weatherQuery.data);

  return (
    <Box
      sx={{
        maxWidth: 1080,
        margin: '32px auto',
        backgroundColor: tokens.background,
        borderRadius: tokens.radiusContainer,
        boxShadow: tokens.shadowContainer,
        padding: '40px 24px 56px',
      }}
    >
      <PwaUpdatePrompt />
      <Box sx={{ mb: '28px' }}>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: tokens.accentLabel,
          }}
        >
          Ride Weather App
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: 24, sm: 30 },
            fontWeight: 800,
            mt: '4px',
          }}
        >
          ルート天気予報
        </Typography>
        <Typography sx={{ fontSize: 14, color: tokens.textMuted, mt: '6px' }}>
          Ride with GPS のルートを指定し、走行日時に応じた各地点の天気を確認できます。
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ mt: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Box
            sx={{
              display: 'inline-flex',
              fontSize: 11,
              fontWeight: 700,
              color: tokens.accent,
              backgroundColor: '#ffffff',
              border: `1px solid ${tokens.exportButtonBorder}`,
              borderRadius: '999px',
              padding: '3px 12px',
            }}
          >
            無料・登録不要ですぐ使えます
          </Box>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              setInfoDialogOpen(true);
              markAnnouncementAsRead();
            }}
            sx={{ fontSize: 11, color: tokens.textMuted, padding: '3px 8px', minWidth: 0 }}
          >
            お知らせ
            {hasUnreadAnnouncement && (
              <Box
                component="span"
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: tokens.warningDot,
                  ml: '5px',
                }}
              />
            )}
          </Button>
        </Stack>
      </Box>
      <InfoDialog open={infoDialogOpen} onClose={() => setInfoDialogOpen(false)} />

      {formExpanded ? (
        <InputForm
          onSubmit={handleSubmit}
          initialValues={
            params.routeSource !== null
              ? {
                  routeSource: params.routeSource,
                  selectedDate: params.selectedDate,
                  selectedTime: params.selectedTime,
                  averageSpeedKmh: params.averageSpeedKmh,
                  arrivalCorrectionEnabled: params.arrivalCorrectionEnabled,
                }
              : undefined
          }
          onSelectOfflineHistory={(record) => {
            setOfflineView(record);
            setFormExpanded(false);
            setPinnedDistanceMeters(null);
            setHoverDistanceMeters(null);
          }}
        />
      ) : (
        // オフライン履歴だけを選択し一度もフォーム送信していない場合(params.routeSourceが
        // null)でも、この「条件を変更」ボタンが無いとフォームに戻る手段が無くなり画面が
        // 行き止まりになる(コードレビューで発見)。offlineViewの有無もガードに含める
        (params.routeSource !== null || offlineView !== null) && (
          <Box
            sx={{
              backgroundColor: tokens.paper,
              borderRadius: tokens.radiusForm,
              boxShadow: tokens.shadow,
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Typography sx={{ fontSize: 13, color: tokens.textMuted }}>
              {conditionsLabel}
            </Typography>
            <Button
              variant="outlined"
              onClick={() => setFormExpanded(true)}
              sx={{
                backgroundColor: tokens.paper,
                borderColor: tokens.exportButtonBorder,
                color: tokens.accent,
                fontSize: 13,
                padding: '6px 14px',
              }}
            >
              条件を変更
            </Button>
          </Box>
        )
      )}

      {offlineView && (
        <Box
          sx={{
            mt: params.routeSource !== null ? 2 : 0,
            backgroundColor: tokens.warningBannerBg,
            borderRadius: tokens.radiusForm,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Typography sx={{ fontSize: 13 }}>
            保存データを表示中: {formatOfflineHistorySourceLabel(offlineView.source)}(保存日時 {formatSavedAt(offlineView.savedAt)})
          </Typography>
          <Button
            variant="outlined"
            onClick={() => {
              setOfflineView(null);
              // ライブ結果(routeSource)が無い状態(初回アクセスからオフライン履歴だけを
              // 見ていた場合)で閉じると、「条件を変更」ボタンの表示条件
              // (routeSource !== null || offlineView !== null)も同時に false になり、
              // 画面が行き止まりになる。閉じる操作自体でフォームに戻す
              if (params.routeSource === null) setFormExpanded(true);
              // 表示データソースが切り替わるため、以前のハイライト対象(distanceMeters)は
              // 意味を持たなくなる。handleSubmit/onSelectOfflineHistoryと同様にリセットする
              // (この経路だけリセット漏れがあるとコードレビューで発見)
              setPinnedDistanceMeters(null);
              setHoverDistanceMeters(null);
            }}
            sx={{
              backgroundColor: tokens.paper,
              borderColor: tokens.exportButtonBorder,
              color: tokens.accent,
              fontSize: 13,
              padding: '6px 14px',
            }}
          >
            閉じる
          </Button>
        </Box>
      )}

      <Stack spacing={3} sx={{ mt: 3 }}>
        {/* まだ結果が無い初回取得中は、地図・標高グラフ・天気カード/表の枠組みだけを先に
            見せるSkeleton UIで体感待ち時間を短縮する。既に結果が表示済みの状態での
            バックグラウンド再取得(タブ復帰等)まで同じ条件にすると、実データが一瞬
            Skeletonに置き換わる退行になるため、hasResultで両者を明確に分ける */}
        {!offlineView && !hasResult && (routeQuery.isFetching || weatherQuery.isFetching) && (
          <ResultSkeleton viewMode={viewMode} pointCount={skeletonPointCount} />
        )}
        {!offlineView && hasResult && (routeQuery.isFetching || weatherQuery.isFetching) && <CircularProgress />}

        {!offlineView && routeQuery.isError && (
          <Typography color="error">
            {routeErrorWasOffline ? offlineErrorMessage(params.routeSource) : (routeQuery.error as Error).message}
          </Typography>
        )}
        {!offlineView && weatherQuery.isError && (
          <Typography color="error">
            {weatherErrorWasOffline ? offlineErrorMessage(params.routeSource) : (weatherQuery.error as Error).message}
          </Typography>
        )}

        {hasResult && (
          <>
            <Suspense fallback={<RouteMapSkeleton />}>
              <RouteMap
                trackPoints={displayTrackPoints}
                weatherPoints={displayWeatherPoints}
                highlightedDistanceMeters={highlightedDistanceMeters}
                hoverPositionDistanceMeters={rawHighlightDistanceMeters}
                onPointClick={handleTogglePinnedPoint}
              />
            </Suspense>
            <Suspense fallback={<ElevationChartSkeleton />}>
              <ElevationChart
                trackPoints={displayTrackPoints}
                weatherPoints={displayWeatherPoints}
                highlightedDistanceMeters={rawHighlightDistanceMeters}
                onHoverPoint={setHoverDistanceMeters}
                onTogglePoint={handleToggleFromChart}
              />
            </Suspense>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
              }}
            >
              <Typography sx={{ fontSize: 20, fontWeight: 800 }}>天気予報</Typography>
              <Box sx={{ textAlign: 'right' }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: { xs: 'flex-end', sm: 'center' }, justifyContent: 'flex-end' }}
                >
                  <ToggleButtonGroup
                    value={viewMode}
                    exclusive
                    size="small"
                    onChange={(_event, next: 'cards' | 'matrix' | null) => {
                      if (next) setViewMode(next);
                    }}
                    sx={{
                      backgroundColor: '#ffffff',
                      '& .MuiToggleButton-root': {
                        fontSize: 12,
                        padding: '4px 12px',
                        borderColor: tokens.exportButtonBorder,
                        color: tokens.accent,
                        '&.Mui-selected': {
                          backgroundColor: tokens.accent,
                          color: '#ffffff',
                          '&:hover': { backgroundColor: tokens.accent },
                        },
                      },
                    }}
                  >
                    <ToggleButton value="cards">カード</ToggleButton>
                    <ToggleButton value="matrix">時間帯表</ToggleButton>
                  </ToggleButtonGroup>
                  {!offlineView && params.routeSource?.type === 'rwgps' ? (
                    <CopyLinkButton />
                  ) : (
                    <Typography sx={{ fontSize: 12, color: tokens.textMuted }}>
                      {offlineView ? '保存データはリンク共有に対応していません' : 'アップロードしたルートはリンク共有に対応していません'}
                    </Typography>
                  )}
                  <ExportImageButton
                    targetRef={exportTargetRef}
                    fileName={`ride-weather-${offlineView ? exportFileNameSuffixFromSource(offlineView.source) : exportFileNameSuffix(params.routeSource)}.jpg`}
                  />
                </Stack>
                <Typography sx={{ fontSize: 11, color: tokens.textMuted, mt: '4px' }}>
                  保存した画像は電波が無い場所でも確認できます
                </Typography>
              </Box>
            </Box>

            <Stack spacing={2}>
              {sunTimes && (
                <Typography sx={{ fontSize: 13, color: tokens.textMuted }}>
                  日の出 {sunTimes.sunrise} ・ 日の入り {sunTimes.sunset}
                </Typography>
              )}
              <SummaryBanner weatherData={displayWeatherPoints} />
              {viewMode === 'cards' ? (
                <WeatherDisplay
                  weatherData={displayWeatherPoints}
                  highlightedDistanceMeters={highlightedDistanceMeters}
                />
              ) : (
                <WeatherMatrix
                  weatherData={displayWeatherPoints}
                  highlightedDistanceMeters={highlightedDistanceMeters}
                />
              )}
            </Stack>

            {/* 画像保存(SNS共有)専用レイアウト。画面表示のカード一覧を縦にそのまま
                エクスポートすると地点数が多いルートで長大な画像になるため、常に
                コンパクトなWeatherMatrixを使う専用ビューを別途キャプチャ対象にする
                (ShareableView.tsx参照。画面には表示しない) */}
            <ShareableView
              ref={exportTargetRef}
              trackPoints={displayTrackPoints}
              weatherPoints={displayWeatherPoints}
              sunTimes={sunTimes}
              conditionsLabel={conditionsLabel}
            />
          </>
        )}
      </Stack>
    </Box>
  );
}

export default App;
