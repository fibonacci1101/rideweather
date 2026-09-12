# CLAUDE.md

このリポジトリで AI コーディングエージェント(Claude Code)に作業させる際のガイドライン。
人間が読んでも「このプロジェクトで何を守っているか」が分かるように書いている。

**このリポジトリについて**: 開発は別の非公開リポジトリで行っており、ここはそのスナップショット。
セッション間の引き継ぎ用の進捗記録(`docs/PROGRESS.md`)・STEP ごとの実装計画と作業ログ(`plans/`)・
多角的レビューの依頼プロンプト(`docs/review/`)は非公開リポジトリ側にあり、ここには含めていない。
コードやドキュメント中にそれらのファイル名が参照として登場するのはそのためで、
判断の出どころを消さないようにあえて残している。

## ドキュメント体系

- [docs/DESIGN.md](docs/DESIGN.md): 設計判断・アーキテクチャ・技術的な意思決定の記録。決定事項が変わったらここを更新する
- [docs/CODE_READING_GUIDE.md](docs/CODE_READING_GUIDE.md): 処理フローと、どのファイルから読み進めるとよいかのガイド
- [docs/REFACTOR_BACKLOG.md](docs/REFACTOR_BACKLOG.md): 過去のレビューで見つかった構造改善の指摘をファイル単位でまとめたバックログ。該当ファイルを触るたびに確認する
- [docs/TEST_IMPROVEMENT_PLAN.md](docs/TEST_IMPROVEMENT_PLAN.md): STEP6時点のテスト評価と補強計画(指摘事項はSTEP7で解消済み。当時の記録として残している)
- [docs/design_handoff_ride_weather_ui/](docs/design_handoff_ride_weather_ui/): UI リデザインのハンドオフ資料(デザイン案の HTML とスクリーンショット)

## 開発コマンド

- `npm run start`(`build && wrangler dev`)で `localhost:8787` 起動。フロントの見た目だけを見るなら `npm run dev`(Vite 単体。`/api/*` は動かない)
- コード変更のたびに `tsc -b` / `vitest run` / `oxlint` / `npm run build` を通すこと
- テストカバレッジの確認は `npm run test:coverage`。既定では**テストファイルが存在するソースファイルのみ**を分母にするため数字が実態より良く見える。表示コンポーネント(Leaflet/Recharts依存等、jsdomでの検証が壊れやすいためブラウザでの実機確認に委ねている)を含む全ソースファイルを分母にした実態を見たい場合は `npx vitest run --coverage --coverage.all=true` を使うこと

## 絶対厳守ルール

- **`master` へのマージ・`wrangler deploy`(本番デプロイ)は、実装・検証が終わるごとにユーザーに確認してから実行する。無断でデプロイしない**
- 新機能はSTEPごとに新規ブランチ(例: `step3-pwa-offline`)で作業し、`master` で直接作業しない
- 個人の実走行データ(GPX/TCX等のテストファイル)はリポジトリに含めない。検証で一時的に使う場合は`.gitignore`対象のディレクトリに置き、検証後は削除する
- テストデータにも、居住地域が特定できる地名・実在するルートID・個人を識別できる情報は書かない
- APIキー等のシークレットは`wrangler secret` / `.dev.vars`で管理し、クライアントバンドルに一切含めない

## 多角的コードレビューの運用

- 各STEPの実装が完了し`master`にマージする前には、新しいレビュー依頼プロンプトを作成し、**別セッション**で多角的レビューを実施する(実装時の思い込みを引きずらないため。STEP1以降この運用を続けており、実際にHigh級のバグを発見できている)
- レビュー依頼プロンプトは、ファイル単位で規模(大/中/小)を割り振って作る。前回の規模指定は使い回さない(ファイルの役割はSTEPごとに変わるため)
- レビュー結果への対応方針: Severity Highと、Verify(敵対的検証)で`confirmed`となった主要なMedium指摘は対応する。テストカバレッジ不足の指摘や中コストのリファクタリング提案は、費用対効果を見てユーザーと相談の上バックログに回してよい(全件を機械的に拾う必要はない)
- Verifyは個人開発PJのため全件ではなく部分実施(Severity Highと「大」ランクファイルの主要観点)で十分機能している。Verify自体は推論力の高いモデルを指定すると精度が上がる一方、Review/Merge/Reportの各フェーズは通常のモデルで十分

## 繰り返し踏んだ落とし穴(教訓)

- **テキスト抽出ベースの検証(ページのテキスト取得等)ではCSSの視覚的不具合を検知できない**(`position:sticky`の誤動作、要素のはみ出し、固定`minWidth`による列の間延び等)。レイアウトに関わる変更をしたら、`getBoundingClientRect()`や`getComputedStyle()`で実測するか、スクリーンショットで見た目を確認すること
- **jsdom(vitest)での性能計測は実ブラウザと大きく乖離することがある**(`HTMLCollection`アクセスがjsdomで極端に遅い等の実例あり)。巨大データを扱う処理の性能検証は必ず実ブラウザ(`wrangler dev`)で行うこと
- ブラウザ自動化ツールで「今エラーが出ているか」を正確に確認したい時は、コンソールログが蓄積された古いタブではなく新しいタブを使うこと。同様に、タブが非アクティブだとLeafletのcanvas描画(`requestAnimationFrame`)が発火せず検証時に空に見えることがある
- ローカル検証で巨大ファイル(数十MB)を配信する必要がある場合、`dist/`直下に置く方式は`wrangler dev`のStatic Assetsスキャンを不安定にしうる(実際に発生)。独立した一時サーバー経由での配信を検討すること
- CSP(`public/_headers`)を一時的に緩和してデバッグする場合は、検証後に確実に元へ戻し`git diff`で差分ゼロを確認すること
- **エージェントに組み込まれたブラウザ(Electron埋め込みwebview)では、Service Worker登録自体が検証できないことがある**(`'serviceWorker' in navigator`はtrueだが`register()`が常に`TypeError: ... An unknown error occurred when fetching the script.`で失敗。最小構成のテスト用JSファイルでも再現するためCSP/コード起因ではない)。SW関連(登録状況、オフライン再読み込み、更新通知フロー)の最終確認は実ブラウザに委ねること(STEP3で発見)
- **タブが非compositing/非フォーカス状態だと、TanStack Query(または類似のリトライ機構)のエラーパス検証が完了しないことがある**: `@tanstack/query-core`の`retryer.cjs`は、初回フェッチの可否を`networkMode`で判定する一方、リトライ前の`canContinue()`は`networkMode`に関わらず`focusManager.isFocused()`を必須条件にしている。埋め込みブラウザでは`document.hidden`が`true`になりがちで、1回目の失敗は記録されるがリトライが`paused`のまま進まないことがある(オフライン固有ではなく、リトライを伴うエラー全般で起こりうる)。即座に`isError`になる単発失敗は影響を受けにくい
- **並行セッションが同じ作業ディレクトリを共有している場合、ブランチの取り違えに注意**: worktreeで分離せず同じ作業コピーを複数セッションが操作すると、一方の`git checkout`が他方の未コミット変更を巻き込んで別ブランチに持ち越すことがある(実際に発生: STEP3作業中の未コミット変更が`master`のワーキングツリーに一時的に持ち越された)。定期的に`git status`で今いるブランチと変更内容を確認し、複数セッションを並行させる際はGit worktreeでの分離を推奨
- **IndexedDBに保存するレコードの型(フィールド構成)を変更する際は、必ずマイグレーション(`DB_VERSION`を上げて`onupgradeneeded`で変換)か、読み取り境界での防御的な正規化のどちらかを入れること**: IndexedDBはスキーマレスなため、コード側の型定義を変えただけでは過去に保存済みのレコードは古い形のまま残り続ける。本アプリは既に本番稼働中でユーザーのブラウザに実データがあるため、「型さえ直せば動く」という思い込みは危険(実際に発生: STEP3 Phase9で`OfflineHistoryRecord.fileName: string`→`source: OfflineHistorySource`へ変更した際にマイグレーションを入れず、STEP2時代の旧形式レコードが残っているブラウザで保存が永久停止・一覧表示中にアプリ全体がクラッシュする不具合になった。事後の多角的レビューで発見し、読み取り境界での正規化で対応)。既存データが本番にあり得るスキーマ変更をする際は、実装時点で「過去のレコードはこの新しい型に本当に合致しているか」を必ず自問すること
- **MUIの`Skeleton`は`variant="rectangular"`でも`width`/`height`未指定なら既定で`height: 1.2em`を設定する。CSSの`aspect-ratio`は対象の辺が`auto`の場合にのみ効くため、この既定`height`がある限り`aspectRatio`をsxで指定しても無視される**(STEP4で発見。地図のSkeletonプレースホルダーが厚さ約19pxの薄い帯にしかならず、実データ表示時に本来の高さへ一気に置き換わるレイアウトシフトを引き起こしていた)。`tsc`/`vitest`/`oxlint`/`build`はいずれも検知できず、実機で`getComputedStyle`を実測して初めて発覚した。`aspectRatio`をSkeletonで使う場合は`height: 'auto'`を明示して既定値を打ち消すこと
- **`@testing-library/react`の自動クリーンアップ(`afterEach`での`cleanup()`自動登録)は、`vitest.config.ts`に`test.globals: true`が無い環境では効かない**(自動クリーンアップは`globalThis.afterEach`の存在を検出する仕組みのため)。本プロジェクトは`vitest`から`describe`/`it`等を明示的にimportする方針で`globals:true`を設定していないため、コンポーネントの`render()`を伴うテストを書く際は`import { cleanup } from '@testing-library/react'`して`afterEach(cleanup)`を必ず入れること。入れないと、前のテストのDOMが残ったまま次のテストが実行され、「同じテキストの要素が複数見つかる」ような紛らわしい失敗になる(STEP4の`InputForm.test.tsx`で発生・解消)
- **MUIの`Skeleton`(`variant="text"`)は既定で`transform: scaleY(0.6)`の視覚的な縮小を適用する**(STEP4のレビュー対応で発見)。`getBoundingClientRect()`はこの変形後の見た目の寸法を返すため、Skeletonが実際にレイアウト上どれだけの領域を予約しているか(周囲の要素をどれだけ押し出すか)を確認したい場合は、transformの影響を受けない`offsetHeight`を使うこと。`height` propに設定した値と一致するのは`offsetHeight`であり、`getBoundingClientRect()`は`height×0.6`になるのが正常な仕様(不具合ではない)
- **ブラウザ自動化ツールで、既に値が入っているテキスト入力欄をクリックして入力すると、値は上書きされず末尾に追記されることがある**(STEP4で発見: ローカルキャッシュ済みのルートIDに対しさらに同じ値を入力すると桁数が倍になり、偶然にも全桁数字のため別のバリデーションを素通りしてしまった)。既存値の入力欄を書き換える場合は全選択してから入力すること。また、MUIの日付ピッカーのセクション(Year/Month/Day、content-editableな`span`)は実際のキー入力では正しく反映されるが、JavaScriptから`KeyboardEvent`を合成dispatchしても値は変わらない(実際のキー入力処理系に依存するため)

## コーディング規約

- 色・角丸・シャドウ等のデザイントークンは`src/theme.ts`の`tokens`オブジェクト経由で使う(直書きしない)
- 表示用の整形ロジック(日付・条件ラベル等)は`src/features/weather/format.ts`に集約する
- コメントは「なぜそうしたか」(制約・経緯・トレードオフ、ハマった点)を書く。「何をしているか」は書かない
