import { Component, type ErrorInfo, type ReactNode } from 'react';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

// 予期しないレンダリングエラーで白画面になるのを防ぐ
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  // Reactは子が`throw`した値をそのまま渡すため、実際にはError以外(null/undefined/文字列等)も
  // 渡りうる。`hasError`という明示的なboolean stateにすることで、falsy値がthrowされても
  // フォールバックUIの表示条件を取りこぼさないようにする
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    // 本番では利用者のブラウザコンソールにスタックトレース等の内部情報をそのまま
    // 出力しない(セキュリティ方針)。開発時のみ出力する
    if (import.meta.env.DEV) {
      const normalized = toError(error);
      console.error('[render-error]', normalized.name, normalized.message, normalized.stack, errorInfo.componentStack);
    }
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Container maxWidth="sm" sx={{ py: 8 }}>
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="h5" component="h1">
              予期しないエラーが発生しました
            </Typography>
            <Typography variant="body1" color="text.secondary">
              ページを再読み込みしてもう一度お試しください。問題が続く場合は、入力したルートID/URLをご確認ください。
            </Typography>
            <Button variant="contained" onClick={this.handleReload}>
              再読み込み
            </Button>
          </Stack>
        </Container>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
