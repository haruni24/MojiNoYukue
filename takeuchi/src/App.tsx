import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from 'react';
import './App.css';
import { GlassText } from './glass/GlassText';
import { VISUAL_CONFIG } from './visualConfig';
import { getPerfSettings } from './performance';
import { useRelayConnection } from './useRelayConnection';

function seededUnit(seed: number) {
  let t = seed >>> 0;
  t += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function seededRange(seed: number, min: number, max: number) {
  return min + (max - min) * seededUnit(seed);
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeInCubic(t: number) {
  return t * t * t;
}

function easeOutCubic(t: number) {
  const p = 1 - t;
  return 1 - p * p * p;
}

// --- MovingText コンポーネント ---
interface MovingTextProps {
  id: number;
  text: string;
  top: number;
  speed: number;
  onComplete: (id: number) => void;
  targetFps: number;
  enableDynamicFilter: boolean;
  quality: 'high' | 'low';
  viewportW: number;
  viewportH: number;
}

type ExitMode = 'evaporate' | 'sink' | 'shatter';

const MovingText: React.FC<MovingTextProps> = ({ 
  id,
  text,
  top,
  speed,
  onComplete,
  targetFps,
  enableDynamicFilter,
  quality,
  viewportW,
  viewportH,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);
  const phase = useMemo(() => seededUnit(id * 9973 + 17) * Math.PI * 2, [id]);
  const depth = useMemo(() => 0.08 + seededUnit(id * 9319 + 11) * 0.92, [id]);
  const baseScale = useMemo(
    () => lerp(VISUAL_CONFIG.motion.scaleFar, VISUAL_CONFIG.motion.scaleNear, depth),
    [depth],
  );
  const zIndex = useMemo(() => String(2 + Math.round(depth * 10)), [depth]);
  const exitMode = useMemo<ExitMode>(() => {
    const r = seededUnit(id * 4813 + 29);
    if (r < 0.16) return 'shatter';
    if (r < 0.64) return 'evaporate';
    return 'sink';
  }, [id]);
  const ttlMs = useMemo(
    () => VISUAL_CONFIG.life.ttlBaseMs + seededUnit(id * 19609 + 41) * VISUAL_CONFIG.life.ttlJitterMs,
    [id],
  );

  const motionRef = useRef({
    initialized: false,
    createdAt: 0,
    lastNow: 0,
    lastPaintNow: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    rotV: 0,
    lastGlintQ: -1,
    lastFilter: '',
  });

  useEffect(() => {
    if (containerRef.current) containerRef.current.style.zIndex = zIndex;
  }, [zIndex]);

  useEffect(() => {
    const animate = () => {
      const el = containerRef.current;
      if (el) {
        const now = performance.now();
        const motion = motionRef.current;
        if (!motion.initialized) {
          const w = viewportW || window.innerWidth;
          const h = viewportH || window.innerHeight;
          const yBase = (top / 100) * h;
          motion.x = seededRange(id * 3301 + 97, -w * 0.1, w * 1.1);
          motion.y = Math.min(h * 0.95, Math.max(h * 0.05, yBase + seededRange(id * 3511 + 101, -h * 0.16, h * 0.16)));
          const angle = seededRange(id * 3671 + 103, 0, Math.PI * 2);
          const startSpeed = seededRange(id * 3821 + 107, 22, 62) * (0.55 + depth) * speed;
          motion.vx = Math.cos(angle) * startSpeed;
          motion.vy = Math.sin(angle) * startSpeed * 0.72;
          motion.rot = seededRange(id * 4021 + 109, -8, 8);
          motion.rotV = seededRange(id * 4211 + 113, -18, 18) * (0.25 + depth);
          motion.createdAt = now;
          motion.lastNow = now;
          motion.lastPaintNow = now - 1000 / Math.max(1, targetFps);
          motion.initialized = true;
          el.style.zIndex = zIndex;
          if (!enableDynamicFilter) el.style.filter = 'none';
        }

        const ageMs = now - motion.createdAt;
        if (ageMs >= ttlMs) {
          onComplete(id);
          return;
        }

        const frameIntervalMs = 1000 / Math.max(1, targetFps);
        if (now - motion.lastPaintNow < frameIntervalMs) {
          requestRef.current = requestAnimationFrame(animate);
          return;
        }
        motion.lastPaintNow = now;

        const maxDt = Math.min(0.06, (1 / Math.max(20, targetFps)) * 1.6);
        const dt = Math.min(maxDt, Math.max(0.001, (now - motion.lastNow) / 1000));
        motion.lastNow = now;
        const t = now / 1000;

        const w = viewportW || window.innerWidth;
        const h = viewportH || window.innerHeight;

        const anchorX = w * (0.5 + 0.22 * Math.sin(t * 0.09 + phase * 0.35));
        const anchorY = h * (0.5 + 0.18 * Math.cos(t * 0.07 + phase * 0.52));
        const toAx = anchorX - motion.x;
        const toAy = anchorY - motion.y;
        const dist = Math.hypot(toAx, toAy) + 0.0001;
        const nx = toAx / dist;
        const ny = toAy / dist;

        const energy = Math.max(0.25, Math.min(1.7, speed));
        const flowAccel = VISUAL_CONFIG.motion.flowAccelPx * (0.35 + depth) * energy;
        const attractAccel = VISUAL_CONFIG.motion.attractAccelPx * (0.25 + depth) * energy;
        const swirlAccel = VISUAL_CONFIG.motion.swirlAccelPx * (0.18 + depth) * energy;

        const f1 =
          Math.sin(t * 0.55 + phase + motion.y * 0.0042) +
          Math.sin(t * 0.19 + phase * 1.7 + motion.x * 0.0031);
        const f2 =
          Math.cos(t * 0.48 + phase * 0.9 + motion.x * 0.004) -
          Math.sin(t * 0.16 + phase * 1.3 + motion.y * 0.0051);
        motion.vx += f1 * flowAccel * dt;
        motion.vy += f2 * flowAccel * dt;

        const attractGain = 0.35 + 0.65 * (1 - Math.min(1, dist / (Math.min(w, h) * 0.72)));
        motion.vx += nx * attractAccel * attractGain * dt;
        motion.vy += ny * attractAccel * attractGain * dt;
        motion.vx += -ny * swirlAccel * dt;
        motion.vy += nx * swirlAccel * dt;

        const damp = Math.exp(-VISUAL_CONFIG.motion.dampingPerSec * dt);
        motion.vx *= damp;
        motion.vy *= damp;

        const maxSpeed = VISUAL_CONFIG.motion.maxSpeedPx * (0.3 + depth) * energy;
        const v = Math.hypot(motion.vx, motion.vy);
        if (v > maxSpeed) {
          const s = maxSpeed / v;
          motion.vx *= s;
          motion.vy *= s;
        }

        motion.x += motion.vx * dt;
        motion.y += motion.vy * dt;
        motion.rot += motion.rotV * dt;

        const margin = VISUAL_CONFIG.motion.boundsMarginPx;
        if (motion.x < -margin) {
          motion.x = -margin;
          motion.vx = Math.abs(motion.vx) * 0.88;
          motion.vy += Math.sin(t * 2.7 + phase) * 18;
        } else if (motion.x > w + margin) {
          motion.x = w + margin;
          motion.vx = -Math.abs(motion.vx) * 0.88;
          motion.vy += Math.cos(t * 2.3 + phase) * 18;
        }
        if (motion.y < -margin) {
          motion.y = -margin;
          motion.vy = Math.abs(motion.vy) * 0.88;
          motion.vx += Math.cos(t * 2.1 + phase) * 18;
        } else if (motion.y > h + margin) {
          motion.y = h + margin;
          motion.vy = -Math.abs(motion.vy) * 0.88;
          motion.vx += Math.sin(t * 2.5 + phase) * 18;
        }

        const enterN = clamp01(ageMs / VISUAL_CONFIG.life.enterMs);
        const exitN = clamp01((ageMs - (ttlMs - VISUAL_CONFIG.life.exitMs)) / VISUAL_CONFIG.life.exitMs);
        const alpha = (0.42 + 0.58 * depth) * easeOutCubic(enterN) * (1 - easeInCubic(exitN));

        const bob = 0.55 + 0.65 * depth;
        const baseSpeed = VISUAL_CONFIG.float.speed * (0.75 + 0.45 * depth);
        const floatY = Math.sin(t * baseSpeed + phase) * VISUAL_CONFIG.float.yPx * bob;
        const floatX = Math.sin(t * baseSpeed * 0.55 + phase * 1.7) * VISUAL_CONFIG.float.xPx * bob;
        const microRot = Math.sin(t * baseSpeed * 0.7 + phase * 2.2) * VISUAL_CONFIG.float.rotDeg * bob;

        const glintPulse = Math.max(0, Math.sin(t * 0.75 + phase + motion.x * 0.0012));
        const glint = 0.25 + 0.75 * glintPulse * glintPulse;

        let exitDx = 0;
        let exitDy = 0;
        let exitRot = 0;
        let blur = (1 - enterN) * 5.5 + exitN * VISUAL_CONFIG.life.exitBlurPx;
        let letterSpacing = '';

        if (exitN > 0) {
          if (exitMode === 'evaporate') {
            exitDy = -VISUAL_CONFIG.life.exitRisePx * easeOutCubic(exitN);
            exitRot = -3.5 * exitN;
            blur += exitN * 2.2;
            letterSpacing = `${0.12 + 0.08 * exitN}em`;
          } else if (exitMode === 'sink') {
            exitDy = VISUAL_CONFIG.life.exitSinkPx * easeInCubic(exitN);
            exitRot = 2.8 * exitN;
            blur += exitN * 1.6;
            letterSpacing = `${0.12 + 0.05 * exitN}em`;
          } else {
            const j = easeOutCubic(exitN);
            exitDx = Math.sin(t * 27 + phase) * 12 * j;
            exitDy = Math.cos(t * 31 + phase) * 10 * j;
            exitRot = Math.sin(t * 23 + phase) * 6 * j;
            blur += exitN * 4.8;
            letterSpacing = `${0.12 + 0.28 * j}em`;
          }
        }

        const scale = baseScale * (1 + 0.06 * (1 - enterN)) * (1 + 0.05 * (exitMode === 'evaporate' ? exitN : 0));
        el.style.opacity = String(alpha);

        if (enableDynamicFilter && quality !== 'low') {
          const blurQ = Math.round(blur * 4) / 4;
          const brightnessQ = Math.round((0.96 + 0.14 * glint + 0.08 * depth) * 100) / 100;
          const contrastQ = Math.round((1.04 + 0.12 * glint + 0.06 * depth) * 100) / 100;
          const filter = `blur(${blurQ}px) brightness(${brightnessQ}) contrast(${contrastQ})`;
          if (filter !== motion.lastFilter) {
            el.style.filter = filter;
            motion.lastFilter = filter;
          }
          if (letterSpacing) el.style.letterSpacing = letterSpacing;
        }

        const glintQ = Math.round(glint * 50) / 50;
        if (glintQ !== motion.lastGlintQ) {
          el.style.setProperty('--glint', String(glintQ));
          motion.lastGlintQ = glintQ;
        }

        el.style.transform = `translate3d(${(motion.x + floatX + exitDx).toFixed(2)}px, ${(motion.y + floatY + exitDy).toFixed(2)}px, 0) rotate(${(motion.rot + microRot + exitRot).toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, [
    id,
    speed,
    onComplete,
    phase,
    top,
    depth,
    baseScale,
    exitMode,
    ttlMs,
    targetFps,
    enableDynamicFilter,
    quality,
    viewportW,
    viewportH,
    zIndex,
  ]);

  return (
    <div
      ref={containerRef}
      className={['moving-text-container', quality === 'low' ? 'moving-text-container--low' : null]
        .filter(Boolean)
        .join(' ')}
      style={{ top: 0, left: 0, willChange: 'transform, opacity, filter' }}
    >
      <GlassText text={text} hue={VISUAL_CONFIG.glass.hue} quality={quality} />
    </div>
  );
};

// --- App コンポーネント ---
interface MessageData {
  id: number;
  text: string;
  top: number;
  speed: number;
}

interface SpecialMessage {
  id: string;
  text: string;
  yN: number;
  hue: number;
  createdAt: number;
}

function App() {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [csvData, setCsvData] = useState<string[]>([]);
  const [specials, setSpecials] = useState<SpecialMessage[]>([]);
  const [viewport, setViewport] = useState(() => {
    if (typeof window === 'undefined') return { w: 0, h: 0 };
    return { w: window.innerWidth, h: window.innerHeight };
  });
  const perf = useMemo(() => getPerfSettings(), []);
  const nextId = useRef(0); // ユニークなIDを生成するためのカウンター
  const csvIndex = useRef(0); // 次に表示するCSVデータの行番号
  const cleanupTimersRef = useRef<number[]>([]);

  const handleRemove = (idToRemove: number) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== idToRemove));
  };

  // 起動時に一度だけCSVを読み込み、メッセージ生成のループを開始する
  useEffect(() => {
    fetch('/選択１.csv')
      .then((response) => {
        if (!response.ok) {
          throw new Error('CSVファイルが見つかりません');
        }
        return response.text();
      })
      .then((text) => {
        // ヘッダー行を除き、B列のデータを抽出
        const rows = text.split(/\r\n|\n/).slice(1); // .slice(1)でヘッダーを除外
        const columnBData = rows
          .map((row) => {
            const columns = row.split(',');
            return columns[1] ? columns[1].trim() : '';
          })
          .filter((text) => text !== '');

        setCsvData(columnBData);
      })
      .catch((error) => console.error("CSV読み込みエラー:", error));
  }, []); // 最初の一回だけ実行

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // csvDataが更新されたら、メッセージ生成のインターバルを開始
  useEffect(() => {
    if (csvData.length === 0) return;

    const intervalId = setInterval(() => {
      // csvDataから次のメッセージを取得
      const text = csvData[csvIndex.current];
      
      // 次の行へ。最後まで行ったら最初に戻る
      csvIndex.current = (csvIndex.current + 1) % csvData.length;

      const newMessage: MessageData = {
        id: nextId.current++,
        text: text,
        top: Math.random() * 78 + 8, // 初期y（％）
        speed: Math.random() * 0.7 + 0.75, // エネルギー係数（自由移動の強さ）
      };

      // 画面上のメッセージが15個を超えないようにする
      setMessages((prev) => [...prev, newMessage].slice(-perf.maxMovingTexts));

    }, 2000); // 2秒ごとに新しいメッセージを生成

    // コンポーネントがアンマウントされた時にインターバルをクリア
    return () => clearInterval(intervalId);

  }, [csvData, perf.maxMovingTexts]); // csvDataがセットされたらこのeffectを実行

  const handlePayload = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as {
      type?: string;
      id?: string;
      text?: string;
      yN?: number;
      hue?: number;
      at?: number;
    };
    // takeuchi-text と takeuchi-ai-text の両方を受け付ける
    if (data.type !== 'takeuchi-text' && data.type !== 'takeuchi-ai-text') return;
    if (typeof data.text !== 'string' || !data.text.trim()) return;
    const id = typeof data.id === 'string' ? data.id : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const yN = typeof data.yN === 'number' && Number.isFinite(data.yN) ? data.yN : 0.5;
    const hue = typeof data.hue === 'number' && Number.isFinite(data.hue) ? data.hue : 210;
    const createdAt = typeof data.at === 'number' && Number.isFinite(data.at) ? data.at : Date.now();
    const message: SpecialMessage = {
      id,
      text: data.text.trim(),
      yN: Math.min(0.95, Math.max(0.05, yN)),
      hue,
      createdAt,
    };

    setSpecials((prev) => [...prev, message].slice(-perf.maxSpecials));
    const timer = window.setTimeout(() => {
      setSpecials((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
    cleanupTimersRef.current.push(timer);
  }, [perf.maxSpecials]);

  // WebSocket relay 経由で受信 (別マシンからのメッセージ)
  useRelayConnection({
    onMessage: handlePayload,
  });

  // BroadcastChannel + localStorage (同一プロセス/マシンフォールバック)
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('mojinoyukue-takeuchi');
      channel.addEventListener('message', (event) => handlePayload(event.data));
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'takeuchi.trigger' || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as unknown;
        handlePayload(parsed);
      } catch {
        // ignore
      }
    };

    window.addEventListener('storage', onStorage);

    return () => {
      if (channel) channel.close();
      window.removeEventListener('storage', onStorage);
      cleanupTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      cleanupTimersRef.current = [];
    };
  }, [handlePayload]);

  const appStyle = useMemo(() => {
    return {
      ['--bg-base' as unknown as string]: VISUAL_CONFIG.background.base,
      ['--bg-glow-a' as unknown as string]: VISUAL_CONFIG.background.glowA,
      ['--bg-glow-b' as unknown as string]: VISUAL_CONFIG.background.glowB,
      ['--bg-vignette' as unknown as string]: String(VISUAL_CONFIG.background.vignette),
    } as CSSProperties;
  }, []);

  return (
    <div className="App" style={appStyle}>
      {perf.enableSvgFilter ? (
        <svg className="glass-defs" aria-hidden="true" focusable="false">
          <filter id="glass-text-filter" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="a" />
            <feSpecularLighting
              in="a"
              surfaceScale="2.6"
              specularConstant="0.9"
              specularExponent="26"
              lightingColor="#ffffff"
              result="spec"
            >
              <feDistantLight azimuth="225" elevation="58" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specMask" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="specMask" />
            </feMerge>
          </filter>
        </svg>
      ) : null}

      {messages.map((msg) => (
        <MovingText
          key={msg.id}
          id={msg.id}
          text={msg.text}
          top={msg.top}
          speed={msg.speed}
          onComplete={handleRemove}
          targetFps={perf.targetFps}
          enableDynamicFilter={perf.enableDynamicFilter}
          quality={perf.quality}
          viewportW={viewport.w}
          viewportH={viewport.h}
        />
      ))}

      {specials.map((msg) => (
        <div
          key={msg.id}
          className="special-container"
          style={
            {
              ['--top' as unknown as string]: `${msg.yN * 100}%`,
              ['--hue' as unknown as string]: String(msg.hue),
            } as CSSProperties
          }
        >
          <GlassText className="special-text" text={msg.text} hue={msg.hue} quality={perf.quality} />
        </div>
      ))}
    </div>
  );
}

export default App;
