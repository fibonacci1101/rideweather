import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { tokens } from '../theme';
import { classifyWindRelation, type WindRelation } from '../features/weather/bearing';
import { DASH } from '../features/weather/format';

type WindArrowProps = {
  windDeg: number | undefined;
  // 進行方向ベアリング。未指定の場合は向かい風/追い風の分類ができないため中立色で表示する
  bearingDeg?: number;
  size?: number;
  // windDeg未定義時にダッシュを表示するか。WeatherDisplay(カード)側は隣接するvalue表示が
  // 同じ条件(wind.speed未定義)で既にダッシュを出すため、二重表示("ー ー")を避けてfalseにする。
  // WeatherMatrix(表)側はアイコン単体で欠損を表現する必要があるためtrueにする
  // (コードレビューで発見)
  showDashWhenUnknown?: boolean;
};

const DEFAULT_SIZE = 20;

// 向かい風(赤)・追い風(緑)・横風(黄系)の色分け。既存の警告色(warning)・
// 最低気温バッジ色(cold, 未使用だが対比のため)とは別に、crosswind用の琥珀色トークンを使う
const RELATION_COLOR: Record<WindRelation, string> = {
  headwind: tokens.warning,
  tailwind: tokens.windTailwind,
  crosswind: tokens.crosswind,
};

// 風向き・進行方向から矢印アイコンを描画する。既存の16方位テキスト表記(getWindDirectionLabel)は
// 引き続き併記し、矢印だけに頼らない(アクセシビリティ・情報量の両面で。
// plans/STEP6_IMPLEMENTATION_PLAN.md 0節参照)
function WindArrow({ windDeg, bearingDeg, size = DEFAULT_SIZE, showDashWhenUnknown = false }: WindArrowProps) {
  if (windDeg === undefined) {
    if (!showDashWhenUnknown) return null;
    return (
      <Typography component="span" sx={{ fontSize: 13, color: tokens.textMuted }}>
        {DASH}
      </Typography>
    );
  }

  // 矢印は「風が吹いていく方向」を指す(気象学の慣例である「吹いてくる方向」とは逆)。
  // 進行方向と同じ向きを指せば追い風、逆向きなら向かい風と直感的に読めるようにするため
  const pointingDeg = (windDeg + 180) % 360;
  // bearingDeg未指定(進行方向不明)、またはclassifyWindRelationが判定不能(非有限値)と
  // 判断した場合はいずれも中立色にする(コードレビューで発見した「架空の北向き」問題対応)
  const relation = bearingDeg === undefined ? undefined : classifyWindRelation(windDeg, bearingDeg);
  const color = relation === undefined ? tokens.textMuted : RELATION_COLOR[relation];

  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        transform: `rotate(${pointingDeg}deg)`,
      }}
    >
      <path d="M12 2 L19 20 L12 15.5 L5 20 Z" fill={color} />
    </Box>
  );
}

export default WindArrow;
