import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteHistoryRecord,
  listHistoryRecords,
  saveHistoryRecord,
} from './offlineHistory';
import type { OfflineHistorySource, TrackPoint, WeatherPoint } from './types';

function buildTrackPoints(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: 135 + i * 0.001, y: 35 + i * 0.001, d: i * 10 }));
}

function uploadSource(fileName: string): OfflineHistorySource {
  return { type: 'upload', fileName };
}

function rwgpsSource(routeId: string): OfflineHistorySource {
  return { type: 'rwgps', routeId };
}

const SAMPLE_PARAMS = { selectedDate: '2026-08-20', selectedTime: '09:00', averageSpeedKmh: 20 };
const SAMPLE_WEATHER_POINTS: WeatherPoint[] = [];

beforeEach(() => {
  // Dateのみをfakeにする(setTimeout等までfakeにすると、fake-indexeddbが内部で使う
  // タイマーも止まってしまいPromiseが解決されずテストがタイムアウトする)
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-15T00:00:00.000Z'));
});

afterEach(async () => {
  const remaining = await listHistoryRecords();
  for (const rec of remaining) {
    await deleteHistoryRecord(rec.id);
  }
  vi.useRealTimers();
});

describe('saveHistoryRecord / listHistoryRecords', () => {
  it('saves an upload-sourced record and lists it back', async () => {
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: uploadSource('ride.gpx'), params: SAMPLE_PARAMS });
    expect(records[0].trackPoints).toHaveLength(5);
    expect(records[0].id).toEqual(expect.any(String));
    expect(records[0].savedAt).toBe('2026-08-15T00:00:00.000Z');
  });

  it('saves an rwgps-sourced record and lists it back (STEP3で追加: RWGPSも保存対象)', async () => {
    await saveHistoryRecord({
      source: rwgpsSource('12345678'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: rwgpsSource('12345678'), params: SAMPLE_PARAMS });
  });

  it('saves and returns the rwgps route title when present (STEP5)', async () => {
    await saveHistoryRecord({
      source: { type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' },
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records[0].source).toEqual({ type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' });
  });

  it('dedups by routeId+params, and backfills title onto the existing record when it was previously missing (STEP5、レビュー対応)', async () => {
    // 同一ルート・同一条件の再取得でtitleの取得タイミングがズレても、別レコード扱いに
    // ならないことを確認する(sourcesEqualはtitleを比較しない設計、offlineHistory.ts参照)。
    // さらに、レビューで指摘された「title無し→titleありの再取得でtitleが永久に付かない」
    // 問題への対応(バックフィル)が機能していることも確認する
    await saveHistoryRecord({
      source: { type: 'rwgps', routeId: '12345678', title: undefined },
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    await saveHistoryRecord({
      source: { type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' },
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(9),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].source).toEqual({ type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' });
    // バックフィルはtitleのみを更新する。trackPoints/weatherPointsは新規保存扱いにはしない
    // (重複扱いのまま、既存レコードの本体データは最初の保存内容を維持する)
    expect(records[0].trackPoints).toHaveLength(5);
  });

  it('does not downgrade an already-titled record when a later duplicate save has no title (STEP5、レビュー対応)', async () => {
    await saveHistoryRecord({
      source: { type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' },
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    await saveHistoryRecord({
      source: { type: 'rwgps', routeId: '12345678', title: undefined },
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(9),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records[0].source).toEqual({ type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' });
  });

  it('backfills title onto a genuine pre-STEP5 raw record (titleキーが構文上存在しない)', async () => {
    await putRawLegacyRwgpsRecord({
      id: 'pre-step5-backfill',
      routeId: '12345678',
      savedAt: '2026-08-15T00:00:00.000Z',
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    await saveHistoryRecord({
      source: { type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' },
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(9),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('pre-step5-backfill');
    expect(records[0].source).toEqual({ type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' });
  });

  it('lists records newest first', async () => {
    await saveHistoryRecord({
      source: uploadSource('first.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    vi.setSystemTime(new Date('2026-08-15T01:00:00.000Z'));
    await saveHistoryRecord({
      source: rwgpsSource('999'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records.map((r) => r.source)).toEqual([rwgpsSource('999'), uploadSource('first.gpx')]);
  });

  it('decimates trackPoints for storage when the route has many points', async () => {
    await saveHistoryRecord({
      source: uploadSource('long-ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5000),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records[0].trackPoints.length).toBeLessThanOrEqual(3000);
    expect(records[0].trackPoints.length).toBeGreaterThan(0);
  });

  it('skips saving when source and params exactly match the most recent save (dedup, regression for reconnect/refocus re-fetch)', async () => {
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    // 別内容(標高が異なる)でも、source+paramsが同一なら重複保存とみなしスキップする
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(9),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].trackPoints).toHaveLength(5);
  });

  it('dedups rwgps records by routeId+params independently of upload records', async () => {
    await saveHistoryRecord({
      source: rwgpsSource('12345678'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    await saveHistoryRecord({
      source: rwgpsSource('12345678'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(9),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].trackPoints).toHaveLength(5);
  });

  it('does not dedupe across different source types even if the identifier string is identical', async () => {
    // rwgpsのrouteId「ride.gpx」というのは実際にはあり得ないが、型が違えば
    // 同一視されないことを確認する(sourcesEqualがtypeも比較していることの回帰確認)
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    await saveHistoryRecord({
      source: rwgpsSource('ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(2);
  });

  it('saves separately when averageSpeedKmh differs even if source matches', async () => {
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: { ...SAMPLE_PARAMS, averageSpeedKmh: 25 },
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(2);
  });

  it('saves separately when arrivalCorrectionEnabled differs even if other params match (STEP7)', async () => {
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: { ...SAMPLE_PARAMS, arrivalCorrectionEnabled: true },
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: { ...SAMPLE_PARAMS, arrivalCorrectionEnabled: false },
      trackPoints: buildTrackPoints(5),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(2);
  });

  it('treats a pre-STEP7 record (arrivalCorrectionEnabled未設定) as false when dedupe-comparing against an explicit false save', async () => {
    // STEP7以前に保存されたレコード(補正機能が存在する前)は、実際には補正なしの
    // 単純計算で保存されている。読み取り境界のデフォルト(undefined→false)と一貫性を
    // 保つため、重複判定でもundefinedはfalseと同一視されるべき
    await putRawLegacyRwgpsRecord({
      id: 'pre-step7-no-correction-field',
      routeId: '12345678',
      savedAt: '2026-08-15T00:00:00.000Z',
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    await saveHistoryRecord({
      source: rwgpsSource('12345678'),
      params: { ...SAMPLE_PARAMS, arrivalCorrectionEnabled: false },
      trackPoints: buildTrackPoints(9),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    // 重複とみなされ、新規レコードは追加されない(旧レコードのみ残る)
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('pre-step7-no-correction-field');
  });

  it('evicts the oldest record once more than the cap (10) are saved (upload/rwgps混在, STEP3で追加)', async () => {
    // typeによらずFIFOが公平に機能することを確認するため、upload/rwgpsを交互に保存する
    for (let i = 0; i < 11; i++) {
      vi.setSystemTime(new Date(`2026-08-15T${String(i).padStart(2, '0')}:00:00.000Z`));
      await saveHistoryRecord({
        source: i % 2 === 0 ? uploadSource(`ride-${i}.gpx`) : rwgpsSource(`route-${i}`),
        params: SAMPLE_PARAMS,
        trackPoints: buildTrackPoints(2),
        weatherPoints: SAMPLE_WEATHER_POINTS,
      });
    }

    const records = await listHistoryRecords();
    expect(records).toHaveLength(10);
    // 最も古い(i=0, upload)のレコードが削除され、最新の10件(i=1〜10、typeを問わず)が残る
    const identifiers = records.map((r) => (r.source.type === 'upload' ? r.source.fileName : r.source.routeId));
    expect(identifiers).not.toContain('ride-0.gpx');
    expect(identifiers).toContain('route-1');
    expect(identifiers).toContain('route-9');
    expect(identifiers).toContain('ride-10.gpx');
  });
});

// STEP2時代(source導入前)はfileNameをレコード直下に持つ形式で保存していた。
// この形式のレコードが残っていてもクラッシュせず、upload由来として扱えることを確認する
// (コードレビューで発見: 補完がないと保存が永久停止・表示中に例外が投げられる)
function putRawLegacyRecord(raw: {
  id: string;
  fileName: string;
  savedAt: string;
  params: typeof SAMPLE_PARAMS;
  trackPoints: TrackPoint[];
  weatherPoints: WeatherPoint[];
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ride-weather-offline', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('weatherHistory', 'readwrite');
      tx.objectStore('weatherHistory').put(raw);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

// STEP5より前(title導入前)は、source.rwgpsがtitleキー自体を持たない形式で保存されていた。
// 本物の「titleキーが構文上存在しないレコード」を模擬するため、saveHistoryRecordを経由せず
// 直接indexedDBへputする(STEP5レビューのVerifyフェーズで妥当と判定された手法、
// コードレビュー検証ログ参照)
function putRawLegacyRwgpsRecord(raw: {
  id: string;
  routeId: string;
  savedAt: string;
  params: typeof SAMPLE_PARAMS;
  trackPoints: TrackPoint[];
  weatherPoints: WeatherPoint[];
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ride-weather-offline', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('weatherHistory', 'readwrite');
      tx.objectStore('weatherHistory').put({
        id: raw.id,
        source: { type: 'rwgps', routeId: raw.routeId },
        savedAt: raw.savedAt,
        params: raw.params,
        trackPoints: raw.trackPoints,
        weatherPoints: raw.weatherPoints,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('legacy record compatibility (STEP2形式のsourceなしレコード)', () => {
  it('normalizes a legacy fileName-only record to an upload source when listing', async () => {
    await putRawLegacyRecord({
      id: 'legacy-1',
      fileName: 'old-ride.gpx',
      savedAt: '2026-08-15T00:00:00.000Z',
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].source).toEqual(uploadSource('old-ride.gpx'));
  });

  it('normalizes params.arrivalCorrectionEnabled to false for pre-STEP7 records lacking the field (STEP7、コードレビューで発見)', async () => {
    // source同様、arrivalCorrectionEnabledもnormalizeRecordで明示的にfalseへ正規化されるべき。
    // 正規化されないと、undefinedのまま返されたレコードを将来の消費者が素朴なtruthy判定で
    // 誤って「補正あり」扱いしてしまうリスクがある
    await putRawLegacyRwgpsRecord({
      id: 'pre-step7-no-correction-field',
      routeId: '12345678',
      savedAt: '2026-08-15T00:00:00.000Z',
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].params.arrivalCorrectionEnabled).toBe(false);
  });

  it('does not crash when saving alongside an existing legacy record, and dedupes against it', async () => {
    await putRawLegacyRecord({
      id: 'legacy-1',
      fileName: 'old-ride.gpx',
      savedAt: '2026-08-15T00:00:00.000Z',
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    await saveHistoryRecord({
      source: uploadSource('old-ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(9),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });

    const records = await listHistoryRecords();
    // source+paramsが一致するため重複とみなされ、新規追加されない(旧レコードのみ残る)
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('legacy-1');
  });

  it('reads pre-STEP5 rwgps records (titleフィールド無し)without crashing(STEP5、optionalフィールド追加は移行処理不要という判断の裏付け)', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('ride-weather-offline', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('weatherHistory', 'readwrite');
        tx.objectStore('weatherHistory').put({
          id: 'pre-step5-1',
          source: { type: 'rwgps', routeId: '12345678' },
          savedAt: '2026-08-15T00:00:00.000Z',
          params: SAMPLE_PARAMS,
          trackPoints: buildTrackPoints(2),
          weatherPoints: SAMPLE_WEATHER_POINTS,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    const records = await listHistoryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].source).toEqual({ type: 'rwgps', routeId: '12345678' });
  });
});

describe('deleteHistoryRecord', () => {
  it('removes the specified record', async () => {
    await saveHistoryRecord({
      source: uploadSource('ride.gpx'),
      params: SAMPLE_PARAMS,
      trackPoints: buildTrackPoints(2),
      weatherPoints: SAMPLE_WEATHER_POINTS,
    });
    const [record] = await listHistoryRecords();
    await deleteHistoryRecord(record.id);
    expect(await listHistoryRecords()).toHaveLength(0);
  });
});
