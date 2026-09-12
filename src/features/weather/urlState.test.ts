import { describe, expect, it } from 'vitest';
import { decodeParamsFromSearch, encodeParamsToSearch } from './urlState';
import { getTodayLocalDateString } from './format';
import type { RouteWeatherParams } from './types';

describe('encodeParamsToSearch', () => {
  it('route/date/time/speedのいずれかが無ければ空文字', () => {
    const base: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '123' },
      selectedDate: '2026-08-15',
      selectedTime: '09:00',
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };
    expect(encodeParamsToSearch({ ...base, routeSource: null })).toBe('');
    expect(encodeParamsToSearch({ ...base, selectedDate: '' })).toBe('');
    expect(encodeParamsToSearch({ ...base, selectedTime: '' })).toBe('');
    expect(encodeParamsToSearch({ ...base, averageSpeedKmh: null })).toBe('');
  });

  it('揃っていればroute/date/time/speed/correctionをすべてエンコードする', () => {
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '123' },
      selectedDate: '2026-08-15',
      selectedTime: '09:00',
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };
    expect(encodeParamsToSearch(params)).toBe('route=123&date=2026-08-15&time=09%3A00&speed=20&correction=1');
  });

  it('arrivalCorrectionEnabled:falseはcorrection=0でエンコードする', () => {
    const params: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '123' },
      selectedDate: '2026-08-15',
      selectedTime: '09:00',
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: false,
    };
    expect(encodeParamsToSearch(params)).toBe('route=123&date=2026-08-15&time=09%3A00&speed=20&correction=0');
  });

  it('アップロード由来のルートはエンコードしない(座標データをURLに載せられないため)', () => {
    const params: RouteWeatherParams = {
      routeSource: { type: 'upload', fileId: 'abc', fileName: 'route.gpx', trackPoints: [] },
      selectedDate: '2026-08-15',
      selectedTime: '09:00',
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };
    expect(encodeParamsToSearch(params)).toBe('');
  });
});

describe('decodeParamsFromSearch', () => {
  it('route/date/time/speedのいずれかが無ければnull', () => {
    expect(decodeParamsFromSearch('?date=2026-08-15&time=09:00&speed=20')).toBeNull();
    expect(decodeParamsFromSearch('?route=123&time=09:00&speed=20')).toBeNull();
    expect(decodeParamsFromSearch('?route=123&date=2026-08-15&speed=20')).toBeNull();
    expect(decodeParamsFromSearch('?route=123&date=2026-08-15&time=09:00')).toBeNull();
  });

  it('routeが数字以外ならnull', () => {
    expect(decodeParamsFromSearch('?route=abc&date=2026-08-15&time=09:00&speed=20')).toBeNull();
  });

  it('speedが0以下ならnull', () => {
    expect(decodeParamsFromSearch('?route=123&date=2026-08-15&time=09:00&speed=0')).toBeNull();
  });

  it('speedがInfinityならnull(到着時刻がすべて出発時刻に潰れるバグの再発防止)', () => {
    expect(
      decodeParamsFromSearch('?route=123&date=2026-08-15&time=09:00&speed=Infinity')
    ).toBeNull();
  });

  it('speedが上限(200km/h)を超えるならnull', () => {
    expect(
      decodeParamsFromSearch('?route=123&date=2026-08-15&time=09:00&speed=99999999')
    ).toBeNull();
  });

  it('dateの書式が不正(スラッシュ区切り)ならnull', () => {
    expect(
      decodeParamsFromSearch('?route=123&date=2026/08/15&time=09:00&speed=20')
    ).toBeNull();
  });

  it('timeの書式が不正ならnull', () => {
    expect(
      decodeParamsFromSearch('?route=123&date=2026-08-15&time=25:99&speed=20')
    ).toBeNull();
  });

  it('routeIdが桁数上限(15桁)を超えるならnull', () => {
    expect(
      decodeParamsFromSearch('?route=1234567890123456&date=2026-08-15&time=09:00&speed=20')
    ).toBeNull();
  });

  it('過去日のURLはnull(古い共有リンクとみなす)', () => {
    expect(decodeParamsFromSearch('?route=123&date=2000-01-01&time=09:00&speed=20')).toBeNull();
  });

  it('correctionパラメータが省略されている場合はtrue扱い(STEP7以前の共有URLも新しい既定動作で再現できるように)', () => {
    const decoded = decodeParamsFromSearch('?route=123&date=2099-01-01&time=09:00&speed=20');
    expect(decoded?.arrivalCorrectionEnabled).toBe(true);
  });

  it('correction=0はarrivalCorrectionEnabled:falseにデコードする', () => {
    const decoded = decodeParamsFromSearch('?route=123&date=2099-01-01&time=09:00&speed=20&correction=0');
    expect(decoded?.arrivalCorrectionEnabled).toBe(false);
  });

  it('correction=1はarrivalCorrectionEnabled:trueにデコードする', () => {
    const decoded = decodeParamsFromSearch('?route=123&date=2099-01-01&time=09:00&speed=20&correction=1');
    expect(decoded?.arrivalCorrectionEnabled).toBe(true);
  });

  it('往復でパラメータが一致する(未来日・補正あり)', () => {
    const original: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '123' },
      selectedDate: '2099-01-01', // 十分未来の日付
      selectedTime: '09:00',
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };
    const decoded = decodeParamsFromSearch(encodeParamsToSearch(original));
    expect(decoded).toEqual(original);
  });

  it('往復でパラメータが一致する(未来日・補正なし)', () => {
    const original: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '123' },
      selectedDate: '2099-01-01',
      selectedTime: '09:00',
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: false,
    };
    const decoded = decodeParamsFromSearch(encodeParamsToSearch(original));
    expect(decoded).toEqual(original);
  });

  it('往復でパラメータが一致する(当日)', () => {
    const original: RouteWeatherParams = {
      routeSource: { type: 'rwgps', routeId: '123' },
      selectedDate: getTodayLocalDateString(),
      selectedTime: '09:00',
      averageSpeedKmh: 20,
      arrivalCorrectionEnabled: true,
    };
    const decoded = decodeParamsFromSearch(encodeParamsToSearch(original));
    expect(decoded).toEqual(original);
  });
});
