import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

describe('useOnlineStatus', () => {
  afterEach(() => {
    setOnLine(true);
  });

  it('navigator.onLineの初期値を返す', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('offlineイベントで false に切り替わる', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);
  });

  it('onlineイベントで true に戻る', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});
