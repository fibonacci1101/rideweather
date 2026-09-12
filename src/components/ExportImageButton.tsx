import { useState, type RefObject } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { tokens } from '../theme';

type ExportImageButtonProps = {
  targetRef: RefObject<HTMLElement | null>;
  fileName?: string;
};

const EXPORT_IMAGE_TYPE = 'image/jpeg';
const EXPORT_IMAGE_QUALITY = 0.92;
// html2canvasの既定scaleはwindow.devicePixelRatioそのものだが、iPhone Pro等(3倍)の端末では
// 長距離ルート(時間帯表の列数が多く画像の幅自体が大きい)との掛け合わせでキャンバスが
// 数千万px規模になり、出力ファイルが数十MBに達してSNS共有や保存の妨げになる
// (1,302kmのテストルートで19.1MB)。画像として十分な精細さを保てる上限として2倍に制限する
const MAX_EXPORT_SCALE = 2;
const DEFAULT_FILE_NAME = 'ride-weather.jpg';
const EXPORT_FAILURE_MESSAGE = '画像の保存に失敗しました。通信環境を確認して再度お試しください。';

// download属性に渡すファイル名を無害な文字だけに絞る(呼び出し元の入力を信頼しきらないための防御)
function sanitizeFileName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return safe || DEFAULT_FILE_NAME;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, EXPORT_IMAGE_TYPE, EXPORT_IMAGE_QUALITY);
  });
}

// navigator.share()の拒否理由(DOMException)は現行ブラウザではErrorを継承するが、
// iframe等の別realm由来のDOMExceptionは`instanceof Error`が偽になることがある
// (コードレビューのVerifyでWebKit本体のソースを確認済み)。realmをまたいでも機能する
// ダックタイピング(nameプロパティの有無)で判定する
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function downloadBlob(blob: Blob, fileName: string) {
  // モバイルブラウザ(特にSafari系)ではDOM未接続のa要素へのclick()がダウンロードとして
  // 扱われないことがあるため、一時的にDOMへ追加してから発火し、直後に取り除く
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // click()直後に同期的にrevokeすると、ダウンロード処理の開始前にURLが無効化される
  // ブラウザがあるため、少し遅延させてから解放する
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportImageButton({ targetRef, fileName = DEFAULT_FILE_NAME }: ExportImageButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!targetRef.current) {
      setError('保存対象の準備ができていません。再度お試しください。');
      return;
    }
    setError(null);
    setIsExporting(true);
    try {
      // 走行中に電波が無くてもビューアで確認できるよう、事前にこのボタンで保存しておく想定
      const { default: html2canvas } = await import('html2canvas');
      // useCORS: クロスオリジン画像(天気アイコン等)がキャンバスから欠落しないようにする
      const canvas = await html2canvas(targetRef.current, {
        backgroundColor: '#ffffff',
        useCORS: true,
        scale: Math.min(window.devicePixelRatio || 1, MAX_EXPORT_SCALE),
      });
      const blob = await canvasToBlob(canvas);
      if (!blob) {
        setError(EXPORT_FAILURE_MESSAGE);
        return;
      }

      const safeFileName = sanitizeFileName(fileName);
      const file = new File([blob], safeFileName, { type: EXPORT_IMAGE_TYPE });

      // iOS Safariは<a download>のdata:/blob: URLをダウンロードとして扱わず、常に
      // Quick Look(プレビュー)を開いてしまうため、そこから手動で共有シート→「画像を保存」を
      // 選ぶ必要があった。Web Share API(ファイル共有)が使える環境ではそちらを優先し、
      // ネイティブの共有シートからそのまま「写真に保存」できるようにする
      //
      // Web Share APIは直近のユーザー操作(transient activation)が有効な間しか呼び出せない。
      // html2canvasのレンダリングに時間がかかる長距離ルートでは、ボタンクリックから
      // ここに到達するまでの間にこれが失効しうる(コードレビューのVerifyでW3C仕様・WebKit
      // 実装を確認済み)。失効するとnavigator.share()は失敗し、フォールバックのダウンロードも
      // (iOS Safariでは)機能しない可能性が残るため、activationが判定できる環境では
      // 事前にチェックし、失敗が確定しているshare()の呼び出し自体を避けて即座にダウンロードへ回す
      // (根本的な解決には「1回目のタップでレンダリング、2回目のタップで共有」という設計変更が
      // 必要だが、実機での発生有無が未確認のため、まずはこの最小限の対策に留める)
      const activationLikelyValid = navigator.userActivation?.isActive ?? true;
      if (activationLikelyValid && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (shareError) {
          // ユーザーが共有シートをキャンセルした場合はエラー扱いにせず終了する
          if (isAbortError(shareError)) {
            return;
          }
          // それ以外の失敗(環境依存の例外等)は従来のダウンロード方式にフォールバックする
        }
      }
      downloadBlob(blob, safeFileName);
    } catch {
      // 上流のエラーメッセージ(英語の可能性がある)をそのまま出さず、和文で固定する
      setError(EXPORT_FAILURE_MESSAGE);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <Button
        variant="outlined"
        onClick={handleExport}
        disabled={isExporting}
        sx={{
          backgroundColor: '#ffffff',
          borderColor: tokens.exportButtonBorder,
          color: tokens.accent,
          fontSize: 13,
          padding: '9px 18px',
          '&:hover': {
            borderColor: tokens.exportButtonBorder,
            backgroundColor: tokens.background,
          },
        }}
      >
        {isExporting ? '保存中...' : '画像として保存'}
      </Button>
      {error && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}
    </div>
  );
}

export default ExportImageButton;
