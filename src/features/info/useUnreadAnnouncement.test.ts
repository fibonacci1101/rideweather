import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnreadAnnouncement } from './useUnreadAnnouncement';
import { ANNOUNCEMENTS } from './announcements';

const STORAGE_KEY = 'ride-weather-app:lastSeenAnnouncementDate';
const LATEST_DATE = ANNOUNCEMENTS[0].date;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useUnreadAnnouncement', () => {
  it('localStorageに既読記録が無ければ未読扱いになる', () => {
    const { result } = renderHook(() => useUnreadAnnouncement());
    expect(result.current.hasUnread).toBe(true);
  });

  it('既に最新のお知らせを既読済みなら未読扱いにならない', () => {
    localStorage.setItem(STORAGE_KEY, LATEST_DATE);
    const { result } = renderHook(() => useUnreadAnnouncement());
    expect(result.current.hasUnread).toBe(false);
  });

  it('既読日時が最新より古ければ未読扱いになる', () => {
    localStorage.setItem(STORAGE_KEY, '2000-01-01');
    const { result } = renderHook(() => useUnreadAnnouncement());
    expect(result.current.hasUnread).toBe(true);
  });

  it('markAsReadを呼ぶとhasUnreadがfalseになり、localStorageに最新日時が保存される', () => {
    const { result } = renderHook(() => useUnreadAnnouncement());
    expect(result.current.hasUnread).toBe(true);

    act(() => {
      result.current.markAsRead();
    });

    expect(result.current.hasUnread).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(LATEST_DATE);
  });
});
