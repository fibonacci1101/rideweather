import { createTheme } from '@mui/material/styles';
import type {} from '@mui/x-date-pickers/themeAugmentation';

// docs/design_handoff_ride_weather_ui/README.md のデザイントークン(元はoklch指定)を
// sRGB hexに変換して使用。html2canvas(画像エクスポート機能)がoklch()を解釈できず
// "Attempting to parse an unsupported color function 'oklch'" になるため、hex固定とする。
// 変換はブラウザのcanvas 2Dコンテキスト(fillStyle→getImageData)で行った実測値。
export const tokens = {
  background: '#f3f6f4',
  pageBackground: '#e3eae6', // oklch(93% 0.008 160)。本文コンテナ(background)より一段暗いページ地色
  textPrimary: '#0f1211',
  textMuted: '#54615a',
  accent: '#143525',
  accentLabel: '#006a3b',
  border: '#d2dad5',
  borderSubtle: '#e8ecea',
  warning: '#bb4717',
  warningBorder: '#e5987d',
  warningBannerBg: '#ffe1c7',
  warningBannerText: '#43251a',
  warningDot: '#c1552c',
  statValueNormal: '#121714',
  exportButtonBorder: '#c3d2c9',
  paper: '#ffffff', // カード・入力欄等の背景色(白)。複数箇所で参照するため一元化しておく
  cold: '#1565c0', // 最低気温バッジ用(暖色系のwarningと区別するため青系にする)
  coldBorder: '#90caf9',
  crosswind: '#b8860b', // 横風アイコン用(向かい風=warning赤・追い風=windTailwind緑と識別しやすい琥珀色)
  // 追い風アイコン専用の緑。当初はaccent(#143525)を流用していたが、時間帯表の小さい
  // アイコンだと暗すぎてほぼ黒に見え「緑と分かりにくい」という実機フィードバックがあった
  // (accentは背景が白のテキスト/バッジ用に設計された色で、14px前後の小アイコンでの
  // 視認性は考慮されていなかった)。より明るく彩度の高い緑に差し替える
  windTailwind: '#1a7a43',
  shadow: '0 1px 3px rgba(0,0,0,0.06)',
  shadowContainer: '0 1px 3px rgba(0,0,0,0.05), 0 12px 32px rgba(0,0,0,0.06)',
  radiusForm: '20px',
  radiusCard: '16px',
  radiusControl: '10px',
  radiusContainer: '28px',
} as const;

export const theme = createTheme({
  palette: {
    background: {
      default: tokens.pageBackground,
      paper: tokens.paper,
    },
    text: {
      primary: tokens.textPrimary,
      secondary: tokens.textMuted,
    },
    primary: {
      main: tokens.accent,
    },
    warning: {
      main: tokens.warning,
    },
  },
  shape: {
    // tokens.radiusControlと同期させること('10px' → 10)
    borderRadius: parseInt(tokens.radiusControl, 10),
  },
  typography: {
    fontFamily: "'Manrope', 'Noto Sans JP', system-ui, 'Segoe UI', Roboto, sans-serif",
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 700,
          borderRadius: tokens.radiusControl,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radiusCard,
          boxShadow: tokens.shadow,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radiusControl,
          backgroundColor: tokens.paper,
          fontSize: 14,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: tokens.border,
          },
        },
        input: {
          padding: '11px 14px',
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          padding: '11px 14px',
        },
      },
    },
    // DatePicker(@mui/x-date-pickers)はMuiOutlinedInputとは別コンポーネントを使うため、
    // 高さ・パディング・枠線色を他の入力欄と揃えるために個別に上書きする
    MuiPickersOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radiusControl,
          backgroundColor: tokens.paper,
          fontSize: 14,
          padding: '0 14px',
          '& .MuiPickersOutlinedInput-notchedOutline': {
            borderColor: tokens.border,
          },
          // 実際に縦paddingを持つのは.inputではなくsectionsContainer側
          '& .MuiPickersInputBase-sectionsContainer': {
            padding: '11px 0',
          },
        },
      },
    },
  },
});
