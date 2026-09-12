import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { ANNOUNCEMENTS } from '../features/info/announcements';
import { tokens } from '../theme';

type InfoDialogProps = {
  open: boolean;
  onClose: () => void;
};

const QA_ITEMS: { q: string; a: string }[] = [
  { q: '無料ですか？アカウント登録は必要ですか？', a: '無料で、登録も不要です。' },
  {
    q: '位置情報は送信されますか？',
    a: '入力したルート(Ride with GPSのルートID、またはアップロードしたGPX/TCXファイル)の座標のみ、天気予報の取得のために使われます。それ以外の位置情報の取得・送信は行いません。',
  },
  {
    q: 'オフラインでも使えますか？',
    a: '一度開いたことがあれば、電波の無い場所でもアプリ自体を起動できます。過去に天気情報を取得したルートは、フォーム内の「オフライン履歴」から確認できます(新しいルートの天気を取得するには通信が必要です)。',
  },
  {
    q: 'データはどこかに保存されますか？',
    a: '天気情報の履歴は、お使いのブラウザ内(IndexedDB)にのみ保存されます。サーバー側に保存されることはありません。',
  },
];

function SectionHeading({ children }: { children: string }) {
  return (
    <Typography sx={{ fontSize: 13, fontWeight: 700, color: tokens.textMuted, mb: 1 }}>
      {children}
    </Typography>
  );
}

function InfoDialog({ open, onClose }: InfoDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>お知らせ・このアプリについて</DialogTitle>
      {/* dividersの区切り線はMUI既定でpalette.dividerになるため、アプリ全体で統一している
          tokens.borderSubtleに上書きする(コードレビューで指摘) */}
      <DialogContent dividers sx={{ borderTopColor: tokens.borderSubtle, borderBottomColor: tokens.borderSubtle }}>
        <Stack spacing={3}>
          <Box>
            <SectionHeading>更新履歴</SectionHeading>
            <Stack spacing={1.5}>
              {ANNOUNCEMENTS.map((item) => (
                <Box key={`${item.date}-${item.title}`}>
                  <Typography sx={{ fontSize: 11, color: tokens.textMuted }}>{item.date}</Typography>
                  <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{item.title}</Typography>
                  <Typography sx={{ fontSize: 13, color: tokens.textMuted, mt: '2px' }}>{item.body}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box>
            <SectionHeading>よくある質問</SectionHeading>
            <Stack spacing={1.5}>
              {QA_ITEMS.map((item) => (
                <Box key={item.q}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Q. {item.q}</Typography>
                  <Typography sx={{ fontSize: 13, color: tokens.textMuted, mt: '2px' }}>A. {item.a}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export default InfoDialog;
