# VOICE2SOUND (Receiver Node)

Scene Bus の受信確認ノードです。現段階では音響生成ではなく、
受信イベントの可視化とテスト送信を行います。

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
