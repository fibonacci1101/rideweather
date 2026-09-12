# リファクタリング・バックログ

過去の多角的コードレビューで見つかったが、実害が小さい(Low〜Medium)ため見送ってきた構造改善の指摘を、**ファイル単位**でまとめたもの。機能追加のバックログ(POI表示等)は開発用リポジトリ側の機能選定メモにあり、本リポジトリには含めていない。テストカバレッジの状況は`CLAUDE.md`の`npm run test:coverage`節を参照。

## 使い方

該当ファイルを次に触る(機能追加・バグ修正等)タイミングで、このリストに載っている項目もついでに直せないか確認する。**全件を機械的に消化する必要はない**(CLAUDE.mdの運用方針通り、費用対効果を見て都度判断してよい)。対応したら該当項目を削除し、このファイルの末尾にどのコミット/STEPで対応したかを一言残しておくと後から追跡しやすい。

---

## `src/features/weather/useRouteWeather.ts`

- **`fetchWeatherPoint`が9個の位置引数を取り、同型(`Date`)の`startDate`/`routeStartDate`が隣接している**。呼び出し側は実際に同じ変数を2回渡しており、将来引数を増やしたり順序を変えたりした際に型では検出できない事故が起きうる。オプションオブジェクト化(`{ point, index, total, startDate, ... }`)を推奨。(出典: STEP7多角的レビュー、Medium)

## `src/features/weather/offlineHistory.ts`

- **`saveHistoryRecord`が「重複判定」「titleバックフィル」「新規保存」「FIFO削除」の4責務を1関数(~85行)に持たせている**。各ブロックは丁寧にコメントされているが、トップレベルの制御フローを一望しづらい。`findDuplicateRecord`/`backfillTitleIfNeeded`/`evictOldestRecords`等のヘルパーへの分割を検討。(出典: STEP7多角的レビュー、Low-Medium)
- **重複判定の読み取りと書き込み・FIFO削除が別トランザクション**。同時実行下(同一タブで複数保存が競合する等)で稀に重複行が生じうる。実害はストレージ肥大化のみで自己修復されるためLowだが、対応する場合は`getAll()`→重複判定→`put()`→FIFO`delete()`を単一の`readwrite`トランザクションに統合する。(出典: STEP3 Phase9事後レビュー、Low)

## `src/features/weather/offlineHistory.ts` / `src/features/weather/format.ts`(横断)

- **「`arrivalCorrectionEnabled`がundefinedなら補正なし扱い」という同じ意図のロジックが、`offlineHistory.ts`(`?? false`での比較)と`format.ts`(truthy判定)とで異なる書き方で重複している**。振る舞いは一致しているため実害はないが、将来どちらか一方だけ修正漏れするリスクがある。共有の小さなヘルパー(例: `resolveArrivalCorrectionEnabled(value: boolean | undefined): boolean`)への切り出しを検討。(出典: STEP7多角的レビュー、Low)

## `src/features/weather/format.ts`

- **`formatOfflineHistoryConditions`の引数型が`OfflineHistoryRecord['params']`の手動複製**。TypeScriptの構造的部分型のため、`OfflineHistoryRecord['params']`にフィールドが追加・変更されてもこちらは追随せず型エラーにならない。`import type { OfflineHistoryRecord } from './offlineHistory'`して`OfflineHistoryRecord['params']`から導出する形に変更すると防げる。(出典: STEP7多角的レビュー、Low)

## `src/components/InfoDialog.tsx`

STEP7でロードマップセクションを削除したばかりで構成が変わったので、次に触るタイミングでまとめて見直すとよい。

- Dialog Paperの角丸が`radiusControl`のまま(`radiusForm`にすべき)
- `SectionHeading`が`OfflineHistoryPanel.tsx`のローカルコンポーネントと重複
- 更新履歴・QAコンテンツの配置場所の一貫性(`features/info`への外出し有無が項目によってバラバラ)
- ラベル+本文というUIパターンの共通化(更新履歴・QAで似た構造を毎回書いている)
- リスト`key`の一意性の再確認
- `QA_ITEMS`の型が匿名インライン型
- パフォーマンス系2件(バンドルサイズ、再レンダリング頻度)

(出典: STEP5多角的レビュー、いずれもLow)

## `src/components/WeatherMatrix.tsx` / `src/components/WeatherDisplay.tsx`

- **`isRowSelected`/`isSelected`のように、同じ「選択中の強調表示」を指すpropが2ファイルで命名不統一**。どちらかに揃えるか、共通の命名規約を決める
- 風向きベアリングのソート+算出(`sortAndBearing`的なパターン)が2ファイルで重複実装されている

(出典: STEP6多角的レビュー、いずれもLow)

## `src/features/weather/interpolateTrackPosition.ts` / `src/features/weather/bearing.ts`

- **`TrackPosition`型(interpolateTrackPosition.ts)と`LatLon`型(bearing.ts)が、構造的に同一の型(`{lat: number, lon: number}`相当)を別名で二重定義している**。どちらかに統一し、もう一方は型エイリアスにする。(出典: STEP6多角的レビュー、Low)

## `src/theme.ts`

- **`crosswind`/`windTailwind`という2つのデザイントークンの命名が、接頭辞/接尾辞の付け方で非対称**(`wind`が前に付くものと付かないものが混在)。命名規則を統一する。(出典: STEP6多角的レビュー、Low)

## `src/features/weather/types.ts`

- **`ForecastBucket.wind`が`NormalizedWeather.wind`と同一形状(`{speed, deg}`)をインラインで再定義している**。`Pick<NormalizedWeather, 'wind'>`等で単一の定義元から導出する形にすると、将来の形状変更時の追随漏れを防げる。(出典: STEP6多角的レビュー、Low)

## `src/components/ElevationChart.tsx`

- **`resolveDistanceMetersFromLabel`の引数型が`unknown`**。Rechartsが提供する`ActiveLabel`相当の型があればそちらを使う方が、実際に受け取りうる値の範囲が型で表現できて安全。(出典: STEP6多角的レビュー、Low)

## `src/main.tsx`

- **`QueryClient`の設定(`networkMode: 'always'`等)が`main.tsx`にベタ書きで、テストで検証できる形になっていない**。別ファイルに切り出すとユニットテストの対象にできる。カバレッジ計測でも`main.tsx`は0%(観点上仕方ない面はあるが、設定オブジェクト自体を切り出せばそこだけはテスト可能になる)。(出典: STEP3多角的レビュー、Medium/中コストのため見送り継続中)

## ビルド・インフラ

- **`dist/sw.js`のprecache/denylist設定を自動検証するpostbuildスクリプトが無い**。手動確認に依存している。個人開発PJの規模では今すぐ必須ではないが、Service Worker関連の変更をする回に合わせて検討する価値はある。(出典: STEP3多角的レビュー、Low)

---

## 対応済み(記録として残す)

- ~~`calculateArrivalTime.ts`が存在せず到着時刻計算ロジックがテストできない~~ → STEP7で新規作成・テスト追加済み
- ~~`worker/index.ts`・`worker/routes/route.ts`・`worker/routes/weather.ts`のテストカバレッジが薄い~~ → 2026-08-22、worker/lib/testFakes.ts新設+3ファイルへのテスト追加で解消(STEP7)
