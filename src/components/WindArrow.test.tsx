import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import WindArrow from './WindArrow';
import { tokens } from '../theme';

// vitest.config.tsはtest.globals:trueを設定していないため、@testing-library/reactの
// 自動クリーンアップが効かない(詳細はInputForm.test.tsx参照)
afterEach(cleanup);

describe('WindArrow', () => {
  it('windDegが未定義の場合、既定では何も描画しない(呼び出し元のダッシュ表示との二重表示を避けるため)', () => {
    const { container } = render(<WindArrow windDeg={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('windDegが未定義でもshowDashWhenUnknownを指定するとダッシュを表示する(WeatherMatrix用)', () => {
    const { container } = render(<WindArrow windDeg={undefined} showDashWhenUnknown />);
    expect(screen.getByText('ー')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('bearingDegが未指定の場合は中立色(textMuted)で表示する', () => {
    const { container } = render(<WindArrow windDeg={90} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe(tokens.textMuted);
  });

  it('相対角度が向かい風の範囲なら警告色(赤)になる', () => {
    // bearing=0(北向き進行)、wind=0(北から吹いてくる)→向かい風
    const { container } = render(<WindArrow windDeg={0} bearingDeg={0} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe(tokens.warning);
  });

  it('相対角度が追い風の範囲なら追い風用の緑になる', () => {
    // bearing=0(北向き進行)、wind=180(南から吹いてくる=背中から)→追い風
    const { container } = render(<WindArrow windDeg={180} bearingDeg={0} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe(tokens.windTailwind);
  });

  it('相対角度が横風の範囲ならcrosswindトークンの色になる', () => {
    // bearing=0(北向き進行)、wind=90(東から吹いてくる)→横風
    const { container } = render(<WindArrow windDeg={90} bearingDeg={0} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe(tokens.crosswind);
  });

  it('bearingDegがNaN(進行方向が定義不能な地点)の場合は中立色になる', () => {
    const { container } = render(<WindArrow windDeg={90} bearingDeg={NaN} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe(tokens.textMuted);
  });

  it('矢印は風が吹いていく方向(風向きの180度反対)を指す', () => {
    const { container } = render(<WindArrow windDeg={90} bearingDeg={0} />);
    const svg = container.querySelector('svg');
    // windDeg=90(東から吹いてくる)→吹いていく方向は270度(西)。MUIのsxはemotion経由の
    // CSSクラスとして適用されるためgetAttribute('style')では取れず、getComputedStyleで確認する
    expect(svg && window.getComputedStyle(svg).transform).toContain('rotate(270deg)');
  });

  it('sizeを指定すると幅・高さに反映される', () => {
    const { container } = render(<WindArrow windDeg={0} size={16} />);
    const svg = container.querySelector('svg');
    expect(svg && window.getComputedStyle(svg).width).toBe('16px');
    expect(svg && window.getComputedStyle(svg).height).toBe('16px');
  });

  it('sizeを省略すると既定サイズ(20px)になる', () => {
    const { container } = render(<WindArrow windDeg={0} />);
    const svg = container.querySelector('svg');
    expect(svg && window.getComputedStyle(svg).width).toBe('20px');
    expect(svg && window.getComputedStyle(svg).height).toBe('20px');
  });

  it('回転角が360度を折り返す場合も正しく計算される', () => {
    // windDeg=270(西から吹いてくる)→吹いていく方向は450%360=90度(東)
    const { container } = render(<WindArrow windDeg={270} bearingDeg={0} />);
    const svg = container.querySelector('svg');
    expect(svg && window.getComputedStyle(svg).transform).toContain('rotate(90deg)');
  });
});
