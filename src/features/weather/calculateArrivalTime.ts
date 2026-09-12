import type { TrackPoint } from './types';

// 固定の経験則定数(壁打ちの結論、docs/STEP7機能設計_壁打ちプロンプト.mdの目安値をそのまま採用)。
// 将来ユーザーが数値を調整できるようにする場合は、ここを差し替えポイントにする
export const ELEVATION_CORRECTION_MINUTES_PER_100M = 4;
export const REST_MINUTES_PER_RIDING_HOUR = 10;

/**
 * 生trackPoints(距離dが昇順)を1回スキャンし、指定した各距離地点(distancesMeters, 昇順)における
 * 累積獲得標高(上りの標高差の合計、下りは無視)を返す(マージスキャンでO(n))。
 *
 * 表示用に間引いた代表地点(keyPoints、既定10点)だけを見て隣接点間の標高差を取ると、
 * その10点の間にある実際の細かい登り下りが直線補間で潰れ、短く急な峠を見落とすリスクが
 * 高いため、間引き前の生trackPointsを走査する(壁打ちの結論)。
 */
export function elevationGainAtDistances(trackPoints: TrackPoint[], distancesMeters: number[]): number[] {
  const gains = new Array<number>(distancesMeters.length).fill(0);
  if (trackPoints.length === 0) return gains;

  let targetIndex = 0;
  let cumulativeGain = 0;
  // 標高(e)が一度も現れていない区間は「差分0(登坂とみなさない)」として扱う。
  // 以前は先頭点の欠損だけを決め打ちの0で扱っており、2点目以降に実測標高が
  // 現れた瞬間にその絶対値が丸ごと獲得標高としてカウントされるバグがあった
  // (コードレビューで発見。到着時刻が実測で約21分ずれるケースを確認)
  let prevElevation: number | undefined = trackPoints[0].e;

  // 先頭地点(距離0)を目標距離に含む場合、まだ何も走査していない時点の
  // 累積獲得標高(0)をここで記録する。省略すると先頭の目標距離が最初の
  // 区間の標高差で汚染されてしまう(コードレビューで発見)
  while (targetIndex < distancesMeters.length && (trackPoints[0].d ?? 0) >= distancesMeters[targetIndex]) {
    gains[targetIndex] = cumulativeGain;
    targetIndex++;
  }

  for (let i = 1; i < trackPoints.length; i++) {
    const point = trackPoints[i];
    const elevation = point.e ?? prevElevation;
    if (prevElevation !== undefined && elevation !== undefined) {
      const diff = elevation - prevElevation;
      if (diff > 0) cumulativeGain += diff;
    }
    if (elevation !== undefined) prevElevation = elevation;

    // 現在のtrackPointの距離が、まだ記録していない目標距離に到達または超過したら記録する
    while (targetIndex < distancesMeters.length && (point.d ?? 0) >= distancesMeters[targetIndex]) {
      gains[targetIndex] = cumulativeGain;
      targetIndex++;
    }
  }
  // ルート終点より先の目標距離(ルート全体の累積獲得標高)が残っていれば埋める
  while (targetIndex < distancesMeters.length) {
    gains[targetIndex] = cumulativeGain;
    targetIndex++;
  }
  return gains;
}

/**
 * 距離・平均時速・出発時刻から、到着予想時刻を算出する。
 *
 * @param startDate 出発時刻
 * @param distanceMeters 出発地点からの距離 (メートル)
 * @param averageSpeedKmh 平均時速 (km/h)
 * @param elevationGainMeters 出発地点からの累積獲得標高 (メートル)。applyCorrection=falseの場合は無視される
 * @param applyCorrection 獲得標高・休憩時間の補正を適用するか(ユーザーが選べるON/OFFトグルの実体)。
 *   falseの場合は従来通り「距離÷平均時速」の単純計算のみを返す
 * @returns 到着予想時刻
 */
export function calculateArrivalTime(
  startDate: Date,
  distanceMeters: number,
  averageSpeedKmh: number,
  elevationGainMeters: number = 0,
  applyCorrection: boolean = true
): Date {
  const speedMetersPerSecond = (averageSpeedKmh * 1000) / 3600;
  const flatSeconds = distanceMeters / speedMetersPerSecond;

  if (!applyCorrection) {
    return new Date(startDate.getTime() + flatSeconds * 1000);
  }

  // ヒルクライム補正: 獲得標高100mにつきELEVATION_CORRECTION_MINUTES_PER_100M分を加算する
  // (ロードバイクの体感則。3〜5分/100mという経験則の中間値を採用。壁打ちの結論)
  const elevationCorrectionSeconds = (elevationGainMeters / 100) * ELEVATION_CORRECTION_MINUTES_PER_100M * 60;
  const movingSeconds = flatSeconds + elevationCorrectionSeconds;

  // 休憩時間補正: 移動時間(平坦+獲得標高補正後)を基準に、走行1時間につき
  // REST_MINUTES_PER_RIDING_HOUR分の休憩を加算する。休憩時間そのものを基準に含めると
  // 循環参照になるため、あくまで移動時間だけを基準にする(壁打ちの結論)
  const restSeconds = (movingSeconds / 3600) * REST_MINUTES_PER_RIDING_HOUR * 60;

  return new Date(startDate.getTime() + (movingSeconds + restSeconds) * 1000);
}
