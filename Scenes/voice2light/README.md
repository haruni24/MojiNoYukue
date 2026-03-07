# VOICE2LIGHT

VOICEBORN の世界観をベースに、声を文字と光として空間に漂わせる Vite アプリです。  
この段階ではネットワーク入力は未接続で、固定サンプル文を感情解析して発光表示します。

## Features

- Canvas 2D による文字粒子の発光レンダリング
- OpenAI Responses API をブラウザから直接呼び出す感情判定
- 文字列単位の浮遊表現（1文字分解しない）
- 現在ビルドは手認識/手描画を強制OFF（負荷調整のため）
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
- `VITE_TARGET_FPS`: 描画/推論ターゲットFPS（既定: `24`）
- `VITE_CAMERA_WIDTH`: カメラ幅（既定: `960`）
- `VITE_CAMERA_HEIGHT`: カメラ高さ（既定: `540`）
- `VITE_UI_TOGGLE_KEY`: 操作UI表示キー（既定: `KeyU`）
- `VITE_ENABLE_SILHOUETTE`: シルエット解析の有効化（既定: `false`）

## Notes

- APIキーをブラウザで直接利用するため、展示専用ネットワーク運用を前提にしてください。
- MediaPipe WASM は `public/wasm` から配信します（CDN依存を避けています）。
- パフォーマンス優先のため、手追跡/手描画は現在コード側で無効化しています。
- 初期状態では UI を非表示にしています。`KeyU` で表示できます。
- 将来追加するネットワーク音声入力の処理は、今回の実装では含めていません。
