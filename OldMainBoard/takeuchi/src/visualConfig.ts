export const VISUAL_CONFIG = {
  background: {
    base: '#03060b',
    glowA: 'rgba(80, 170, 255, 0.18)',
    glowB: 'rgba(255, 110, 210, 0.12)',
    vignette: 0.86,
  },
  glass: {
    hue: 205,
  },
  motion: {
    boundsMarginPx: 140,
    maxSpeedPx: 240,
    flowAccelPx: 92,
    attractAccelPx: 64,
    swirlAccelPx: 52,
    dampingPerSec: 1.25,
    scaleNear: 1.22,
    scaleFar: 0.72,
  },
  float: {
    yPx: 14,
    xPx: 6,
    rotDeg: 2.2,
    speed: 1.15,
  },
  life: {
    enterMs: 780,
    exitMs: 1900,
    ttlBaseMs: 11500,
    ttlJitterMs: 6500,
    exitRisePx: 84,
    exitSinkPx: 78,
    exitBlurPx: 9,
  },
} as const;
