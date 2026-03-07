# ENDING (Cue Console)

終幕演出向けのコントロール兼監視ノードです。

- `scene.cue` と `transcript.text` を受信表示
- `control.command` を broadcast 送信

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Environment Variables

- `VITE_SCENE_BUS_ENABLED` Scene Bus 接続有効化
- `VITE_SCENE_BUS_URL` 例: `ws://127.0.0.1:8787/ws`
- `VITE_SCENE_BUS_TOKEN` 認証トークン（任意）
- `VITE_SCENE_NODE_ID` ノードID（一意）
- `VITE_SCENE_ROOM` ルーム名
- `VITE_SCENE_GROUPS` カンマ区切りグループ名
