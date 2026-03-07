import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import Database from 'better-sqlite3'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.SCENE_BUS_PORT ?? 8787)
const HOST = process.env.SCENE_BUS_HOST ?? '0.0.0.0'
const TOKEN = String(process.env.SCENE_BUS_TOKEN ?? '').trim()
const DB_PATH = process.env.SCENE_BUS_DB_PATH ?? './data/scene-bus.sqlite'
const MAX_LOG = Number(process.env.SCENE_BUS_MAX_LOG ?? 10_000)
const RELIABLE_KINDS = new Set(['control.command'])
const RESEND_INTERVAL_MS = 1500
const MAX_RETRY = 3

/** @type {Array<any>} */
const eventLog = []
let seqCounter = 0

const db = new Database(DB_PATH)

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  server_ts INTEGER NOT NULL,
  client_ts INTEGER,
  source_node_id TEXT NOT NULL,
  source_app TEXT NOT NULL,
  room TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_json TEXT,
  priority TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  latency_ms INTEGER,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_server_ts ON events(server_ts);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_node_id);
`)

const getLatestSeqStmt = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events')
const insertEventStmt = db.prepare(`
  INSERT INTO events (
    seq, event_id, trace_id, server_ts, client_ts, source_node_id, source_app,
    room, kind, scope, target_json, priority, payload_json, latency_ms, raw_json
  ) VALUES (
    @seq, @eventId, @traceId, @serverTs, @clientTs, @sourceNodeId, @sourceApp,
    @room, @kind, @scope, @targetJson, @priority, @payloadJson, @latencyMs, @rawJson
  )
`)
const replayStmt = db.prepare(
  'SELECT raw_json FROM events WHERE seq > ? AND room = ? ORDER BY seq ASC LIMIT ?'
)

seqCounter = Number(getLatestSeqStmt.get().max_seq)

const clients = new Map()
const nodeIdToSocket = new Map()

const server = createServer((req, res) => {
  const rawUrl = req.url ?? '/'
  const url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    const body = JSON.stringify({
      status: 'ok',
      now: Date.now(),
      clients: clients.size,
      latestSeq: seqCounter,
    })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(body)
    return
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const source = url.searchParams.get('source')?.trim() ?? ''
    const kind = url.searchParams.get('kind')?.trim() ?? ''
    const scope = url.searchParams.get('scope')?.trim() ?? ''
    const limit = Math.max(10, Math.min(500, Number(url.searchParams.get('limit') ?? 200)))

    let filtered = eventLog
    if (source) {
      filtered = filtered.filter((item) => item.sourceNodeId === source)
    }
    if (kind) {
      filtered = filtered.filter((item) => item.kind === kind)
    }
    if (scope) {
      filtered = filtered.filter((item) => item.scope === scope)
    }

    const payload = {
      latestSeq: seqCounter,
      clients: Array.from(clients.values()).map((meta) => ({
        nodeId: meta.nodeId,
        app: meta.sourceApp,
        room: meta.room,
        groups: Array.from(meta.groups),
        connectedAt: meta.connectedAt,
        lastHeartbeatAt: meta.lastHeartbeatAt,
      })),
      events: filtered.slice(-limit),
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(payload))
    return
  }

  if (req.method === 'GET' && url.pathname === '/monitor') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(renderMonitorHtml())
    return
  }

  res.statusCode = 404
  res.end('Not Found')
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const rawUrl = req.url ?? '/'
  const url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

wss.on('connection', (ws, req) => {
  const clientState = {
    joined: false,
    nodeId: '',
    sourceApp: '',
    room: 'default',
    groups: new Set(),
    connectedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    pendingBySeq: new Map(),
  }

  clients.set(ws, clientState)

  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      sendServerError(ws, 'invalid_json', 'JSON parse failed')
      return
    }

    if (!message || typeof message !== 'object') {
      sendServerError(ws, 'invalid_payload', 'message must be object')
      return
    }

    if (message.type === 'join') {
      const err = validateJoinMessage(message, req)
      if (err) {
        sendServerError(ws, 'join_failed', err)
        ws.close(4001, err)
        return
      }

      const nodeId = message.nodeId.trim()
      const existing = nodeIdToSocket.get(nodeId)
      if (existing && existing !== ws) {
        sendServerError(ws, 'duplicate_node_id', `nodeId already in use: ${nodeId}`)
        ws.close(4002, 'duplicate_node_id')
        return
      }

      clientState.joined = true
      clientState.nodeId = nodeId
      clientState.sourceApp = message.sourceApp.trim()
      clientState.room = (message.room ?? 'default').trim() || 'default'
      clientState.groups = new Set(Array.isArray(message.groups) ? message.groups.filter((v) => typeof v === 'string') : [])
      clientState.lastHeartbeatAt = Date.now()
      nodeIdToSocket.set(nodeId, ws)

      sendJson(ws, {
        type: 'joined',
        nodeId,
        room: clientState.room,
        serverTs: Date.now(),
        latestSeq: seqCounter,
      })

      const replayFrom = Number(message.lastSeq ?? 0)
      if (Number.isFinite(replayFrom) && replayFrom >= 0) {
        const rows = replayStmt.all(replayFrom, clientState.room, 500)
        for (const row of rows) {
          sendJson(ws, {
            type: 'event',
            replay: true,
            envelope: JSON.parse(row.raw_json),
          })
        }
      }

      return
    }

    if (!clientState.joined) {
      sendServerError(ws, 'not_joined', 'join first')
      return
    }

    if (message.type === 'heartbeat') {
      clientState.lastHeartbeatAt = Date.now()
      return
    }

    if (message.type === 'ack') {
      const seq = Number(message.seq)
      if (Number.isFinite(seq)) {
        clearPendingAck(clientState, seq)
      }
      return
    }

    if (message.type === 'publish') {
      const validationError = validateEnvelope(message.envelope)
      if (validationError) {
        sendServerError(ws, 'invalid_envelope', validationError)
        return
      }

      const envelope = normalizeEnvelope(message.envelope, clientState)
      persistAndLogEvent(envelope)
      dispatchEnvelope(envelope)
      return
    }

    sendServerError(ws, 'unsupported_type', `unknown type: ${String(message.type)}`)
  })

  ws.on('close', () => {
    clients.delete(ws)
    if (clientState.nodeId) {
      const linked = nodeIdToSocket.get(clientState.nodeId)
      if (linked === ws) {
        nodeIdToSocket.delete(clientState.nodeId)
      }
    }
  })

  ws.on('error', () => {
    // noop
  })
})

const resendTimer = setInterval(() => {
  const now = Date.now()
  for (const [ws, state] of clients) {
    if (ws.readyState !== ws.OPEN || !state.joined) {
      continue
    }

    for (const [seq, pending] of state.pendingBySeq) {
      if (pending.acked) {
        state.pendingBySeq.delete(seq)
        continue
      }
      if (pending.retries >= MAX_RETRY) {
        state.pendingBySeq.delete(seq)
        continue
      }
      if (now - pending.lastSentAt < RESEND_INTERVAL_MS) {
        continue
      }

      sendJson(ws, {
        type: 'event',
        replay: false,
        envelope: pending.envelope,
      })
      pending.lastSentAt = now
      pending.retries += 1
    }
  }
}, 400)

resendTimer.unref()

server.listen(PORT, HOST, () => {
  console.info(`[scene-bus] listening on http://${HOST}:${PORT}`)
  console.info('[scene-bus] ws endpoint:', `ws://${HOST}:${PORT}/ws`)
})

function validateJoinMessage(message, req) {
  const headerAuth = req.headers.authorization ?? ''
  const authToken = String(message.authToken ?? '')

  if (TOKEN) {
    const validHeader = headerAuth === `Bearer ${TOKEN}`
    const validBody = authToken === TOKEN
    if (!validHeader && !validBody) {
      return 'auth failed'
    }
  }

  if (typeof message.nodeId !== 'string' || message.nodeId.trim().length < 3) {
    return 'nodeId is required (min 3 chars)'
  }
  if (typeof message.sourceApp !== 'string' || message.sourceApp.trim().length < 2) {
    return 'sourceApp is required'
  }

  return null
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return 'envelope must be object'
  }

  const requiredString = ['schemaVersion', 'traceId', 'sourceNodeId', 'sourceApp', 'room', 'kind', 'scope', 'priority']
  for (const key of requiredString) {
    if (typeof envelope[key] !== 'string' || envelope[key].trim().length === 0) {
      return `${key} is required`
    }
  }

  if (!['broadcast', 'group', 'direct'].includes(envelope.scope)) {
    return 'scope must be broadcast/group/direct'
  }

  if (typeof envelope.payload === 'undefined') {
    return 'payload is required'
  }

  if (envelope.scope === 'group') {
    if (!envelope.target || typeof envelope.target.groupId !== 'string' || !envelope.target.groupId.trim()) {
      return 'target.groupId is required for group scope'
    }
  }

  if (envelope.scope === 'direct') {
    if (!envelope.target || typeof envelope.target.nodeId !== 'string' || !envelope.target.nodeId.trim()) {
      return 'target.nodeId is required for direct scope'
    }
  }

  return null
}

function normalizeEnvelope(raw, clientState) {
  const serverTs = Date.now()
  seqCounter += 1

  const clientTs = Number(raw.clientTs)
  const safeClientTs = Number.isFinite(clientTs) ? clientTs : serverTs
  const latencyMs = Math.max(0, serverTs - safeClientTs)

  return {
    schemaVersion: '1.0',
    eventId: typeof raw.eventId === 'string' && raw.eventId ? raw.eventId : randomUUID(),
    traceId: raw.traceId,
    seq: seqCounter,
    serverTs,
    clientTs: safeClientTs,
    sourceNodeId: clientState.nodeId,
    sourceApp: clientState.sourceApp,
    room: clientState.room,
    kind: raw.kind,
    scope: raw.scope,
    target: raw.target ?? null,
    priority: raw.priority,
    payload: raw.payload,
    latencyMs,
  }
}

function persistAndLogEvent(envelope) {
  const rawJson = JSON.stringify(envelope)
  const payloadJson = JSON.stringify(envelope.payload ?? null)
  const targetJson = JSON.stringify(envelope.target ?? null)

  insertEventStmt.run({
    seq: envelope.seq,
    eventId: envelope.eventId,
    traceId: envelope.traceId,
    serverTs: envelope.serverTs,
    clientTs: envelope.clientTs,
    sourceNodeId: envelope.sourceNodeId,
    sourceApp: envelope.sourceApp,
    room: envelope.room,
    kind: envelope.kind,
    scope: envelope.scope,
    targetJson,
    priority: envelope.priority,
    payloadJson,
    latencyMs: envelope.latencyMs,
    rawJson,
  })

  const summary = summarizePayload(envelope.payload)
  eventLog.push({
    seq: envelope.seq,
    serverTs: envelope.serverTs,
    sourceNodeId: envelope.sourceNodeId,
    sourceApp: envelope.sourceApp,
    room: envelope.room,
    kind: envelope.kind,
    scope: envelope.scope,
    target: envelope.target,
    priority: envelope.priority,
    latencyMs: envelope.latencyMs,
    payloadSummary: summary,
  })

  if (eventLog.length > MAX_LOG) {
    eventLog.splice(0, eventLog.length - MAX_LOG)
  }
}

function dispatchEnvelope(envelope) {
  for (const [ws, state] of clients) {
    if (!state.joined || state.room !== envelope.room || ws.readyState !== ws.OPEN) {
      continue
    }

    if (!isTargetMatched(state, envelope)) {
      continue
    }

    sendJson(ws, {
      type: 'event',
      replay: false,
      envelope,
    })

    if (isReliableEvent(envelope)) {
      state.pendingBySeq.set(envelope.seq, {
        envelope,
        retries: 0,
        lastSentAt: Date.now(),
        acked: false,
      })
    }
  }
}

function isTargetMatched(state, envelope) {
  if (envelope.scope === 'broadcast') {
    return true
  }

  if (envelope.scope === 'group') {
    const groupId = envelope.target?.groupId
    return typeof groupId === 'string' && state.groups.has(groupId)
  }

  if (envelope.scope === 'direct') {
    const nodeId = envelope.target?.nodeId
    return typeof nodeId === 'string' && nodeId === state.nodeId
  }

  return false
}

function isReliableEvent(envelope) {
  if (RELIABLE_KINDS.has(envelope.kind)) {
    return true
  }
  return envelope.kind === 'scene.cue' && envelope.priority === 'reliable'
}

function clearPendingAck(state, seq) {
  const pending = state.pendingBySeq.get(seq)
  if (!pending) {
    return
  }
  pending.acked = true
  state.pendingBySeq.delete(seq)
}

function sendServerError(ws, code, message) {
  sendJson(ws, {
    type: 'server.error',
    code,
    message,
    serverTs: Date.now(),
  })
}

function sendJson(ws, data) {
  if (ws.readyState !== ws.OPEN) {
    return
  }
  ws.send(JSON.stringify(data))
}

function summarizePayload(payload) {
  if (payload == null) {
    return 'null'
  }

  if (typeof payload === 'string') {
    return payload.slice(0, 120)
  }

  if (typeof payload !== 'object') {
    return String(payload)
  }

  const entries = Object.entries(payload)
  if (entries.length === 0) {
    return '{}'
  }

  const summary = entries
    .slice(0, 4)
    .map(([k, v]) => `${k}:${typeof v === 'string' ? v.slice(0, 32) : JSON.stringify(v).slice(0, 32)}`)
    .join(', ')

  return summary
}

function renderMonitorHtml() {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Scene Bus Monitor</title>
    <style>
      :root {
        --bg: #0f1219;
        --panel: #171b23;
        --line: #2a3140;
        --text: #e7edf7;
        --sub: #90a1bc;
        --accent: #4dc3ff;
      }
      body { margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); color: var(--text); }
      .wrap { padding: 16px; display: grid; gap: 12px; }
      .panel { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 12px; }
      h1,h2 { margin: 0 0 8px; font-size: 14px; color: var(--accent); }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      input, select { background:#10151f; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
      table { width:100%; border-collapse: collapse; font-size: 12px; }
      th,td { border-bottom: 1px solid var(--line); padding: 6px; text-align: left; vertical-align: top; }
      .sub { color: var(--sub); }
      .tag { display:inline-block; padding:2px 6px; border:1px solid var(--line); border-radius: 99px; font-size:11px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <h1>Scene Bus Monitor</h1>
        <div class="row">
          <label>source <input id="source" /></label>
          <label>kind <input id="kind" /></label>
          <label>scope
            <select id="scope">
              <option value="">all</option>
              <option value="broadcast">broadcast</option>
              <option value="group">group</option>
              <option value="direct">direct</option>
            </select>
          </label>
          <button id="reload">reload</button>
          <span id="meta" class="sub"></span>
        </div>
      </div>

      <div class="panel">
        <h2>接続ノード</h2>
        <div id="clients"></div>
      </div>

      <div class="panel">
        <h2>ノード関係ビュー（送信->宛先）</h2>
        <div id="edges"></div>
      </div>

      <div class="panel">
        <h2>時系列イベント</h2>
        <table>
          <thead>
            <tr>
              <th>seq</th><th>time</th><th>source</th><th>scope</th><th>target</th><th>kind</th><th>latencyMs</th><th>payloadSummary</th>
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>

    <script>
      const tbody = document.getElementById('tbody')
      const clients = document.getElementById('clients')
      const edges = document.getElementById('edges')
      const meta = document.getElementById('meta')
      const source = document.getElementById('source')
      const kind = document.getElementById('kind')
      const scope = document.getElementById('scope')
      const reload = document.getElementById('reload')

      function targetLabel(event) {
        if (event.scope === 'broadcast') return 'all'
        if (event.scope === 'group') return event.target?.groupId || '-'
        if (event.scope === 'direct') return event.target?.nodeId || '-'
        return '-'
      }

      async function load() {
        const q = new URLSearchParams({
          source: source.value,
          kind: kind.value,
          scope: scope.value,
          limit: '300',
        })
        const res = await fetch('/events?' + q.toString())
        const data = await res.json()

        meta.textContent =
          'latestSeq=' + data.latestSeq + ' clients=' + data.clients.length + ' events=' + data.events.length

        clients.innerHTML = data.clients
          .map((c) => '<span class=\"tag\">' + c.nodeId + ' (' + c.app + ') room=' + c.room + '</span>')
          .join(' ')

        const edgeCount = new Map()
        for (const e of data.events) {
          const to = targetLabel(e)
          const key = e.sourceNodeId + ' -> ' + to
          edgeCount.set(key, (edgeCount.get(key) || 0) + 1)
        }

        edges.innerHTML = Array.from(edgeCount.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 24)
          .map(([k, v]) => '<div>' + k + ' <span class=\"sub\">(' + v + ')</span></div>')
          .join('')

        tbody.innerHTML = data.events
          .map((e) => {
            const date = new Date(e.serverTs).toLocaleTimeString('ja-JP', { hour12: false })
            return '<tr>' +
              '<td>' + e.seq + '</td>' +
              '<td>' + date + '</td>' +
              '<td>' + e.sourceNodeId + '</td>' +
              '<td>' + e.scope + '</td>' +
              '<td>' + targetLabel(e) + '</td>' +
              '<td>' + e.kind + '</td>' +
              '<td>' + e.latencyMs + '</td>' +
              '<td>' + String(e.payloadSummary ?? '').replace(/[<>&]/g, '') + '</td>' +
              '</tr>'
          })
          .join('')
      }

      reload.addEventListener('click', load)
      setInterval(load, 1200)
      load()
    </script>
  </body>
</html>`
}
