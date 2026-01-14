import { useState, useEffect, useRef, useLayoutEffect, type CSSProperties } from 'react';
import './App.css';

// --- ゾーン定義（前回と同じ） ---
interface Zone {
  start: number;
  end: number;
  scale: number;
  spacing: number;
}

const PROJECTION_ZONES: Zone[] = [
  { start: 480, end: 800, scale: 0.95, spacing: 0 },
];

// --- MovingText コンポーネント（前回と同じ） ---
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
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const xPosRef = useRef(-300);
  const charScalesRef = useRef<number[]>(new Array(text.length).fill(1));
  const charSpacingsRef = useRef<number[]>(new Array(text.length).fill(0));
  const charOffsetsRef = useRef<number[]>([]);

  useLayoutEffect(() => {
    if (charRefs.current.length > 0) {
      charOffsetsRef.current = charRefs.current.map(span => span?.offsetLeft || 0);
    }
  }, [text]);

  useEffect(() => {
    const animate = () => {
      xPosRef.current += speed;
      const currentContainerX = xPosRef.current;

      if (currentContainerX > window.innerWidth) {
        onComplete(id);
        return;
      }

      if (containerRef.current) {
        containerRef.current.style.transform = `translateX(${currentContainerX}px)`;
      }

      charRefs.current.forEach((span, index) => {
        if (!span) return;
        const charAbsoluteX = currentContainerX + (charOffsetsRef.current[index] || 0);
        
        let targetScale = 1.0;
        let targetSpacing = 5;

        for (const zone of PROJECTION_ZONES) {
          if (charAbsoluteX >= zone.start && charAbsoluteX <= zone.end) {
            targetScale = zone.scale;
            targetSpacing = zone.spacing;
            break;
          }
        }

        const currentScale = charScalesRef.current[index];
        const newScale = currentScale + (targetScale - currentScale) * 0.1;
        charScalesRef.current[index] = newScale;

        const currentSpacing = charSpacingsRef.current[index];
        const newSpacing = currentSpacing + (targetSpacing - currentSpacing) * 0.2;
        charSpacingsRef.current[index] = newSpacing;
        
        span.style.transform = `scale(${newScale})`;
        span.style.marginRight = `${newSpacing}px`;
      });

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, [id, speed, onComplete, text]);

  return (
    <div
      ref={containerRef}
      className="moving-text-container"
      style={{ top: `${top}%`, left: 0, willChange: 'transform' }}
    >
      {text.split('').map((char, index) => (
        <span
          key={index}
          ref={(el) => { charRefs.current[index] = el; }}
          style={{ display: 'inline-block', willChange: 'transform, margin', marginRight: '5px' }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
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

  return (
    <div className="App">
      {/* ゾーン表示（本番では消す） */}
      {PROJECTION_ZONES.map((zone, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${zone.start}px`,
          width: `${zone.end - zone.start}px`,
          height: '100%',
          backgroundColor: 'rgba(255, 0, 0, 0.2)',
          borderLeft: '1px solid red',
          borderRight: '1px solid red',
          zIndex: 0,
          pointerEvents: 'none'
        }} />
      ))}

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
          className="special-text"
          style={
            {
              ['--top' as unknown as string]: `${msg.yN * 100}%`,
              ['--hue' as unknown as string]: String(msg.hue),
            } as CSSProperties
          }
        >
          {msg.text}
        </div>
      ))}
    </div>
  );
}

export default App;
