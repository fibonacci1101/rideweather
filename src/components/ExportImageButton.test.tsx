import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import ExportImageButton from './ExportImageButton';

// vitest.config.tsはtest.globals:trueを設定していないため、@testing-library/reactの
// 自動クリーンアップが効かない(詳細はInputForm.test.tsx参照)
afterEach(cleanup);

vi.mock('html2canvas', () => ({
  default: vi.fn(),
}));

// jsdomはURL.createObjectURL/revokeObjectURLを実装していないため、フォールバック
// ダウンロード経路(downloadBlob)のテストのためにスタブする
URL.createObjectURL = vi.fn(() => 'blob:mock-url');
URL.revokeObjectURL = vi.fn();

function makeFakeCanvas(blob: Blob | null = new Blob(['fake'], { type: 'image/jpeg' })) {
  return {
    toBlob: (callback: BlobCallback) => callback(blob),
  } as unknown as HTMLCanvasElement;
}

function renderWithAttachedTarget(fileName?: string) {
  const targetRef = createRef<HTMLDivElement>();
  // forwardRefコンポーネント経由でDOM要素を割り当てる代わりに、テスト対象コンポーネント外で
  // 実際にDOM接続済みの要素をrefへ直接割り当てる(html2canvasはモック済みで中身は見ない)
  const el = document.createElement('div');
  document.body.appendChild(el);
  (targetRef as { current: HTMLDivElement | null }).current = el;
  render(<ExportImageButton targetRef={targetRef} fileName={fileName} />);
  return targetRef;
}

describe('ExportImageButton', () => {
  beforeEach(async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockReset();
    delete (navigator as { canShare?: unknown }).canShare;
    delete (navigator as { share?: unknown }).share;
    delete (navigator as { userActivation?: unknown }).userActivation;
  });

  it('targetRef.currentが無い場合はエラーメッセージを表示し、html2canvasを呼ばない', async () => {
    const targetRef = createRef<HTMLDivElement>();
    render(<ExportImageButton targetRef={targetRef} />);

    fireEvent.click(screen.getByRole('button'));

    expect(
      await screen.findByText('保存対象の準備ができていません。再度お試しください。')
    ).toBeTruthy();
    const html2canvas = (await import('html2canvas')).default;
    expect(html2canvas).not.toHaveBeenCalled();
  });

  it('Web Share API(ファイル共有)に対応していれば共有シートを呼び、ダウンロードリンクは作らない(STEP6)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { canShare: typeof canShare }).canShare = canShare;
    (navigator as unknown as { share: typeof share }).share = share;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithAttachedTarget('test.jpg');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(canShare).toHaveBeenCalledWith(
      expect.objectContaining({ files: [expect.objectContaining({ name: 'test.jpg' })] })
    );
    expect(clickSpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it('userActivationが失効している場合はshare()を呼ばずダウンロードにフォールバックする(レビュー対応)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { canShare: typeof canShare }).canShare = canShare;
    (navigator as unknown as { share: typeof share }).share = share;
    (navigator as unknown as { userActivation: { isActive: boolean } }).userActivation = {
      isActive: false,
    };
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithAttachedTarget('test.jpg');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(share).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it('Web Share APIが無い環境ではリンクのダウンロード方式にフォールバックする(STEP6)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithAttachedTarget('test.jpg');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

    clickSpy.mockRestore();
  });

  it('共有シートをキャンセル(AbortError)した場合はエラー表示もフォールバックダウンロードもしない(STEP6)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
    const abortError = new DOMException('cancelled', 'AbortError');
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockRejectedValue(abortError);
    (navigator as unknown as { canShare: typeof canShare }).canShare = canShare;
    (navigator as unknown as { share: typeof share }).share = share;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithAttachedTarget('test.jpg');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(clickSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByText('画像の保存に失敗しました。通信環境を確認して再度お試しください。')
    ).toBeNull();

    clickSpy.mockRestore();
  });

  it('共有に失敗(AbortError以外)した場合はダウンロード方式にフォールバックする(STEP6)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockRejectedValue(new Error('unexpected'));
    (navigator as unknown as { canShare: typeof canShare }).canShare = canShare;
    (navigator as unknown as { share: typeof share }).share = share;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithAttachedTarget('test.jpg');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

    clickSpy.mockRestore();
  });

  it('html2canvasの生成に失敗した場合はエラーメッセージを表示する', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockRejectedValue(new Error('canvas failed'));

    renderWithAttachedTarget();
    fireEvent.click(screen.getByRole('button'));

    expect(
      await screen.findByText('画像の保存に失敗しました。通信環境を確認して再度お試しください。')
    ).toBeTruthy();
  });

  it('canvasToBlobがnullを返す場合はエラーメッセージを表示する(レビュー対応)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas(null));

    renderWithAttachedTarget();
    fireEvent.click(screen.getByRole('button'));

    expect(
      await screen.findByText('画像の保存に失敗しました。通信環境を確認して再度お試しください。')
    ).toBeTruthy();
  });

  it('devicePixelRatioが2を超える場合はscaleを2にキャップしてhtml2canvasを呼ぶ(レビュー対応)', async () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    try {
      const html2canvas = (await import('html2canvas')).default;
      vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      renderWithAttachedTarget();
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => expect(html2canvas).toHaveBeenCalledTimes(1));
      expect(html2canvas).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scale: 2 })
      );

      clickSpy.mockRestore();
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
    }
  });

  it('devicePixelRatioが2以下の場合はそのままscaleに使う(レビュー対応)', async () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    try {
      const html2canvas = (await import('html2canvas')).default;
      vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      renderWithAttachedTarget();
      fireEvent.click(screen.getByRole('button'));

      await waitFor(() => expect(html2canvas).toHaveBeenCalledTimes(1));
      expect(html2canvas).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scale: 1 })
      );

      clickSpy.mockRestore();
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
    }
  });

  it('ファイル名の不正文字は置換され、100文字を超える場合は切り詰められる(レビュー対応)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { canShare: typeof canShare }).canShare = canShare;
    (navigator as unknown as { share: typeof share }).share = share;

    const rawFileName = `テスト!!${'a'.repeat(120)}.jpg`;
    const expected = rawFileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);

    renderWithAttachedTarget(rawFileName);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(canShare).toHaveBeenCalledWith(
      expect.objectContaining({ files: [expect.objectContaining({ name: expected })] })
    );
  });

  it('ファイル名が不正文字の除去で空になる場合は既定のファイル名にフォールバックする(レビュー対応)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    vi.mocked(html2canvas).mockResolvedValue(makeFakeCanvas());
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as unknown as { canShare: typeof canShare }).canShare = canShare;
    (navigator as unknown as { share: typeof share }).share = share;

    renderWithAttachedTarget('');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(canShare).toHaveBeenCalledWith(
      expect.objectContaining({ files: [expect.objectContaining({ name: 'ride-weather.jpg' })] })
    );
  });

  it('エクスポート中はボタンが無効化され「保存中...」と表示される(レビュー対応)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    let resolveCanvas: (canvas: HTMLCanvasElement) => void = () => {};
    const canvasPromise = new Promise<HTMLCanvasElement>((resolve) => {
      resolveCanvas = resolve;
    });
    vi.mocked(html2canvas).mockReturnValue(canvasPromise);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderWithAttachedTarget();
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveProperty('disabled', true));
    expect(screen.getByText('保存中...')).toBeTruthy();

    resolveCanvas(makeFakeCanvas());

    await waitFor(() => expect(screen.getByRole('button')).toHaveProperty('disabled', false));
    expect(screen.getByText('画像として保存')).toBeTruthy();

    clickSpy.mockRestore();
  });
});
