# VOICE2LIGHT

VOICEBORN の世界観をベースに、声を文字と光として空間に漂わせる Vite アプリです。  
この段階ではネットワーク入力は未接続で、固定サンプル文を感情解析して発光表示します。

## Features

- Canvas 2D による文字粒子の発光レンダリング
- OpenAI Responses API をブラウザから直接呼び出す感情判定
- 手認識（MediaPipe HandLandmarker）による押し・掴み・引っ張り
- フルスクリーン表示（`KeyU` で操作パネル表示）

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Environment Variables

- `VITE_OPENAI_API_KEY`: OpenAI APIキー（未設定時はローカル推定）
- `VITE_OPENAI_EMOTION_MODEL`: 感情判定モデル（既定: `gpt-4.1-mini`）
- `VITE_TARGET_FPS`: 描画/推論ターゲットFPS（既定: `30`）
- `VITE_CAMERA_WIDTH`: カメラ幅（既定: `1280`）
- `VITE_CAMERA_HEIGHT`: カメラ高さ（既定: `720`）
- `VITE_UI_TOGGLE_KEY`: 操作UI表示キー（既定: `KeyU`）

## Notes

- APIキーをブラウザで直接利用するため、展示専用ネットワーク運用を前提にしてください。
- MediaPipe WASM は `public/wasm` から配信します（CDN依存を避けています）。
- 初期状態では UI を非表示にしています。`KeyU` で表示できます。
- 将来追加するネットワーク音声入力の処理は、今回の実装では含めていません。
