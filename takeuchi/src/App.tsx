import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import './App.css';
import { GlassText } from './glass/GlassText';
import { VISUAL_CONFIG } from './visualConfig';

function seededUnit(seed: number) {
  let t = seed >>> 0;
  t += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- MovingText コンポーネント ---
interface MovingTextProps {
  id: number;
  text: string;
  top: number;
  speed: number;
  onComplete: (id: number) => void;
}

const MovingText: React.FC<MovingTextProps> = ({ 
  id, text, top, speed, onComplete 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);
  const xPosRef = useRef(-300);
  const phase = useMemo(() => seededUnit(id * 9973 + 17) * Math.PI * 2, [id]);
  const floatScale = useMemo(() => 0.7 + seededUnit(id * 9967 + 23) * 0.9, [id]);

  useEffect(() => {
    const animate = () => {
      xPosRef.current += speed;
      const currentContainerX = xPosRef.current;

      if (currentContainerX > window.innerWidth) {
        onComplete(id);
        return;
      }

      if (containerRef.current) {
        const t = performance.now() / 1000;
        const baseSpeed = VISUAL_CONFIG.float.speed;
        const floatY = Math.sin(t * baseSpeed + phase) * VISUAL_CONFIG.float.yPx * floatScale;
        const floatX = Math.sin(t * baseSpeed * 0.55 + phase * 1.7) * VISUAL_CONFIG.float.xPx * floatScale;
        const rot = Math.sin(t * baseSpeed * 0.7 + phase * 2.2) * VISUAL_CONFIG.float.rotDeg * floatScale;
        containerRef.current.style.transform = `translate3d(${currentContainerX + floatX}px, ${floatY}px, 0) rotate(${rot}deg)`;
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, [id, speed, onComplete, phase, floatScale]);

  return (
    <div
      ref={containerRef}
      className="moving-text-container"
      style={{ top: `${top}%`, left: 0, willChange: 'transform' }}
    >
      <GlassText text={text} hue={VISUAL_CONFIG.glass.hue} />
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
        console.log("B列のデータ:", columnBData);
      })
      .catch((error) => console.error("CSV読み込みエラー:", error));
  }, []); // 最初の一回だけ実行

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
        top: Math.random() * 90, // 画面の上から90%の範囲でランダム
        speed: Math.random() * 2 + 1, // 1〜3のランダムな速度
      };

      // 画面上のメッセージが15個を超えないようにする
      setMessages((prev) => [...prev, newMessage].slice(-15));

    }, 2000); // 2秒ごとに新しいメッセージを生成

    // コンポーネントがアンマウントされた時にインターバルをクリア
    return () => clearInterval(intervalId);

  }, [csvData]); // csvDataがセットされたらこのeffectを実行

  useEffect(() => {
    const handlePayload = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const data = payload as {
        type?: string;
        id?: string;
        text?: string;
        yN?: number;
        hue?: number;
        at?: number;
      };
      if (data.type !== 'takeuchi-text') return;
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

      setSpecials((prev) => [...prev, message].slice(-12));
      const timer = window.setTimeout(() => {
        setSpecials((prev) => prev.filter((item) => item.id !== id));
      }, 4500);
      cleanupTimersRef.current.push(timer);
    };

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
  }, []);

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

      {messages.map((msg) => (
        <MovingText
          key={msg.id}
          id={msg.id}
          text={msg.text}
          top={msg.top}
          speed={msg.speed}
          onComplete={handleRemove}
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
          <GlassText className="special-text" text={msg.text} hue={msg.hue} />
        </div>
      ))}
    </div>
  );
}

export default App;
