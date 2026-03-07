import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { SceneBusClient, type EventEnvelope } from './net/sceneBus'

const BUS_ENABLED = String(import.meta.env.VITE_SCENE_BUS_ENABLED ?? 'false').toLowerCase() === 'true'
const BUS_URL = import.meta.env.VITE_SCENE_BUS_URL ?? 'ws://127.0.0.1:8787/ws'
const BUS_TOKEN = import.meta.env.VITE_SCENE_BUS_TOKEN ?? ''
const BUS_NODE_ID = import.meta.env.VITE_SCENE_NODE_ID ?? `voice2sound-${location.hostname}`
const BUS_ROOM = import.meta.env.VITE_SCENE_ROOM ?? 'default'
const BUS_GROUPS = String(import.meta.env.VITE_SCENE_GROUPS ?? 'main')
  .split(',')
  .map((v: string) => v.trim())
  .filter((v: string) => v.length > 0)

type EventRow = {
  seq: number
  kind: string
  scope: string
  sourceNodeId: string
  target: string
  at: number
  summary: string
}

function App() {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<EventRow[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const clientRef = useRef<SceneBusClient | null>(null)

  const enabledLabel = useMemo(() => (BUS_ENABLED ? '有効' : '無効'), [])

  useEffect(() => {
    const client = new SceneBusClient({
      enabled: BUS_ENABLED,
      wsUrl: BUS_URL,
      authToken: BUS_TOKEN,
      nodeId: BUS_NODE_ID,
      sourceApp: 'voice2sound',
      room: BUS_ROOM,
      groups: BUS_GROUPS,
    })

    const unsubEvent = client.onEvent((envelope) => {
      setConnected(client.isConnected())
      setEvents((prev) => {
        const next: EventRow = {
          seq: envelope.seq,
          kind: envelope.kind,
          scope: envelope.scope,
          sourceNodeId: envelope.sourceNodeId,
          target: envelope.scope === 'broadcast' ? 'all' : (envelope.target?.nodeId ?? envelope.target?.groupId ?? '-'),
          at: envelope.serverTs,
          summary: summarizePayload(envelope),
        }
        return [...prev, next].slice(-120)
      })
    })

    const unsubError = client.onError((message) => {
      setErrorMessage(message)
      setConnected(client.isConnected())
    })

    client.start()
    clientRef.current = client
    const timer = window.setInterval(() => {
      setConnected(client.isConnected())
    }, 1000)

    return () => {
      window.clearInterval(timer)
      unsubEvent()
      unsubError()
      client.stop()
      clientRef.current = null
    }
  }, [])

  return (
    <main className="monitor-app">
      <header>
        <p className="label">VOICE2SOUND</p>
        <h1>Scene Bus Receiver</h1>
        <p>
          BUS: <strong>{enabledLabel}</strong> / 接続: <strong>{connected ? 'ONLINE' : 'OFFLINE'}</strong>
        </p>
        {errorMessage && <p className="error">{errorMessage}</p>}
      </header>

      <section>
        <div className="table-header">
          <span>最新受信イベント</span>
          <button
            type="button"
            onClick={() => {
              clientRef.current?.publish(
                'scene.cue',
                {
                  cue: 'voice2sound-ping',
                  note: 'receiver test event',
                },
                { priority: 'reliable' },
              )
            }}
            disabled={!connected}
          >
            TEST SEND
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>seq</th>
              <th>time</th>
              <th>source</th>
              <th>kind</th>
              <th>scope</th>
              <th>target</th>
              <th>payload</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={`${event.seq}-${event.kind}`}>
                <td>{event.seq}</td>
                <td>{new Date(event.at).toLocaleTimeString('ja-JP', { hour12: false })}</td>
                <td>{event.sourceNodeId}</td>
                <td>{event.kind}</td>
                <td>{event.scope}</td>
                <td>{event.target}</td>
                <td>{event.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}

function summarizePayload(envelope: EventEnvelope): string {
  const payload = envelope.payload
  if (payload == null) {
    return 'null'
  }
  if (typeof payload === 'string') {
    return payload.slice(0, 72)
  }
  if (typeof payload !== 'object') {
    return String(payload)
  }

  return Object.entries(payload as Record<string, unknown>)
    .slice(0, 3)
    .map(([k, v]) => `${k}:${String(v).slice(0, 20)}`)
    .join(', ')
}

export default App
