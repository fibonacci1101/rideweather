import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitForElementToBeRemoved } from '@testing-library/react';
import OfflineHistoryPanel from './OfflineHistoryPanel';
import { deleteHistoryRecord, listHistoryRecords, saveHistoryRecord } from '../features/weather/offlineHistory';
import type { OfflineHistorySource, TrackPoint, WeatherPoint } from '../features/weather/types';

// offlineHistory.test.tsと同じ方針: モックよりfake-indexeddbでの実結合を優先する
// (plans/STEP4_IMPLEMENTATION_PLAN.md 1.6参照)。Dateのみをfakeにする理由も同ファイルと同じ
// (setTimeoutまでfakeにするとfake-indexeddbの内部タイマーが止まりPromiseが解決されない)
function buildTrackPoints(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: 135 + i * 0.001, y: 35 + i * 0.001, d: i * 10 }));
}

const SAMPLE_PARAMS = { selectedDate: '2026-08-20', selectedTime: '09:00', averageSpeedKmh: 20 };
const SAMPLE_WEATHER_POINTS: WeatherPoint[] = [];

async function seedRecord(source: OfflineHistorySource) {
  await saveHistoryRecord({
    source,
    params: SAMPLE_PARAMS,
    trackPoints: buildTrackPoints(3),
    weatherPoints: SAMPLE_WEATHER_POINTS,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-15T00:00:00.000Z'));
});

afterEach(async () => {
  cleanup();
  const remaining = await listHistoryRecords();
  for (const rec of remaining) {
    await deleteHistoryRecord(rec.id);
  }
  vi.useRealTimers();
});

describe('OfflineHistoryPanel', () => {
  it('履歴が1件も無い場合は何も表示しない', async () => {
    const { container } = render(<OfflineHistoryPanel onSelectHistory={vi.fn()} />);
    // useEffect内のlistHistoryRecords()解決を待ってから「変化が無いこと」を確認する
    await Promise.resolve();
    expect(container.firstChild).toBeNull();
  });

  it('保存済みの履歴(RWGPS/アップロード両方)を新しい順に一覧表示する', async () => {
    await seedRecord({ type: 'rwgps', routeId: '12345678' });
    await seedRecord({ type: 'upload', fileName: 'ride.gpx' });

    render(<OfflineHistoryPanel onSelectHistory={vi.fn()} />);

    expect(await screen.findByText(/ルートID 12345678/)).toBeTruthy();
    expect(await screen.findByText(/ride\.gpx/)).toBeTruthy();
  });

  it('rwgpsレコードにtitleがあれば、ルートIDだけでなくルート名を表示する(STEP5)', async () => {
    await seedRecord({ type: 'rwgps', routeId: '12345678', title: '琵琶湖一周' });

    render(<OfflineHistoryPanel onSelectHistory={vi.fn()} />);

    expect(await screen.findByText(/琵琶湖一周\(ID: 12345678\)/)).toBeTruthy();
  });

  it('「表示」ボタンを押すと、そのレコードでonSelectHistoryが呼ばれる', async () => {
    await seedRecord({ type: 'rwgps', routeId: '12345678' });
    const onSelectHistory = vi.fn();

    render(<OfflineHistoryPanel onSelectHistory={onSelectHistory} />);
    await screen.findByText(/ルートID 12345678/);

    fireEvent.click(screen.getByRole('button', { name: '表示' }));

    expect(onSelectHistory).toHaveBeenCalledTimes(1);
    const passed = onSelectHistory.mock.calls[0][0];
    expect(passed.source).toEqual({ type: 'rwgps', routeId: '12345678' });
  });

  it('「削除」ボタンを押すと、deleteHistoryRecordを経由して一覧から消える', async () => {
    await seedRecord({ type: 'rwgps', routeId: '12345678' });

    render(<OfflineHistoryPanel onSelectHistory={vi.fn()} />);
    const entry = await screen.findByText(/ルートID 12345678/);

    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    await waitForElementToBeRemoved(entry);

    const remaining = await listHistoryRecords();
    expect(remaining).toHaveLength(0);
  });
});
