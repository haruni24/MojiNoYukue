import type { CSSProperties } from 'react';
import './glass.css';

type GlassTextProps = {
  text: string;
  className?: string;
  style?: CSSProperties;
  hue?: number;
  quality?: 'high' | 'low';
};

export function GlassText({ text, className, style, hue, quality = 'high' }: GlassTextProps) {
  const hueStyle =
    hue == null
      ? undefined
      : ({
          ['--glass-hue' as unknown as string]: String(hue),
        } as CSSProperties);

  return (
    <span
      className={[
        'glass-text',
        quality === 'low' ? 'glass-text--low' : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-text={text}
      style={{ ...hueStyle, ...style }}
    >
      {text}
    </span>
  );
}
