import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { tokens } from '../theme';
import { deleteHistoryRecord, listHistoryRecords, type OfflineHistoryRecord } from '../features/weather/offlineHistory';
import { formatOfflineHistorySourceLabel, formatSavedAt } from '../features/weather/format';

type OfflineHistoryPanelProps = {
  onSelectHistory: (record: OfflineHistoryRecord) => void;
};

// 以前はUploadAccordion(「他サービスの方はこちら」の折りたたみ)の中に置いていたが、
// RWGPSルートもオフライン履歴の保存対象に含めたことで(STEP3完了後の追加対応)、
// RWGPS利用者が「アップロード専用の場所」を開かずに気づけるよう、フォーム内の
// 常時表示(履歴が1件以上ある場合のみ)に昇格した
function OfflineHistoryPanel({ onSelectHistory }: OfflineHistoryPanelProps) {
  const [records, setRecords] = useState<OfflineHistoryRecord[]>([]);

  const refresh = () => {
    listHistoryRecords().then(setRecords);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleDelete = async (id: string) => {
    await deleteHistoryRecord(id);
    refresh();
  };

  if (records.length === 0) return null;

  return (
    <Box
      sx={{
        mt: '16px',
        border: `1px solid ${tokens.exportButtonBorder}`,
        borderRadius: tokens.radiusControl,
        backgroundColor: tokens.paper,
        padding: '14px 16px',
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: tokens.textMuted, mb: 1 }}>
        オフライン履歴(電波が無い場所でも閲覧できます)
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {records.map((record) => (
          <Box
            key={record.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              flexWrap: 'wrap',
              fontSize: 12,
            }}
          >
            <Typography sx={{ fontSize: 12 }}>
              {formatOfflineHistorySourceLabel(record.source)} ・ 保存日時 {formatSavedAt(record.savedAt)}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onSelectHistory(record)}
                sx={{ borderColor: tokens.exportButtonBorder, color: tokens.accent, fontSize: 11, padding: '2px 10px' }}
              >
                表示
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => handleDelete(record.id)}
                sx={{ color: tokens.textMuted, fontSize: 11, padding: '2px 10px' }}
              >
                削除
              </Button>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default OfflineHistoryPanel;
