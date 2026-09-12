import { useState } from 'react';
import { ANNOUNCEMENTS } from './announcements';

const STORAGE_KEY = 'ride-weather-app:lastSeenAnnouncementDate';

function latestAnnouncementDate(): string | null {
  return ANNOUNCEMENTS[0]?.date ?? null;
}

// お知らせ(InfoDialog)の既読管理。localCache.tsと同じ方針で、プライベートブラウジング等
// localStorageが使えない環境でも未読判定ができないだけに留め、アプリの主要機能(お知らせ
// 自体の閲覧)には影響させない(fail-soft)
export function useUnreadAnnouncement() {
  const [hasUnread, setHasUnread] = useState(() => {
    try {
      const latest = latestAnnouncementDate();
      if (!latest) return false;
      const lastSeen = localStorage.getItem(STORAGE_KEY);
      return lastSeen === null || lastSeen < latest;
    } catch {
      return false;
    }
  });

  const markAsRead = () => {
    try {
      const latest = latestAnnouncementDate();
      if (latest) localStorage.setItem(STORAGE_KEY, latest);
    } catch {
      // 保存できなくても致命的ではないため無視する
    }
    setHasUnread(false);
  };

  return { hasUnread, markAsRead };
}
