import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import InputForm, { type InputFormSubmitParams } from './InputForm';
import { getTodayLocalDateString } from '../features/weather/format';

// InputFormはDatePicker/TimePicker(@mui/x-date-pickers)を使うため、LocalizationProvider
// (main.tsxが本番で常に提供している)がないとレンダリング時に例外になる
function renderInputForm(props: Partial<React.ComponentProps<typeof InputForm>> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const onSelectOfflineHistory = props.onSelectOfflineHistory ?? vi.fn();
  render(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <InputForm
        onSubmit={onSubmit}
        onSelectOfflineHistory={onSelectOfflineHistory}
        initialValues={props.initialValues}
      />
    </LocalizationProvider>
  );
  return { onSubmit, onSelectOfflineHistory };
}

// DatePicker/TimePicker本体をjsdom上で開閉操作するのは壊れやすく実装コストに見合わないため
// 日付・時刻はinitialValuesで事前に埋めた
// 状態から始め、テキスト入力(ルートID/URL・平均時速)の検証ロジックに絞ってテストする
// 固定の過去日文字列だと時間経過で「今日より前」判定に引っかかり壊れるため、常に
// 実行時の当日を使う(useRouteWeather.test.tsxのnowLocalDateTimeParts()と同じ方針)
const VALID_VALUES: InputFormSubmitParams = {
  routeSource: { type: 'rwgps', routeId: '12345' },
  selectedDate: getTodayLocalDateString(),
  selectedTime: '09:00',
  averageSpeedKmh: 20,
  arrivalCorrectionEnabled: true,
};

function getRouteInput(): HTMLInputElement {
  return screen.getByLabelText('Ride with GPS ルートID または URL') as HTMLInputElement;
}

function getSpeedInput(): HTMLInputElement {
  return screen.getByLabelText('平均時速 (km/h)') as HTMLInputElement;
}

function clickSubmit() {
  fireEvent.click(screen.getByRole('button', { name: '天気予報を表示' }));
}

beforeEach(() => {
  localStorage.clear();
});

// vitest.config.tsはtest.globals:trueを設定していないため、@testing-library/reactの
// 自動クリーンアップ(globalThis.afterEachを検出して登録する仕組み)が効かない。
// 明示的にcleanup()しないと前のテストのDOMが残り、後続テストのgetByRole等が
// 複数要素にマッチして失敗する
afterEach(cleanup);

describe('InputForm', () => {
  it('有効な入力(初期値そのまま)を送信すると、onSubmitが同じ内容で呼ばれる', () => {
    const { onSubmit } = renderInputForm({ initialValues: VALID_VALUES });
    clickSubmit();

    expect(onSubmit).toHaveBeenCalledWith(VALID_VALUES);
    expect(screen.queryByText(/入力してください/)).toBeNull();
  });

  it('ルートID欄をURL形式に書き換えると、そこから数字IDを抽出して送信する', () => {
    const { onSubmit } = renderInputForm({ initialValues: VALID_VALUES });
    fireEvent.change(getRouteInput(), { target: { value: 'https://ridewithgps.com/routes/98765' } });
    clickSubmit();

    expect(onSubmit).toHaveBeenCalledWith({ ...VALID_VALUES, routeSource: { type: 'rwgps', routeId: '98765' } });
  });

  it('ドメイン境界を偽装したURL(fake-ridewithgps.com)はルートIDとして抽出されない', () => {
    const { onSubmit } = renderInputForm({ initialValues: VALID_VALUES });
    fireEvent.change(getRouteInput(), { target: { value: 'https://fake-ridewithgps.com/routes/1' } });
    clickSubmit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('有効なルートID/URLと走行日を入力してください。')).toBeTruthy();
  });

  it('走行日が今日より前(範囲外)だと送信されずエラーになる', () => {
    const { onSubmit } = renderInputForm({
      initialValues: { ...VALID_VALUES, selectedDate: '2020-01-01' },
    });
    clickSubmit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('走行日は今日から5日後までの範囲で入力してください。')).toBeTruthy();
  });

  it('平均時速が未入力だと送信されずエラーになる', () => {
    const { onSubmit } = renderInputForm({
      initialValues: { ...VALID_VALUES, averageSpeedKmh: null },
    });
    clickSubmit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('平均時速を入力してください。')).toBeTruthy();
  });

  it('平均時速に0以下の値を入力すると送信されずエラーになる', () => {
    const { onSubmit } = renderInputForm({ initialValues: VALID_VALUES });
    fireEvent.change(getSpeedInput(), { target: { value: '0' } });
    clickSubmit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('平均時速を入力してください。')).toBeTruthy();
  });

  it('走行日はinitialValues未指定の場合、当日がデフォルトのまま送信される(STEP5)', () => {
    const { onSubmit } = renderInputForm();
    fireEvent.change(getRouteInput(), { target: { value: '12345' } });
    fireEvent.change(getSpeedInput(), { target: { value: '20' } });
    clickSubmit();

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ selectedDate: getTodayLocalDateString() })
    );
  });

  it('送信成功後、直近のルートID・平均時速がローカルキャッシュに保存される(localCache.ts)', () => {
    renderInputForm({ initialValues: VALID_VALUES });
    clickSubmit();

    const cached = JSON.parse(localStorage.getItem('ride-weather-app:lastInput') ?? 'null');
    expect(cached).toEqual({ routeId: '12345', averageSpeedKmh: 20 });
  });

  it('補正トグルはデフォルトON、OFFにして送信するとarrivalCorrectionEnabled:falseで送信される(STEP7)', () => {
    const { onSubmit } = renderInputForm({ initialValues: VALID_VALUES });
    const toggle = screen.getByRole('switch', {
      name: '到着予定時刻に獲得標高・休憩時間の目安を考慮する',
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    clickSubmit();

    expect(onSubmit).toHaveBeenCalledWith({ ...VALID_VALUES, arrivalCorrectionEnabled: false });
  });

  it('initialValuesでarrivalCorrectionEnabled:falseが渡されるとトグルはOFFで初期表示される', () => {
    renderInputForm({ initialValues: { ...VALID_VALUES, arrivalCorrectionEnabled: false } });
    const toggle = screen.getByRole('switch', {
      name: '到着予定時刻に獲得標高・休憩時間の目安を考慮する',
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });
});
