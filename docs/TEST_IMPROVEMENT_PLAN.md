# テストコード改善・補強計画 (TEST_IMPROVEMENT_PLAN)

> **この文書はSTEP6時点(2026-08-17)のテスト評価であり、その後の状況を反映していない。**
> 1章で「テストファイル自体が存在していない」と指摘した`calculateArrivalTime.ts`のテストは、STEP7(2026-08-22)で
> `src/features/weather/calculateArrivalTime.test.ts`として実装済み(12ケース)。
> 同じく「ルートハンドラ本体の異常系テストが書かれていない」と指摘した`worker/routes/weather.test.ts`も、
> レートリミット429・上流非OKの転送・不正JSONで502・範囲外パラメータで400等を含む25ケースに拡充済み。
> 解消の記録は`docs/REFACTOR_BACKLOG.md`末尾を参照。当時の評価と、そこから何を直したかの記録として残している。

## 1. 現状のテストに対する全体的な評価

既存のテストコード（`src/` および `worker/` 配下）を分析した結果、全体的にテスト品質は高く、特に複雑な要件に対するエッジケースのカバーが手厚いことが確認できました。

**【良い点】**
*   **オフライン・異常系の堅牢なテスト**: `useRouteWeather.test.tsx` や `offlineHistory.test.ts` において、オフライン時の挙動、`fake-indexeddb` を用いたDBの互換性テスト、過去データ（STEP2, STEP5形式）との互換性など、エッジケースが極めて丁寧に検証されています。
*   **脆いテストの回避**: UIテスト（`InputForm.test.tsx` など）において、外部ライブラリ（`@mui/x-date-pickers`）の複雑なDOM操作を避け、初期値注入とロジック検証に絞っている点は保守性の観点から非常に優れた方針です。
*   **モックの妥当性**: `fake-indexeddb` の利用や、時刻周りの `vi.useFakeTimers` のスコープ限定（DateのみFakeにする等）など、テストを安定させるための工夫が随所に見られ、モックの使い方は総じて妥当かつ効果的です。

**【改善点】**
*   **一部コアロジックの単体テスト漏れ**: 到着予想時刻を計算する `calculateArrivalTime.ts` などの重要なコアロジックに対して、テストファイル自体が存在していません。ヒルクライム補正などの計算が含まれるため、ここはカバレッジの穴となっています。
*   **Worker側の結合（ルーティング）テストの不足**: `worker/routes/weather.test.ts` ではバリデーション関数（`parseTimestampParam`）の単体テストのみ行われており、Honoのルートハンドラ本体（`/` の GET リクエスト）に対する異常系テスト（OWM APIエラー、レートリミット到達、不正なJSONレスポンス等）が書かれていません。

---

## 2. 追加すべき重要なテストケースのリスト

レビューを踏まえ、以下のテストを追加・補強することを提案します。

### 優先度 高
1.  **`calculateArrivalTime.ts` の単体テスト追加**
    *   距離・速度からの基本的な到着時刻計算。
    *   獲得標高に基づくヒルクライム補正（100mアップごとのペナルティ加算）の境界値確認。
    *   獲得標高が0の場合の計算。
2.  **`worker/routes/weather.ts` のルートハンドラ異常系テスト追加**
    *   OWM APIからの500系エラー、不正なJSONレスポンス時の振る舞い（HTTP 502を返すか等）。
    *   Honoのコンテキストモックを用いた、レートリミット（429エラー）発生時のテスト。
    *   不正なパラメータ（lat/lonの範囲外、無効なtimestamp文字列）での400エラー応答。

### 優先度 中
3.  **UIコンポーネントのローディング・エラー状態のテスト**
    *   データ取得中（isFetching）の `ResultSkeleton` コンポーネントの表示状態検証。
    *   取得失敗時のエラーメッセージUIの表示検証。

### 優先度 低
4.  **MSW (Mock Service Worker) の導入検討**
    *   現在の `vi.fn()` を用いた関数モックから、ネットワークリクエスト自体をインターセプトするMSWへ移行することで、より本番に近い堅牢なテストを構築できます（モックAPIサーバーを立てるようなイメージです）。
    *   **【導入方針】既存テストの書き換えコストを抑えるため、導入する場合は「新規に追加するテスト（例: Worker側の結合テスト等）」から部分的に適用し、既存の安定したテスト（`useRouteWeather`等）は無理に書き換えず現状維持とする方針をとります。**

---

## 3. 最優先テストの具体的なコード実装案

**注意: 以下はSTEP6時点の提案コードであり、実装された`calculateArrivalTime`のAPI・既定値とは一致しない。**
実装では補正値は`ELEVATION_CORRECTION_MINUTES_PER_100M = 4`(分/100m)、第5引数は補正係数ではなく`applyCorrection: boolean`で、
さらに休憩時間補正(`REST_MINUTES_PER_RIDING_HOUR = 10`)が加わる。実際のテストは
`src/features/weather/calculateArrivalTime.test.ts`を参照すること(この節はそのまま写経しても通らない)。

当時の提案は以下のとおり。

```typescript
// src/features/weather/calculateArrivalTime.test.ts
import { describe, expect, it } from 'vitest';
import { calculateArrivalTime } from './calculateArrivalTime';

describe('calculateArrivalTime', () => {
  const startDate = new Date('2026-08-20T09:00:00.000Z');

  it('獲得標高0の場合、距離と平均時速のみから正確な到着時刻を算出する', () => {
    // 距離: 20km (20,000m), 平均時速: 20km/h -> 所要時間: 1時間
    const result = calculateArrivalTime(startDate, 20000, 20, 0);
    expect(result.toISOString()).toBe('2026-08-20T10:00:00.000Z');
  });

  it('獲得標高がある場合、指定された補正値（デフォルト10分/100m）で時間を加算する', () => {
    // 距離: 20km, 平均時速: 20km/h -> 基本所要時間: 1時間
    // 獲得標高: 300m -> ペナルティ: 300 / 100 * 10分 = 30分
    const result = calculateArrivalTime(startDate, 20000, 20, 300);
    expect(result.toISOString()).toBe('2026-08-20T10:30:00.000Z');
  });

  it('補正係数（分/100m）をカスタム値で指定できる', () => {
    // 距離: 20km, 平均時速: 20km/h -> 基本所要時間: 1時間
    // 獲得標高: 300m, 補正係数: 5分/100m -> ペナルティ: 300 / 100 * 5分 = 15分
    const result = calculateArrivalTime(startDate, 20000, 20, 300, 5);
    expect(result.toISOString()).toBe('2026-08-20T10:15:00.000Z');
  });

  it('距離が0の場合は出発時刻と同じ時刻を返す', () => {
    const result = calculateArrivalTime(startDate, 0, 20, 0);
    expect(result.getTime()).toBe(startDate.getTime());
  });
});
```
