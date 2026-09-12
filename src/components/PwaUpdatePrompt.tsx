import { useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Snackbar from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import { tokens } from '../theme';

// Service Workerの更新通知UI。autoUpdate(無断でリロードされる方式)ではなく、
// ユーザーの明示的な操作で更新するprompt方式を採る(いわゆる「Service Worker更新問題」対策。
// 出発直前に古いバージョンのまま気づかず使い続けるのを防ぐ。plans/STEP3_IMPLEMENTATION_PLAN.md 1.2節)
function PwaUpdatePrompt() {
  // vite-plugin-pwaの既定挙動(onNeedReload未指定時)は、新SWが有効化されたら
  // 「更新」を押していないタブも含め全タブが無条件でwindow.location.reload()する
  // (Service Worker仕様上、controllerchangeは同一登録の全クライアントに届くため。
  // コードレビュー+Opus Verifyで、原因がclientsClaimではなくこの標準フロー自体だと判明)。
  // このタブ自身が「更新」を押した場合のみ即リロードし、他タブは未送信の入力や
  // URLに残らないアップロード結果(GPX/TCX)を失わないよう、控えめな通知に留める
  const reloadRequestedRef = useRef(false);
  const [reloadedElsewhere, setReloadedElsewhere] = useState(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload() {
      if (reloadRequestedRef.current) {
        window.location.reload();
      } else {
        setReloadedElsewhere(true);
      }
    },
    onRegisterError(error) {
      // 本番では利用者のブラウザコンソールに内部情報をそのまま出力しない
      // (docs/IMPROVEMENT_PLAN.md「セキュリティ改善」項目)。開発時のみ出力する
      if (import.meta.env.DEV) console.error('[sw-register-error]', error);
    },
  });

  const closeOfflineReady = () => setOfflineReady(false);
  const closeNeedRefresh = () => setNeedRefresh(false);
  const handleUpdateClick = () => {
    reloadRequestedRef.current = true;
    updateServiceWorker(true);
  };

  return (
    <>
      <Snackbar
        open={offlineReady}
        autoHideDuration={5000}
        onClose={closeOfflineReady}
        message="オフラインでも起動できるようになりました"
        sx={{ '& .MuiSnackbarContent-root': { backgroundColor: tokens.accent } }}
      />
      <Snackbar
        open={needRefresh}
        message="新しいバージョンがあります"
        action={
          <>
            <Button
              size="small"
              onClick={handleUpdateClick}
              sx={{ color: tokens.paper, fontWeight: 700 }}
            >
              更新
            </Button>
            <Button size="small" onClick={closeNeedRefresh} sx={{ color: 'rgba(255,255,255,0.7)' }}>
              後で
            </Button>
          </>
        }
        sx={{ '& .MuiSnackbarContent-root': { backgroundColor: tokens.accent } }}
      />
      <Snackbar
        open={reloadedElsewhere}
        message="新しいバージョンに切り替わりました。再読み込みしてください"
        action={
          <Button
            size="small"
            onClick={() => window.location.reload()}
            sx={{ color: tokens.paper, fontWeight: 700 }}
          >
            再読み込み
          </Button>
        }
        sx={{ '& .MuiSnackbarContent-root': { backgroundColor: tokens.accent } }}
      />
    </>
  );
}

export default PwaUpdatePrompt;
