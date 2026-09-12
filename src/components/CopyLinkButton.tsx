import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { tokens } from '../theme';

type CopyState = 'idle' | 'copied' | 'failed';

function CopyLinkButton() {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
    } catch {
      // 非HTTPS環境・権限拒否・非対応ブラウザ等でclipboard APIが使えない場合、失敗を明示する
      setCopyState('failed');
    }
    resetTimerRef.current = setTimeout(() => setCopyState('idle'), 2000);
  };

  const label =
    copyState === 'copied' ? 'コピーしました' : copyState === 'failed' ? 'コピーできませんでした' : 'リンクをコピー';

  return (
    <div>
      <Button
        variant="outlined"
        onClick={handleCopy}
        sx={{
          backgroundColor: '#ffffff',
          borderColor: tokens.exportButtonBorder,
          color: tokens.accent,
          fontSize: 13,
          padding: '9px 18px',
        }}
      >
        {label}
      </Button>
      {copyState === 'failed' && (
        <Typography color="error" variant="body2" sx={{ mt: 0.5 }}>
          URLを手動でコピーしてください: {typeof window !== 'undefined' ? window.location.href : ''}
        </Typography>
      )}
    </div>
  );
}

export default CopyLinkButton;
