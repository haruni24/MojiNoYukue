export type PerfMode = 'high' | 'low';

export type PerfSettings = {
  mode: PerfMode;
  targetFps: number;
  maxMovingTexts: number;
  maxSpecials: number;
  enableDynamicFilter: boolean;
  enableSvgFilter: boolean;
  quality: 'high' | 'low';
};

function readOverride(): PerfMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('perf');
    if (q === 'low' || q === 'high') return q;
  } catch {
    // ignore
  }

  try {
    const v = window.localStorage.getItem('takeuchi.perf');
    if (v === 'low' || v === 'high') return v;
  } catch {
    // ignore
  }

  return null;
}

function inferLowPower(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  } catch {
    // ignore
  }

  const nav = window.navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8;
  const mem = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 8;
  return cores <= 4 || mem <= 4;
}

export function getPerfSettings(): PerfSettings {
  const override = readOverride();
  const mode: PerfMode = override ?? (inferLowPower() ? 'low' : 'high');

  if (mode === 'low') {
    return {
      mode,
      targetFps: 30,
      maxMovingTexts: 8,
      maxSpecials: 8,
      enableDynamicFilter: false,
      enableSvgFilter: false,
      quality: 'low',
    };
  }

  return {
    mode,
    targetFps: 60,
    maxMovingTexts: 15,
    maxSpecials: 12,
    enableDynamicFilter: true,
    enableSvgFilter: true,
    quality: 'high',
  };
}

