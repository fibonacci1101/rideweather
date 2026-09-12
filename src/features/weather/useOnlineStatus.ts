import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

// STEP3(PWAオフライン対応)で、API失敗時にオフライン起因と分かる場合は専用の案内文言に
// 差し替えるために使う(plans/STEP3_IMPLEMENTATION_PLAN.md 1.4節)。
// 既知の制約: ブラウザ自動化ツール(Browser pane)ではnavigator.onLineの検知がずれることが
// あるため、この値だけに依存した挙動確認は実ブラウザで行うこと(docs/PROGRESS.md参照)
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
