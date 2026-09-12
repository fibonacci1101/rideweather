import { extractKeyPoints } from './extractKeyPoints';
import type { OfflineHistorySource, TrackPoint, WeatherPoint } from './types';

const DB_NAME = 'ride-weather-offline';
const DB_VERSION = 1;
const STORE_NAME = 'weatherHistory';

// 保存件数の上限。超過分はsavedAtが古い順に削除する(FIFO)。
// 無制限にIndexedDBを肥大化させないための保険(plans/STEP2_IMPLEMENTATION_PLAN.md 1.4参照)
const MAX_HISTORY_ENTRIES = 10;

// 表示・保存用に間引く点数。ロングライド(10万点超)でもIndexedDBのレコードサイズを
// 抑えるため、既存のextractKeyPoints(等間隔抽出)を流用する
const STORAGE_TRACK_POINT_COUNT = 3000;

export type OfflineHistoryRecord = {
  id: string;
  source: OfflineHistorySource;
  savedAt: string; // ISO
  params: {
    selectedDate: string;
    selectedTime: string;
    averageSpeedKmh: number;
    // STEP7で追加。optionalフィールドの追加のためDB_VERSIONのマイグレーションは不要
    // (STEP5のOfflineHistorySource.title?と同じパターン、CLAUDE.md参照)。
    // undefinedは「STEP7以前(この機能が存在する前)に保存されたレコード」を意味する。
    // 当時は補正なしの単純計算でweatherPointsが計算・保存されているため、読み取り境界
    // では(urlState.tsのデフォルトtrueとはあえて非対称に)falseとして扱う
    // (保存済みスナップショットとの整合性を優先するため)
    arrivalCorrectionEnabled?: boolean;
  };
  trackPoints: TrackPoint[];
  weatherPoints: WeatherPoint[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けませんでした'));
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB操作に失敗しました'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDBトランザクションに失敗しました'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDBトランザクションが中断されました'));
  });
}

// STEP2時代(source導入前)はfileNameをレコード直下に持つ形式で保存していた。
// IndexedDBはスキーマレスなため、DB_VERSIONを上げずにフィールド形状を変えると
// 過去に保存済みのレコードはsourceを持たないまま残り続ける。読み取り時に
// upload形式へ補完しないと、以後の保存が例外でサイレントに止まったり、
// 一覧表示中の例外でアプリ全体がクラッシュする(コードレビューで発見)
function normalizeRecord(raw: unknown): OfflineHistoryRecord {
  const record = raw as OfflineHistoryRecord & { fileName?: string };
  const source = record.source ?? { type: 'upload' as const, fileName: record.fileName ?? '' };
  return {
    ...record,
    source,
    // STEP7以前のレコードはarrivalCorrectionEnabledを持たない。undefinedのまま返すと、
    // 将来の消費者が素朴なtruthy判定(if (params.arrivalCorrectionEnabled)等)で誤って
    // 「補正あり」扱いしてしまうリスクがある(STEP3 Phase9のsource正規化漏れと同型のパターン、
    // コードレビューで発見)。sourceと同様、読み取り境界で明示的にfalseへ正規化しておく
    params: { ...record.params, arrivalCorrectionEnabled: record.params.arrivalCorrectionEnabled ?? false },
  };
}

// STEP5: OfflineHistorySource(rwgps)にtitle?を追加した際は、このnormalizeRecordのような
// 変換処理もDB_VERSIONのマイグレーションも不要と判断した。フィールドの構造変更(上記の
// fileName→source、STEP3 Phase9〜10で実際にHigh級バグを出した)とは異なり、optionalな
// フィールドの追加は既存レコード(title無し)を型・実行時ともに壊さない
// (title: undefinedとして扱われるだけ)ため。既存データがあるスキーマ変更をする際は、
// 「構造の変更か、optionalフィールドの追加か」を都度見極めること(CLAUDE.md参照)

// typeが異なる場合は識別子(routeId/fileName)が偶然一致しても別ソースとして扱う
// (rwgpsのrouteIdとuploadのfileNameが同じ文字列になるケースへの対策)。
// titleの有無・値の違いは重複判定に含めない(同一ルート・同一条件の再取得でtitleの
// 取得タイミングが多少ズレても、誤って別レコード扱いにしないため)
function sourcesEqual(a: OfflineHistorySource, b: OfflineHistorySource): boolean {
  if (a.type === 'rwgps' && b.type === 'rwgps') return a.routeId === b.routeId;
  if (a.type === 'upload' && b.type === 'upload') return a.fileName === b.fileName;
  return false;
}

/**
 * 天気取得結果を保存する(圏外でも閲覧できるオフライン履歴)。
 * IndexedDBが使えない環境(プライベートブラウジング等)でも例外を投げず、単に保存されない
 * だけにする(localCache.tsと同じfail-soft方針)。
 *
 * 当初はアップロードファイル由来の結果限定だったが、RWGPSルートは「IDがあれば
 * オンライン復帰後いつでも再取得できる」という前提が、STEP3の想定シーン(圏外の山中で
 * 出発前に見たルートを見返したい)と噛み合わないため、RWGPSルートも対象に含めるよう
 * 拡張した(ユーザーとの相談の上、STEP3完了後に対応)。
 */
export async function saveHistoryRecord(input: {
  source: OfflineHistorySource;
  params: OfflineHistoryRecord['params'];
  trackPoints: TrackPoint[];
  weatherPoints: WeatherPoint[];
}): Promise<void> {
  try {
    const db = await openDb();
    try {
      // TanStack Queryの再フェッチ(タブ復帰・ネットワーク再接続のたびに既定で発火する)
      // により、同一の走行条件で保存トリガーが繰り返し呼ばれうる。直前の保存内容と
      // 入力元・走行条件が一致する場合は新規行を追加せずスキップする
      // (コードレビューで発見: 無条件追加だと同一内容が繰り返し保存され、
      // 件数上限のFIFOにより別ルートの履歴を無意味に押し出してしまう)
      const dedupeReadTx = db.transaction(STORE_NAME, 'readonly');
      const existingRaw = await promisifyRequest<unknown[]>(
        dedupeReadTx.objectStore(STORE_NAME).getAll()
      );
      const existing = existingRaw.map(normalizeRecord);
      const matchingRecord = existing.find(
        (r) =>
          sourcesEqual(r.source, input.source) &&
          r.params.selectedDate === input.params.selectedDate &&
          r.params.selectedTime === input.params.selectedTime &&
          r.params.averageSpeedKmh === input.params.averageSpeedKmh &&
          // 補正トグルが異なればweatherPoints(到着時刻)の中身も変わるため、同一条件とは
          // みなさない。含めないと異なるトグルで取得した結果がここでスキップされてしまう
          (r.params.arrivalCorrectionEnabled ?? false) === (input.params.arrivalCorrectionEnabled ?? false)
      );
      if (matchingRecord) {
        // 重複だが、既存レコードにtitleが無く今回は取得できている場合のみバックフィルする
        // (コードレビューで発見: sourcesEqualはtitleを比較対象に含めないため、pre-STEP5の
        // title無しレコードは再取得のたびにここで早期returnし、titleが永久に付かなかった)
        if (
          matchingRecord.source.type === 'rwgps' &&
          input.source.type === 'rwgps' &&
          !matchingRecord.source.title &&
          input.source.title
        ) {
          const backfilled: OfflineHistoryRecord = {
            ...matchingRecord,
            source: { ...matchingRecord.source, title: input.source.title },
          };
          const backfillTx = db.transaction(STORE_NAME, 'readwrite');
          backfillTx.objectStore(STORE_NAME).put(backfilled);
          await transactionDone(backfillTx);
        }
        return;
      }

      const record: OfflineHistoryRecord = {
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        source: input.source,
        params: input.params,
        trackPoints: extractKeyPoints(input.trackPoints, {
          mode: 'fixedCount',
          count: STORAGE_TRACK_POINT_COUNT,
        }),
        weatherPoints: input.weatherPoints,
      };

      const writeTx = db.transaction(STORE_NAME, 'readwrite');
      writeTx.objectStore(STORE_NAME).put(record);
      await transactionDone(writeTx);

      // 重複チェック時に取得済みの全件(existing)に今回保存したrecordを加えれば、
      // 保存後の状態と一致する。FIFO判定のためだけにgetAll()を再度呼ぶ必要はない
      const all = [...existing, record];
      if (all.length > MAX_HISTORY_ENTRIES) {
        const sortedOldestFirst = [...all].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
        const toDelete = sortedOldestFirst.slice(0, all.length - MAX_HISTORY_ENTRIES);
        const deleteTx = db.transaction(STORE_NAME, 'readwrite');
        for (const rec of toDelete) {
          deleteTx.objectStore(STORE_NAME).delete(rec.id);
        }
        await transactionDone(deleteTx);
      }
    } finally {
      db.close();
    }
  } catch (err) {
    // 保存できなくてもアプリの主要機能には影響しないため無視するが、
    // 想定外の失敗(型は合っているはずだが実データが古い等)を早期に気づけるようログは残す。
    // 本番では利用者のブラウザコンソールに内部情報をそのまま出力しないよう開発時のみに限る
    // (docs/IMPROVEMENT_PLAN.md「セキュリティ改善」項目)
    if (import.meta.env.DEV) console.error('[offlineHistory] saveHistoryRecord failed', err);
  }
}

/** 保存済みの履歴を新しい順に返す。IndexedDBが使えない環境では空配列を返す */
export async function listHistoryRecords(): Promise<OfflineHistoryRecord[]> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const all = await promisifyRequest<unknown[]>(tx.objectStore(STORE_NAME).getAll());
      return all.map(normalizeRecord).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    } finally {
      db.close();
    }
  } catch (err) {
    // 本番では利用者のブラウザコンソールに内部情報をそのまま出力しない(上記saveHistoryRecordと同様)
    if (import.meta.env.DEV) console.error('[offlineHistory] listHistoryRecords failed', err);
    return [];
  }
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      await transactionDone(tx);
    } finally {
      db.close();
    }
  } catch {
    // 削除できなくても致命的ではないため無視する
  }
}
