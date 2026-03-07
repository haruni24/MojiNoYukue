# Scene Bus 運用手順（展示LAN）

## 1. 起動順

1. `scene-bus` を起動
2. `voiceborn` を起動（入力ハブ）
3. `voice2light` を起動（可視化ノード）
4. `voice2sound` / `ending` を起動（監視・制御ノード）

## 2. サーバ起動

```bash
cd scene-bus
cp .env.example .env
npm install
npm start
```

確認:

- `http://<host>:8787/health`
- `http://<host>:8787/monitor`

## 3. 各アプリ設定

各フォルダで `.env.example` を `.env` にコピーし、以下を揃える:

- `VITE_SCENE_BUS_ENABLED=true`
- `VITE_SCENE_BUS_URL=ws://<host>:8787/ws`
- `VITE_SCENE_BUS_TOKEN`（サーバと一致）
- `VITE_SCENE_NODE_ID`（重複禁止）
- `VITE_SCENE_ROOM`（同じ空間は同一名）
- `VITE_SCENE_GROUPS`（必要なグループ）

## 4. 最低限の疎通確認

1. `voiceborn` で発話する
2. `voice2light` に文字が流入することを確認
3. `ending` から `BROADCAST STOP` を押し、`voiceborn/voice2light` が停止することを確認
4. `/monitor` で `source/scope/target/kind` が追えることを確認

## 5. 障害時

- ノード切断: 自動再接続（lastSeq から再受信）
- サーバ再起動: 各ノードは再接続で復帰
- nodeId 重複: 接続拒否。重複しない `VITE_SCENE_NODE_ID` を再設定
