import { useEffect, useMemo } from 'react';
import { saveHistoryRecord } from './offlineHistory';
import type { OfflineHistorySource, RouteWeatherParams, TrackPoint, WeatherPoint } from './types';

/**
 * 天気取得結果を圏外でも閲覧できるよう、IndexedDBに自動保存するフック。
 * 同一内容の繰り返し保存は saveHistoryRecord 側でガードされている。
 *
 * @param params 現在のルート・天気取得条件
 * @param hasLiveResult データフェッチが成功し結果が存在するか
 * @param routeData API等から取得したルートデータ (ルート名と track_points を含む)
 * @param weatherPoints API等から取得した各地点の天気データ
 */
export function useOfflineHistorySync(
  params: RouteWeatherParams,
  hasLiveResult: boolean,
  routeData: { route: { name?: string; track_points: TrackPoint[] } } | undefined,
  weatherPoints: WeatherPoint[] | undefined
) {
  // オフライン履歴への保存用データ。routeSource等が変わったときだけ再計算すればよいので、
  // 依存配列に実際に参照する値を過不足なく書ける形にまとめている(以前はweatherQuery.dataUpdatedAt
  // だけを依存にし、実際に参照するparams.routeSource等をeslint-disableで無理やり外していた。
  // コードレビューで指摘され、こちらの形に整理した)。
  // 当初はアップロードファイル由来のみ保存対象だったが、「圏外の山中で出発前に見たルートを
  // 見返したい」というSTEP3の想定シーンに合わせ、RWGPSルートも対象に含めるよう拡張した
  // (ユーザーとの相談の上、STEP3完了後に対応)
  const historySaveInput = useMemo(() => {
    if (!params.routeSource || params.averageSpeedKmh === null) return null;
    const source: OfflineHistorySource =
      params.routeSource.type === 'upload'
        ? { type: 'upload', fileName: params.routeSource.fileName }
        : { type: 'rwgps', routeId: params.routeSource.routeId };
    return {
      source,
      params: {
        selectedDate: params.selectedDate,
        selectedTime: params.selectedTime,
        averageSpeedKmh: params.averageSpeedKmh,
        arrivalCorrectionEnabled: params.arrivalCorrectionEnabled,
      },
    };
  }, [
    params.routeSource,
    params.selectedDate,
    params.selectedTime,
    params.averageSpeedKmh,
    params.arrivalCorrectionEnabled,
  ]);

  // 天気取得結果は、圏外でも閲覧できるようIndexedDBに自動保存する(docs/IMPROVEMENT_PLAN.md STEP2、
  // RWGPS対応はSTEP3完了後に追加)。タブ復帰・ネットワーク再接続のたびにTanStack Queryが
  // 再フェッチしうるため、同一内容の繰り返し保存はsaveHistoryRecord側(offlineHistory.ts)で
  // ガードしている
  useEffect(() => {
    if (historySaveInput && hasLiveResult && routeData && weatherPoints) {
      // historySaveInput(params由来のuseMemo)はまだルート名を知らないため、実際に
      // 保存するこの時点(routeData確定後)でRWGPSのルート名(route.name)を
      // 合成する(STEP5、オフライン履歴の表示をルートIDだけでなく分かりやすくする)
      const source: OfflineHistorySource =
        historySaveInput.source.type === 'rwgps'
          ? { ...historySaveInput.source, title: routeData.route.name }
          : historySaveInput.source;
      saveHistoryRecord({
        ...historySaveInput,
        source,
        trackPoints: routeData.route.track_points,
        weatherPoints: weatherPoints,
      });
    }
  }, [historySaveInput, hasLiveResult, routeData, weatherPoints]);
}
