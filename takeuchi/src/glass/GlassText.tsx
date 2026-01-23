import type { CSSProperties } from 'react';
import './glass.css';

type GlassTextProps = {
  text: string;
  className?: string;
  style?: CSSProperties;
  hue?: number;
};

export function GlassText({ text, className, style, hue }: GlassTextProps) {
  const hueStyle =
    hue == null
      ? undefined
      : ({
          ['--glass-hue' as unknown as string]: String(hue),
        } as CSSProperties);

  return (
    <span
      className={['glass-text', className].filter(Boolean).join(' ')}
      data-text={text}
      style={{ ...hueStyle, ...style }}
    >
      {text}
    </span>
  );
}

