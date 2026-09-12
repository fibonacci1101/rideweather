import { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import OutlinedInput from '@mui/material/OutlinedInput';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { tokens } from '../theme';
import { getTodayLocalDateString } from '../features/weather/format';
import { loadCachedInput, saveCachedInput } from '../features/weather/localCache';
import UploadAccordion, { type UploadedRoute } from './UploadAccordion';
import OfflineHistoryPanel from './OfflineHistoryPanel';
import type { OfflineHistoryRecord } from '../features/weather/offlineHistory';
import type { RouteSource } from '../features/weather/types';

export type InputFormSubmitParams = {
  routeSource: RouteSource;
  selectedDate: string;
  selectedTime: string;
  averageSpeedKmh: number | null;
  arrivalCorrectionEnabled: boolean;
};

type InputFormProps = {
  onSubmit: (params: InputFormSubmitParams) => void;
  initialValues?: InputFormSubmitParams;
  onSelectOfflineHistory: (record: OfflineHistoryRecord) => void;
};

const MAX_FORECAST_DAYS = 5; // OpenWeatherMap無料プランの予報範囲に合わせる

function extractRouteId(input: string): string | null {
  if (/^\d+$/.test(input)) return input;
  // ドメイン境界を厳格にする(直前が英数字/ハイフンでないことを要求し、
  // "fake-ridewithgps.com" のような偽装ドメインを誤って受理しないようにする)
  const match = input.match(/(?<![a-zA-Z0-9-])ridewithgps\.com\/routes\/(\d+)/);
  return match ? match[1] : null;
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <Typography
      component="label"
      htmlFor={htmlFor}
      sx={{
        display: 'block',
        fontSize: 12,
        fontWeight: 700,
        color: tokens.textMuted,
        mb: 0.75,
      }}
    >
      {children}
    </Typography>
  );
}

// モバイルでの操作性を考慮し、DatePicker/TimePickerの開閉アイコンボタンのタップ領域を広げる
const openPickerButtonSlotProps = {
  size: 'small' as const,
  sx: {
    padding: '4px',
    '@media (max-width: 640px)': {
      padding: '12px',
    },
  },
};

function InputForm({ onSubmit, initialValues, onSelectOfflineHistory }: InputFormProps) {
  // URLからの復元(initialValues)がある場合はそちらを優先し、無い場合のみ
  // 直近の送信内容(ローカルキャッシュ)で埋める
  const cachedInput = initialValues ? null : loadCachedInput();
  const initialRouteSource = initialValues?.routeSource;

  const [routeInput, setRouteInput] = useState(
    initialRouteSource?.type === 'rwgps' ? initialRouteSource.routeId : (cachedInput?.routeId ?? '')
  );
  // アップロードされたファイル由来のルート。設定されている間はRWGPS入力欄より優先される
  // (両方同時には使えない仕様)
  const [uploadedRoute, setUploadedRoute] = useState<UploadedRoute | null>(
    initialRouteSource?.type === 'upload' ? initialRouteSource : null
  );
  // 未指定時は当日を初期値にする(selectedTimeと同じ方針)。以前は空文字のままだったが、
  // モバイルの日付ピッカーは未選択でも「今日」をハイライト表示するため見た目上は選択済みに
  // 見え、そのまま送信するとバリデーションに引っかかる、というギャップがユーザーから
  // 指摘され解消した(壁打ちの経緯はdocs/次期機能選定_壁打ちプロンプト.md参照)
  const [selectedDate, setSelectedDate] = useState(initialValues?.selectedDate ?? getTodayLocalDateString());
  // 未指定時は現在時刻を基準時刻としてそのまま表示する(何時基準か常に分かるようにするため)
  const [selectedTime, setSelectedTime] = useState(
    initialValues?.selectedTime ?? dayjs().format('HH:mm')
  );
  const [averageSpeed, setAverageSpeed] = useState(
    initialValues?.averageSpeedKmh !== null && initialValues?.averageSpeedKmh !== undefined
      ? String(initialValues.averageSpeedKmh)
      : (cachedInput ? String(cachedInput.averageSpeedKmh) : '')
  );
  // 獲得標高・休憩時間の到着時刻補正(STEP7)。デフォルトON。offlineHistory/urlStateからの
  // 復元時のデフォルト方針が異なる理由はそれぞれのファイルのコメント参照
  const [arrivalCorrectionEnabled, setArrivalCorrectionEnabled] = useState(
    initialValues?.arrivalCorrectionEnabled ?? true
  );
  const [error, setError] = useState('');

  const routeIdInputId = useId();
  const dateInputId = useId();
  const timeInputId = useId();
  const speedInputId = useId();

  const todayString = getTodayLocalDateString();
  const maxDateString = dayjs(todayString).add(MAX_FORECAST_DAYS, 'day').format('YYYY-MM-DD');

  const handleSubmit = () => {
    // アップロード済みファイルがあればそちらを優先し、RWGPSのルートID/URL欄は見ない
    // (1.3節の通り、両方同時に使うことはできない仕様)
    const routeId = uploadedRoute ? null : extractRouteId(routeInput);

    if ((!uploadedRoute && !routeId) || selectedDate === '') {
      setError(
        uploadedRoute
          ? '走行日を入力してください。'
          : '有効なルートID/URLと走行日を入力してください。'
      );
      return;
    }
    // DatePickerのUI制約(min/maxDate)はinitialValues経由で迂回されうるため、送信時にも範囲を確認する
    if (selectedDate < todayString || selectedDate > maxDateString) {
      setError('走行日は今日から5日後までの範囲で入力してください。');
      return;
    }
    if (selectedTime === '') {
      setError('走行時間を入力してください。');
      return;
    }
    const speedValue = Number(averageSpeed);
    if (averageSpeed === '' || !Number.isFinite(speedValue) || speedValue <= 0) {
      setError('平均時速を入力してください。');
      return;
    }

    setError('');

    const routeSource: RouteSource = uploadedRoute
      ? {
          type: 'upload',
          fileId: uploadedRoute.fileId,
          fileName: uploadedRoute.fileName,
          trackPoints: uploadedRoute.trackPoints,
        }
      : { type: 'rwgps', routeId: routeId as string };

    if (routeSource.type === 'rwgps') {
      saveCachedInput({ routeId: routeSource.routeId, averageSpeedKmh: speedValue });
    }

    onSubmit({
      routeSource,
      selectedDate,
      selectedTime,
      averageSpeedKmh: speedValue,
      arrivalCorrectionEnabled,
    });
  };

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: tokens.radiusForm,
        padding: '28px',
        boxShadow: tokens.shadow,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: '16px',
          alignItems: 'end',
          '@media (max-width: 640px)': {
            gridTemplateColumns: '1fr',
          },
        }}
      >
        <Box>
          <FieldLabel htmlFor={routeIdInputId}>Ride with GPS ルートID または URL</FieldLabel>
          <OutlinedInput
            id={routeIdInputId}
            fullWidth
            value={routeInput}
            onChange={(e) => setRouteInput(e.target.value)}
            disabled={uploadedRoute !== null}
            placeholder={uploadedRoute ? 'ファイルが添付されているため無効です' : undefined}
          />
        </Box>
        <Box>
          <FieldLabel htmlFor={dateInputId}>走行日</FieldLabel>
          <DatePicker
            value={selectedDate ? dayjs(selectedDate) : null}
            onChange={(newValue: Dayjs | null) =>
              setSelectedDate(newValue?.isValid() ? newValue.format('YYYY-MM-DD') : '')
            }
            minDate={dayjs(todayString)}
            maxDate={dayjs(maxDateString)}
            format="YYYY/MM/DD"
            slotProps={{
              textField: {
                fullWidth: true,
                id: dateInputId,
                slotProps: { htmlInput: { 'aria-label': '走行日' } },
              },
              openPickerButton: openPickerButtonSlotProps,
              openPickerIcon: { fontSize: 'small' },
            }}
          />
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          mt: '16px',
          '@media (max-width: 640px)': {
            gridTemplateColumns: '1fr',
          },
        }}
      >
        <Box>
          <FieldLabel htmlFor={timeInputId}>走行時間(現在時刻を初期表示)</FieldLabel>
          <TimePicker
            value={selectedTime ? dayjs(selectedTime, 'HH:mm') : null}
            onChange={(newValue: Dayjs | null) =>
              setSelectedTime(newValue?.isValid() ? newValue.format('HH:mm') : '')
            }
            ampm={false}
            format="HH:mm"
            slotProps={{
              textField: {
                fullWidth: true,
                id: timeInputId,
                slotProps: { htmlInput: { 'aria-label': '走行時間' } },
              },
              openPickerButton: openPickerButtonSlotProps,
              openPickerIcon: { fontSize: 'small' },
            }}
          />
        </Box>
        <Box>
          <FieldLabel htmlFor={speedInputId}>平均時速 (km/h)</FieldLabel>
          <OutlinedInput
            id={speedInputId}
            fullWidth
            type="number"
            value={averageSpeed}
            onChange={(e) => setAverageSpeed(e.target.value)}
            inputProps={{ min: '1', step: '0.1' }}
          />
        </Box>
      </Box>

      <Box sx={{ mt: '4px' }}>
        <FormControlLabel
          control={
            <Switch
              checked={arrivalCorrectionEnabled}
              onChange={(e) => setArrivalCorrectionEnabled(e.target.checked)}
              size="small"
            />
          }
          label={
            <Typography sx={{ fontSize: 13, color: tokens.textMuted }}>
              到着予定時刻に獲得標高・休憩時間の目安を考慮する
            </Typography>
          }
        />
      </Box>

      <OfflineHistoryPanel onSelectHistory={onSelectOfflineHistory} />

      <UploadAccordion
        uploadedRoute={uploadedRoute}
        onFileParsed={(route) => {
          setUploadedRoute(route);
          setRouteInput('');
          setError('');
        }}
        onClear={() => setUploadedRoute(null)}
      />

      <Box sx={{ mt: '18px', display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          onClick={handleSubmit}
          sx={{ padding: '12px 24px', fontSize: 14 }}
        >
          天気予報を表示
        </Button>
      </Box>
      {error && (
        <Typography color="error" variant="body2" sx={{ mt: 1.5, textAlign: 'right' }}>
          {error}
        </Typography>
      )}
    </Paper>
  );
}

export default InputForm;
