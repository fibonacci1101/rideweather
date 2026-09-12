import { describe, it, expect, beforeEach } from 'vitest';
import { loadCachedInput, saveCachedInput } from './localCache';

// このプロジェクトのvitestはNode環境で動作しブラウザのlocalStorageが無いため、
// 最小限のインメモリ実装で代替する
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe('localCache', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = createMemoryStorage();
  });

  it('保存した値をそのまま読み込める', () => {
    saveCachedInput({ routeId: '12345', averageSpeedKmh: 22.5 });
    expect(loadCachedInput()).toEqual({ routeId: '12345', averageSpeedKmh: 22.5 });
  });

  it('何も保存されていなければnullを返す', () => {
    expect(loadCachedInput()).toBeNull();
  });

  it('routeIdが数字以外を含む場合はnullを返す', () => {
    localStorage.setItem(
      'ride-weather-app:lastInput',
      JSON.stringify({ routeId: 'abc123', averageSpeedKmh: 20 })
    );
    expect(loadCachedInput()).toBeNull();
  });

  it('averageSpeedKmhが0以下の場合はnullを返す', () => {
    localStorage.setItem(
      'ride-weather-app:lastInput',
      JSON.stringify({ routeId: '123', averageSpeedKmh: 0 })
    );
    expect(loadCachedInput()).toBeNull();
  });

  it('壊れたJSONの場合はnullを返す(例外を投げない)', () => {
    localStorage.setItem('ride-weather-app:lastInput', '{invalid json');
    expect(loadCachedInput()).toBeNull();
  });

  it('localStorageが使えない環境でも例外を投げない', () => {
    // @ts-expect-error テストのためlocalStorageを未定義にする
    delete globalThis.localStorage;
    expect(() => saveCachedInput({ routeId: '123', averageSpeedKmh: 20 })).not.toThrow();
    expect(loadCachedInput()).toBeNull();
  });
});
