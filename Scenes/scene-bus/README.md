# scene-bus

展示LAN向けの中央イベントバスサーバです。

## 機能

- WebSocket イベント中継（`/ws`）
- ヘルスチェック（`/health`）
- 監視UI（`/monitor`）
- イベントログ保持
  - メモリリング（最大 `SCENE_BUS_MAX_LOG` 件）
  - SQLite 永続化（`events` テーブル）
- ルーティング
  - `scope=broadcast`
  - `scope=group` (`target.groupId`)
  - `scope=direct` (`target.nodeId`)
- 重要イベントの簡易 ACK/再送
  - `control.command`
  - `scene.cue` かつ `priority=reliable`

## セットアップ

```bash
cp .env.example .env
npm install
npm start
```

既定では `http://0.0.0.0:8787` で待受します。

## 環境変数

- `SCENE_BUS_PORT` 既定 `8787`
- `SCENE_BUS_HOST` 既定 `0.0.0.0`
- `SCENE_BUS_TOKEN` 空で認証無効、設定時は join 時に必須
- `SCENE_BUS_DB_PATH` SQLite ファイルパス
- `SCENE_BUS_MAX_LOG` メモリ保持件数

## WS プロトコル（要点）

### 1) join

```json
{
  "type": "join",
  "authToken": "change-me",
  "nodeId": "voiceborn-main-01",
  "sourceApp": "voiceborn",
  "room": "default",
  "groups": ["main"],
  "lastSeq": 120
}
```

### 2) publish

```json
{
  "type": "publish",
  "envelope": {
    "schemaVersion": "1.0",
    "eventId": "uuid",
    "traceId": "uuid",
    "clientTs": 1710000000000,
    "sourceNodeId": "voiceborn-main-01",
    "sourceApp": "voiceborn",
    "room": "default",
    "kind": "transcript.text",
    "scope": "broadcast",
    "target": null,
    "priority": "realtime",
    "payload": { "text": "こんにちは" }
  }
}
```

> `seq/serverTs/sourceNodeId/sourceApp/room` はサーバ側で正規化されます。

### 3) ack

```json
{ "type": "ack", "seq": 1234 }
```

### 4) heartbeat

```json
{ "type": "heartbeat", "clientTs": 1710000000000 }
```
