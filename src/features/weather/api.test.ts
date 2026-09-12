import { describe, expect, it, afterEach, vi } from 'vitest';
import { fetchWeatherForPoint } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchResponse(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    })
  );
}

describe('fetchWeatherForPoint', () => {
  it('nearbyの各バケットのwindをnearbyBucketsまで伝播する(STEP6)', async () => {
    mockFetchResponse({
      forecast: { weather: [], main: { temp: 20 } },
      city: {},
      nearby: [
        { dt: 100, weather: [], main: { temp: 20 }, wind: { speed: 3.5, deg: 90 } },
        { dt: 200, weather: [], main: { temp: 21 } }, // windが無いバケットも混在しうる
      ],
    });

    const result = await fetchWeatherForPoint({
      lat: 35,
      lon: 135,
      timestamp: '2026-08-16T06:00:00.000Z',
      windowHours: 3,
    });

    expect(result.nearbyBuckets).toEqual([
      { dt: 100, weather: [], tempC: 20, wind: { speed: 3.5, deg: 90 } },
      { dt: 200, weather: [], tempC: 21, wind: undefined },
    ]);
  });

  it('nearbyが無い場合はnearbyBucketsもundefinedのまま(既存挙動)', async () => {
    mockFetchResponse({
      forecast: { weather: [], main: { temp: 20 } },
      city: {},
    });

    const result = await fetchWeatherForPoint({
      lat: 35,
      lon: 135,
      timestamp: '2026-08-16T06:00:00.000Z',
    });

    expect(result.nearbyBuckets).toBeUndefined();
  });
});
