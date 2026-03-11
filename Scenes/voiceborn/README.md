# VOICEBORN

複数参加者の身体と声を、リアルタイムに「文字粒子」として空間へ物質化するメディアアート作品。

## Stack

- React 19 + TypeScript + Vite
- MediaPipe Tasks Vision（人体セグメンテーション + 骨格推定）
- OpenAI Audio Transcription API（ブラウザから直接呼び出し）
- Canvas 2D リアルタイム描画

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Environment Variables

- `VITE_OPENAI_API_KEY`: OpenAI APIキー
- `VITE_OPENAI_STT_MODEL`: 文字起こしモデル（既定: `gpt-4o-mini-transcribe`）
- `VITE_TARGET_FPS`: 描画/推論ターゲットFPS（既定: `30`）
- `VITE_CAMERA_WIDTH`: カメラ幅（既定: `1920`）
- `VITE_CAMERA_HEIGHT`: カメラ高さ（既定: `1080`）
- `VITE_SCENE_BUS_ENABLED`: Scene Bus 接続有効化（既定: `false`）
- `VITE_SCENE_BUS_URL`: 例 `ws://127.0.0.1:8787/ws`
- `VITE_SCENE_BUS_TOKEN`: 認証トークン（任意）
- `VITE_SCENE_NODE_ID`: 一意ノードID（例 `voiceborn-main-01`）
- `VITE_SCENE_ROOM`: ルーム名（既定: `default`）
- `VITE_SCENE_GROUPS`: カンマ区切りグループ（例 `main,stageA`）

## Notes

- APIキーをブラウザで直接利用するため、展示専用ネットワーク・運用を前提にしてください。
- カメラとマイク権限が必要です。
- STT通信失敗時も映像演出は継続し、文字生成のみ抑制されます。
- Scene Bus 有効時、`transcript.text` / `metrics.runtime` / `scene.cue` を publish し、`control.command` / `scene.cue` を subscribe します。
- 同一PCで `voice2light` と連携する場合は、同一 `VITE_SCENE_BUS_URL` を指定すると `transcript.text` がそのまま `voice2light` 側へ流れます。
