import { useId, useRef, useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import { tokens } from '../theme';
import { parseUploadedFile } from '../features/weather/gpxTcxParser';
import type { RouteSource, TrackPoint } from '../features/weather/types';

// RouteSourceのuploadヴァリアントから導出する(typeフィールドだけ除く)。
// 独立した手書き型にすると、RouteSource側にフィールドが増えた際の二重メンテナンスに
// なるため(コードレビューで発見)、単一の定義元(RouteSource)から導出する
export type UploadedRoute = Omit<Extract<RouteSource, { type: 'upload' }>, 'type'>;

type UploadAccordionProps = {
  uploadedRoute: UploadedRoute | null;
  onFileParsed: (route: UploadedRoute) => void;
  onClear: () => void;
};

function summarizeDistanceKm(trackPoints: TrackPoint[]): string {
  const last = trackPoints[trackPoints.length - 1];
  if (!last || typeof last.d !== 'number') return '距離不明';
  return `約${(last.d / 1000).toFixed(1)}km`;
}

function UploadAccordion({ uploadedRoute, onFileParsed, onClear }: UploadAccordionProps) {
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 同じファイルを再選択しても変更イベントが発火するよう、選択後は毎回リセットする
    event.target.value = '';
    if (!file) return;

    setError('');
    setIsParsing(true);
    try {
      const trackPoints = await parseUploadedFile(file);
      onFileParsed({ fileId: crypto.randomUUID(), fileName: file.name, trackPoints });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました');
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_event, isExpanded) => setExpanded(isExpanded)}
      sx={{
        mt: '16px',
        border: `1px solid ${tokens.exportButtonBorder}`,
        borderRadius: `${tokens.radiusControl} !important`,
        '&:before': { display: 'none' },
        backgroundColor: '#ffffff',
      }}
    >
      <AccordionSummary expandIcon={<Typography sx={{ fontSize: 16, color: tokens.textMuted }}>▾</Typography>}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: tokens.textMuted }}>
          Strava / Garmin など他サービスの方はこちら(GPX / TCXファイル)
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        {uploadedRoute ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 13 }}>
              読み込んだルート: {uploadedRoute.fileName}({uploadedRoute.trackPoints.length}点、
              {summarizeDistanceKm(uploadedRoute.trackPoints)})
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={onClear}
              sx={{ borderColor: tokens.exportButtonBorder, color: tokens.accent, fontSize: 12 }}
            >
              ファイルを解除してRWGPSルートに戻す
            </Button>
          </Box>
        ) : (
          <Box>
            <Typography sx={{ fontSize: 13, color: tokens.textMuted, mb: 1.5 }}>
              GPXまたはTCXファイルをアップロードすると、Ride with GPS以外(Strava・Garmin
              Connect等)のルートでも天気予報を確認できます。ファイルはブラウザ内で処理され、
              サーバーには送信されません。
            </Typography>
            <label htmlFor={fileInputId}>
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept=".gpx,.tcx"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <Button
                component="span"
                variant="outlined"
                disabled={isParsing}
                sx={{ borderColor: tokens.exportButtonBorder, color: tokens.accent, fontSize: 13 }}
              >
                {isParsing ? '読み込み中...' : 'ファイルを選択'}
              </Button>
            </label>
            {error && (
              <Typography color="error" variant="body2" sx={{ mt: 1 }}>
                {error}
              </Typography>
            )}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default UploadAccordion;
