import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { buildPointWarningSummaries, getTemperatureSwing } from '../features/weather/warnings';
import { roundTemp } from '../features/weather/format';
import type { WeatherPoint } from '../features/weather/types';
import { tokens } from '../theme';

type SummaryBannerProps = {
  weatherData: WeatherPoint[];
};

function Dot({ color }: { color: string }) {
  return (
    <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
  );
}

function SummaryBanner({ weatherData: weatherDataProp }: SummaryBannerProps) {
  // 呼び出し元の実装ミスでundefined/nullが渡ってもクラッシュしないようにする(防御的コピー)
  const weatherData = weatherDataProp ?? [];
  const pointSummaries = buildPointWarningSummaries(weatherData);
  const swing = getTemperatureSwing(weatherData);
  const warningCount = pointSummaries.length + (swing ? 1 : 0);
  // 全地点で天気取得に失敗している場合、warningCount=0(警告該当なし)と区別がつかず
  // 「概ね良好」という誤った安心メッセージになってしまうため、取得失敗として別扱いする
  const allFailed = weatherData.length > 0 && weatherData.every((p) => p.weather === null);

  if (allFailed) {
    return (
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <Dot color={tokens.warningDot} />
        <Typography sx={{ fontSize: 13, color: tokens.textMuted }}>
          天候情報を取得できませんでした。各地点のカードをご確認ください
        </Typography>
      </Stack>
    );
  }

  // 警告が一つもない場合も、EPIC Ride Weather等の分単位データ表示に対して
  // 「一目で分かる」強みを出すため、総合判定の一文だけは常に表示する
  if (warningCount === 0) {
    return (
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <Dot color={tokens.accent} />
        <Typography sx={{ fontSize: 13, color: tokens.textMuted }}>
          本日のライドは概ね良好な天候です
        </Typography>
      </Stack>
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: tokens.warningBannerBg,
        borderRadius: '14px',
        padding: '14px 18px',
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: tokens.warningBannerText, mb: 1 }}>
        注意が必要な点が{warningCount}件あります
      </Typography>
      {pointSummaries.length > 0 && (
        <Stack spacing={0.75}>
          {pointSummaries.map((summary) => (
            <Stack key={summary.reason} direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Dot color={tokens.warningDot} />
              <Typography sx={{ fontSize: 13, color: tokens.warningBannerText }}>
                {summary.message}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      {swing && (
        <Stack
          direction="row"
          spacing={1.25}
          sx={{
            alignItems: 'center',
            mt: pointSummaries.length > 0 ? 1 : 0,
            pt: pointSummaries.length > 0 ? 1 : 0,
            borderTop: pointSummaries.length > 0 ? `1px solid ${tokens.warningBorder}` : 'none',
          }}
        >
          <Typography sx={{ fontSize: 14, flexShrink: 0 }} aria-hidden="true">
            ↕
          </Typography>
          <Typography sx={{ fontSize: 13, color: tokens.warningBannerText }}>
            <strong>気温差{roundTemp(swing.diffC)}℃</strong>({swing.maxPoint.name}{' '}
            {roundTemp(swing.maxPoint.weather?.main?.feels_like)}℃ → {swing.minPoint.name}{' '}
            {roundTemp(swing.minPoint.weather?.main?.feels_like)}℃)。防寒・防暑装備の見直しを検討してください
          </Typography>
        </Stack>
      )}

      {pointSummaries.length > 0 && (
        <Typography sx={{ fontSize: 13, color: tokens.warningBannerText, mt: 0.75, ml: '20px' }}>
          休憩や装備の見直しを検討してください。
        </Typography>
      )}
    </Box>
  );
}

export default SummaryBanner;
