import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import InfoDialog from './InfoDialog';
import { ANNOUNCEMENTS } from '../features/info/announcements';

// vitest.config.tsはtest.globals:trueを設定していないため、@testing-library/reactの
// 自動クリーンアップが効かない(詳細はInputForm.test.tsx参照)
afterEach(cleanup);

describe('InfoDialog', () => {
  it('open=falseの場合はダイアログの中身を表示しない', () => {
    render(<InfoDialog open={false} onClose={() => {}} />);
    expect(screen.queryByText('お知らせ・このアプリについて')).toBeNull();
  });

  it('open=trueの場合、更新履歴・QAが表示される(ロードマップセクションはSTEP7で削除済み、案A)', () => {
    render(<InfoDialog open onClose={() => {}} />);

    expect(screen.getByText('お知らせ・このアプリについて')).toBeTruthy();
    expect(screen.getByText('更新履歴')).toBeTruthy();
    expect(screen.queryByText('今後追加を検討している機能')).toBeNull();
    expect(screen.getByText('よくある質問')).toBeTruthy();

    // 更新履歴が1件以上、実際の内容(先頭のお知らせタイトル)を伴って表示されていること
    expect(ANNOUNCEMENTS.length).toBeGreaterThan(0);
    expect(screen.getByText(ANNOUNCEMENTS[0].title)).toBeTruthy();
  });

  it('ANNOUNCEMENTSが空配列でもクラッシュせず見出しのみ表示する(STEP5レビュー対応)', async () => {
    vi.resetModules();
    vi.doMock('../features/info/announcements', () => ({ ANNOUNCEMENTS: [] }));
    try {
      const { default: InfoDialogWithNoAnnouncements } = await import('./InfoDialog');
      render(<InfoDialogWithNoAnnouncements open onClose={() => {}} />);

      expect(screen.getByText('更新履歴')).toBeTruthy();
      // announcements.tsの実データ(先頭の見出し)が誤って混入していないことも確認する
      expect(screen.queryByText(ANNOUNCEMENTS[0].title)).toBeNull();
    } finally {
      vi.doUnmock('../features/info/announcements');
      vi.resetModules();
    }
  });

  it('Escapeキーで閉じ操作をすると、渡されたonCloseが呼ばれる(STEP5レビュー対応)', () => {
    const onClose = vi.fn();
    render(<InfoDialog open onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
