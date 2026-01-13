import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import './App.css';

// ■ 1. ゾーン定義に spacing (px単位) を追加
interface Zone {
  start: number;
  end: number;
  scale: number;
  spacing: number; // 追加：このゾーンでの文字間隔（px）
}

const PROJECTION_ZONES: Zone[] = [
  // 300px〜600pxの間は、2倍の大きさになり、文字間隔を 30px 広げる
  // 800px〜1000pxの間は、半分になり、文字間隔を 0px にする（標準）
  { start: 480, end: 800, scale: 0.95, spacing: 0 },
];

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

  // ■ 各文字ごとの「現在のスケール」と「現在の余白」を記憶
  const charScalesRef = useRef<number[]>(new Array(text.length).fill(1));
  const charSpacingsRef = useRef<number[]>(new Array(text.length).fill(0)); // 追加

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

        // ※注意: marginが変わると実際の絶対座標はずれますが、
        // 簡易的な判定のため「初期状態のオフセット」を基準に判定します
        const charAbsoluteX = currentContainerX + (charOffsetsRef.current[index] || 0);
        
        // デフォルト値
        let targetScale = 1.0;
        let targetSpacing = 5; // ■ 通常時の文字間隔 (px)

        for (const zone of PROJECTION_ZONES) {
          if (charAbsoluteX >= zone.start && charAbsoluteX <= zone.end) {
            targetScale = zone.scale;
            targetSpacing = zone.spacing; // ゾーン内の間隔を適用
            break;
          }
        }

        // 1. スケールの滑らか変化 (Lerp)
        const currentScale = charScalesRef.current[index];
        const newScale = currentScale + (targetScale - currentScale) * 0.1;
        charScalesRef.current[index] = newScale;

        // 2. 余白の滑らか変化 (Lerp)
        const currentSpacing = charSpacingsRef.current[index];
        // 余白の変化は少し早め（0.2）にするとキビキビ動きます
        const newSpacing = currentSpacing + (targetSpacing - currentSpacing) * 0.2;
        charSpacingsRef.current[index] = newSpacing;
        
        // ■ DOMに適用
        // scaleで大きさを、marginRightで横の間隔を操作
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
      style={{
        top: `${top}%`,
        left: 0,
        willChange: 'transform',
      }}
    >
      {text.split('').map((char, index) => (
        <span
          key={index}
          ref={(el) => { charRefs.current[index] = el; }}
          style={{ 
            display: 'inline-block',
            willChange: 'transform, margin', // ブラウザにmarginも変わるよと伝える
            marginRight: '5px', // 初期値
            // transformOrigin: 'bottom left' // 左下基準で大きくしたい場合はコメントアウトを外す
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </div>
  );
};

// --- 以下、Appコンポーネントは変更なし（前回と同じ） ---
// ただし、PROJECTION_ZONESの定義が変わっているので注意してください
interface MessageData {
  id: number;
  text: string;
  top: number;
  speed: number;
}

function App() {
  const [messages, setMessages] = useState<MessageData[]>([]);

  const handleRemove = (idToRemove: number) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== idToRemove));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        const newMessage: MessageData = {
          id: Date.now(),
          text: "あいうえおかきくけこ",
          top: Math.random() * 80 + 10,
          speed: Math.random() * 4 + 2,
        };
        setMessages((prev) => [...prev, newMessage]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="App">
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
          pointerEvents: 'none',
          color: 'red',
          padding: '5px'
        }}>
          Gap: {zone.spacing}px
        </div>
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
    </div>
  );
}

export default App;