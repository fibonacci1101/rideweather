import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useRouteWeather } from './useRouteWeather';
import type { NormalizedWeather, RouteWeatherParams, RwgpsRouteResponse, TrackPoint } from './types';

vi.mock('./api', () => ({
  fetchRoute: vi.fn(),
  fetchWeatherForPoint: vi.fn(),
}));

import { fetchRoute, fetchWeatherForPoint } from './api';

const mockFetchRoute = vi.mocked(fetchRoute);
const mockFetchWeatherForPoint = vi.mocked(fetchWeatherForPoint);

// STEP3で踏んだ罠(plans/STEP3_PROGRESS.md Phase4)を踏まえたテスト用QueryClient:
// - retry: false … 既定のretry:3のままだと、失敗系のテストでリトライ前の`canContinue()`が
//   `focusManager.isFocused()`を要求し、jsdom環境ではリトライが`paused`のまま進まず
//   タイムアウトする恐れがある。retryを無効化しリトライ分岐自体に入らないようにする
// - networkMode … 既定の'online'のままnavigator.onLine=falseにすると、`canFetch()`が
//   falseを返しqueryFn自体が一度も呼ばれない(fetchStatus:'paused'のまま)。オフライン時の
//   挙動を検証するテストでは、本番のsrc/main.tsxと同じ'always'を明示する
function createTestQueryClient(networkMode: 'online' | 'always' = 'online') {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, networkMode },
    },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function buildTrackPoints(count: number): TrackPoint[] {
  // 距離を単純な等間隔(1kmおき)にし、到着予定時刻の算出を検算しやすくする
  return Array.from({ length: count }, (_, i) => ({ x: 135 + i * 0.01, y: 35 + i * 0.01, d: i * 1000 }));
}

function nowLocalDateTimeParts(): { date: string; time: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

const SAMPLE_WEATHER: NormalizedWeather = {
  weather: [{ id: 800, main: 'Clear', description: '晴れ', icon: '01d' }],
  main: { temp: 20, feels_like: 19 },
  wind: { speed: 2, deg: 90 },
  rainMm: 0,
  pop: 0.1,
};

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => {
  mockFetchRoute.mockReset();
  mockFetchWeatherForPoint.mockReset();
});

afterEach(() => {
  setOnLine(true);
});

describe('useRouteWeather', () => {
  it('RWGPSソース: ルート取得(fetchRoute)→代表地点ぶんの天気取得(fetchWeatherForPoint)が成功する', async () => {
    const trackPoints = buildTrackPoints(3);
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });
    mockFetchWeatherForPoint.mockResolvedValue(SAMPLE_WEATHER);

    const { date, time } = nowLocalDateTimeParts();
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '123' },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useRouteWeather(params), { wrapper: makeWrapper(queryClient) });

    await waitFor(() => expect(result.current.routeQuery.isSuccess).toBe(true));
    expect(mockFetchRoute).toHaveBeenCalledWith('123');

    await waitFor(() => expect(result.current.weatherQuery.isSuccess).toBe(true));
    const points = result.current.weatherQuery.data!;
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.name)).toEqual(['出発地点', 'C-1', '到着地点']);
    expect(points.every((p) => p.weather !== null && p.error === undefined)).toBe(true);
    expect(mockFetchWeatherForPoint).toHaveBeenCalledTimes(3);
  });

  it('アップロードソース: fetchRouteを呼ばずtrackPointsをそのまま使う', async () => {
    const trackPoints = buildTrackPoints(2);
    mockFetchWeatherForPoint.mockResolvedValue(SAMPLE_WEATHER);

    const { date, time } = nowLocalDateTimeParts();
    const params: RouteWeatherParams = {
      routeSource: { type: 'upload', fileId: 'f1', fileName: 'ride.gpx', trackPoints },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useRouteWeather(params), { wrapper: makeWrapper(queryClient) });

    await waitFor(() => expect(result.current.routeQuery.isSuccess).toBe(true));
    expect(mockFetchRoute).not.toHaveBeenCalled();
    expect((result.current.routeQuery.data as RwgpsRouteResponse).route.track_points).toEqual(trackPoints);

    await waitFor(() => expect(result.current.weatherQuery.isSuccess).toBe(true));
    expect(result.current.weatherQuery.data).toHaveLength(2);
  });

  it('到着予定時刻が予報範囲(5日先)を超える地点は、fetchWeatherForPointを呼ばず範囲外エラーになる', async () => {
    // 巨大な距離+低速により、到着予定時刻が確実に「今から5日以上先」になるようにする
    // (fake timersを使わずDate.now()基準のまま検証できるよう、余裕を大きく取っている)
    const trackPoints: TrackPoint[] = [
      { x: 135, y: 35, d: 0 },
      { x: 136, y: 36, d: 100_000_000 },
    ];
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });
    mockFetchWeatherForPoint.mockResolvedValue(SAMPLE_WEATHER);

    const { date, time } = nowLocalDateTimeParts();
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '999' },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useRouteWeather(params), { wrapper: makeWrapper(queryClient) });

    await waitFor(() => expect(result.current.weatherQuery.isSuccess).toBe(true));
    const points = result.current.weatherQuery.data!;
    const farPoint = points[1];
    expect(farPoint.weather).toBeNull();
    expect(farPoint.error).toContain('予報の対象範囲外');
    // 近い方の地点(出発地点、距離0)は範囲内なので1回だけ呼ばれ、遠い方の地点は呼ばれない
    expect(mockFetchWeatherForPoint).toHaveBeenCalledTimes(1);
  });

  it('到着予定時刻が過去(許容差より前)の地点は、fetchWeatherForPointを呼ばず範囲外エラーになる(F-02)', async () => {
    const trackPoints = buildTrackPoints(2);
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });
    mockFetchWeatherForPoint.mockResolvedValue(SAMPLE_WEATHER);

    // 出発を3時間前に設定 → 全地点の到着予定時刻が「今 - 1.5h」より前になる
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '999' },
      selectedDate: `${threeHoursAgo.getFullYear()}-${pad(threeHoursAgo.getMonth() + 1)}-${pad(threeHoursAgo.getDate())}`,
      selectedTime: `${pad(threeHoursAgo.getHours())}:${pad(threeHoursAgo.getMinutes())}`,
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useRouteWeather(params), { wrapper: makeWrapper(queryClient) });

    await waitFor(() => expect(result.current.weatherQuery.isSuccess).toBe(true));
    const points = result.current.weatherQuery.data!;
    expect(points.every((p) => p.weather === null)).toBe(true);
    expect(points[0].error).toContain('予報の対象範囲外');
    expect(mockFetchWeatherForPoint).not.toHaveBeenCalled();
  });

  it('地点ごとの天気取得失敗(オンライン)は、weatherQuery全体を失敗させずエラーメッセージをそのまま使う', async () => {
    const trackPoints = buildTrackPoints(1);
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });
    mockFetchWeatherForPoint.mockRejectedValue(new Error('upstream boom'));
    setOnLine(true);

    const { date, time } = nowLocalDateTimeParts();
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '1' },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useRouteWeather(params), { wrapper: makeWrapper(queryClient) });

    await waitFor(() => expect(result.current.weatherQuery.isSuccess).toBe(true));
    const [point] = result.current.weatherQuery.data!;
    expect(point.weather).toBeNull();
    expect(point.error).toBe('upstream boom');
  });

  it('地点ごとの天気取得失敗(オフライン)は、和文のオフライン向けメッセージに差し替わる', async () => {
    // 既定networkMode('online')のままnavigator.onLine=falseにすると、queryFn自体が
    // 一度も呼ばれず(fetchStatus:'paused')このシナリオを検証できない
    // (STEP3 Phase4で発見した罠、plans/STEP3_PROGRESS.md参照)。本番のsrc/main.tsxに
    // 合わせnetworkMode:'always'を明示し、実際にqueryFnを実行させた上でエラーを起こす
    const trackPoints = buildTrackPoints(1);
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });
    mockFetchWeatherForPoint.mockRejectedValue(new Error('network error'));
    setOnLine(false);

    const { date, time } = nowLocalDateTimeParts();
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '1' },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };

    const queryClient = createTestQueryClient('always');
    const { result } = renderHook(() => useRouteWeather(params), { wrapper: makeWrapper(queryClient) });

    await waitFor(() => expect(result.current.weatherQuery.isSuccess).toBe(true));
    const [point] = result.current.weatherQuery.data!;
    expect(point.weather).toBeNull();
    expect(point.error).toBe('オフラインのため取得できません');
  });

  it('averageSpeedKmh等が未確定の間はweatherQueryが無効(enabled:false)のまま', async () => {
    const trackPoints = buildTrackPoints(2);
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });

    const { date, time } = nowLocalDateTimeParts();
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '1' },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: null,
      arrivalCorrectionEnabled: true,
    };

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useRouteWeather(params), { wrapper: makeWrapper(queryClient) });

    await waitFor(() => expect(result.current.routeQuery.isSuccess).toBe(true));
    expect(result.current.weatherQuery.isFetching).toBe(false);
    expect(result.current.weatherQuery.fetchStatus).toBe('idle');
    expect(mockFetchWeatherForPoint).not.toHaveBeenCalled();
  });

  it('arrivalCorrectionEnabled:trueは獲得標高分の到着時刻を後ろにずらす(補正OFFより遅くなる)', async () => {
    // 1点目→2点目で500m獲得標高(標高0→500m)、距離は10km。平坦計算なら到着時刻は
    // 補正の有無で変わらないはずなので、獲得標高補正が効いていることを時刻の差で確認する
    const trackPoints: TrackPoint[] = [
      { x: 135, y: 35, d: 0, e: 0 },
      { x: 135.1, y: 35.1, d: 10_000, e: 500 },
    ];
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });
    mockFetchWeatherForPoint.mockResolvedValue(SAMPLE_WEATHER);

    const { date, time } = nowLocalDateTimeParts();
    const baseParams = {
      routeSource: { type: 'rwgps' as const, routeId: '1' },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: 20,
    };

    const queryClientOn = createTestQueryClient();
    const { result: resultOn } = renderHook(
      () => useRouteWeather({ ...baseParams, arrivalCorrectionEnabled: true }),
      { wrapper: makeWrapper(queryClientOn) }
    );
    await waitFor(() => expect(resultOn.current.weatherQuery.isSuccess).toBe(true));
    const arrivalOn = new Date(resultOn.current.weatherQuery.data![1].estimatedArrivalTime).getTime();

    const queryClientOff = createTestQueryClient();
    const { result: resultOff } = renderHook(
      () => useRouteWeather({ ...baseParams, arrivalCorrectionEnabled: false }),
      { wrapper: makeWrapper(queryClientOff) }
    );
    await waitFor(() => expect(resultOff.current.weatherQuery.isSuccess).toBe(true));
    const arrivalOff = new Date(resultOff.current.weatherQuery.data![1].estimatedArrivalTime).getTime();

    // 補正OFF時は「距離÷平均時速」の単純計算のみ。10km ÷ 20km/hのちょうど30分後になるはず
    const startDate = new Date(`${date}T${time}:00`);
    expect(arrivalOff - startDate.getTime()).toBe(30 * 60 * 1000);
    // 補正ON時は獲得標高500m分(+20分)と、それを含む移動時間に対する休憩補正が上乗せされるため、
    // 単純計算(30分後)より確実に遅くなる
    expect(arrivalOn).toBeGreaterThan(arrivalOff);
  });

  it('arrivalCorrectionEnabled違いはweatherQueryのqueryKeyに反映され、別キャッシュとして扱われる', async () => {
    const trackPoints = buildTrackPoints(1);
    mockFetchRoute.mockResolvedValue({ route: { id: 1, track_points: trackPoints } });
    mockFetchWeatherForPoint.mockResolvedValue(SAMPLE_WEATHER);

    const { date, time } = nowLocalDateTimeParts();
    const baseParams = {
      routeSource: { type: 'rwgps' as const, routeId: '1' },
      selectedDate: date,
      selectedTime: time,
      averageSpeedKmh: 20,
    };

    const queryClient = createTestQueryClient();
    const { result, rerender } = renderHook(
      (props: RouteWeatherParams) => useRouteWeather(props),
      { wrapper: makeWrapper(queryClient), initialProps: { ...baseParams, arrivalCorrectionEnabled: true } }
    );
    await waitFor(() => expect(result.current.weatherQuery.isSuccess).toBe(true));

    mockFetchWeatherForPoint.mockClear();
    rerender({ ...baseParams, arrivalCorrectionEnabled: false });

    // queryKeyが変わるため、切り替え直後は新しいキャッシュエントリとして再フェッチされる
    await waitFor(() => expect(mockFetchWeatherForPoint).toHaveBeenCalled());
  });
});
