import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { SceneBusClient, type EventEnvelope } from './net/sceneBus'

const BUS_ENABLED = String(import.meta.env.VITE_SCENE_BUS_ENABLED ?? 'false').toLowerCase() === 'true'
const BUS_URL = import.meta.env.VITE_SCENE_BUS_URL ?? 'ws://127.0.0.1:8787/ws'
const BUS_TOKEN = import.meta.env.VITE_SCENE_BUS_TOKEN ?? ''
const BUS_NODE_ID = import.meta.env.VITE_SCENE_NODE_ID ?? `ending-${location.hostname}`
const BUS_ROOM = import.meta.env.VITE_SCENE_ROOM ?? 'default'
const BUS_GROUPS = String(import.meta.env.VITE_SCENE_GROUPS ?? 'main')
  .split(',')
  .map((v: string) => v.trim())
  .filter((v: string) => v.length > 0)

type CueRow = {
  seq: number
  sourceNodeId: string
  cue: string
  at: number
}

function App() {
  const [connected, setConnected] = useState(false)
  const [cues, setCues] = useState<CueRow[]>([])
  const [latestTranscript, setLatestTranscript] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const clientRef = useRef<SceneBusClient | null>(null)

  const enabledLabel = useMemo(() => (BUS_ENABLED ? '有効' : '無効'), [])

  useEffect(() => {
    const client = new SceneBusClient({
      enabled: BUS_ENABLED,
      wsUrl: BUS_URL,
      authToken: BUS_TOKEN,
      nodeId: BUS_NODE_ID,
      sourceApp: 'ending',
      room: BUS_ROOM,
      groups: BUS_GROUPS,
    })

    const unsubEvent = client.onEvent((envelope) => {
      setConnected(client.isConnected())
      handleEnvelope(envelope)
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

  const sendControl = (command: 'start' | 'stop' | 'reload'): void => {
    clientRef.current?.publish(
      'control.command',
      {
        command,
        from: BUS_NODE_ID,
      },
      {
        priority: 'reliable',
      },
    )
  }

  const lastCue = cues[cues.length - 1]

  return (
    <main className="ending-app">
      <header>
        <p className="label">ENDING CONTROL</p>
        <h1>Scene Bus Cue Console</h1>
        <p>
          BUS: <strong>{enabledLabel}</strong> / 接続: <strong>{connected ? 'ONLINE' : 'OFFLINE'}</strong>
        </p>
        {errorMessage && <p className="error">{errorMessage}</p>}
      </header>

      <section className="hero">
        <p className="hero-label">LAST CUE</p>
        <h2>{lastCue ? lastCue.cue : 'no cue yet'}</h2>
        <p>
          {lastCue
            ? `${lastCue.sourceNodeId} @ ${new Date(lastCue.at).toLocaleTimeString('ja-JP', { hour12: false })}`
            : '待機中'}
        </p>
      </section>

      <section className="controls">
        <button type="button" onClick={() => sendControl('start')} disabled={!connected}>
          BROADCAST START
        </button>
        <button type="button" onClick={() => sendControl('stop')} disabled={!connected}>
          BROADCAST STOP
        </button>
        <button type="button" onClick={() => sendControl('reload')} disabled={!connected}>
          BROADCAST RELOAD
        </button>
      </section>

      <section className="transcript">
        <p className="hero-label">LAST TRANSCRIPT</p>
        <p>{latestTranscript || '未受信'}</p>
      </section>

      <section>
        <h3>受信 CUE ログ</h3>
        <table>
          <thead>
            <tr>
              <th>seq</th>
              <th>time</th>
              <th>source</th>
              <th>cue</th>
            </tr>
          </thead>
          <tbody>
            {cues.map((cue) => (
              <tr key={cue.seq}>
                <td>{cue.seq}</td>
                <td>{new Date(cue.at).toLocaleTimeString('ja-JP', { hour12: false })}</td>
                <td>{cue.sourceNodeId}</td>
                <td>{cue.cue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )

  function handleEnvelope(envelope: EventEnvelope): void {
    if (envelope.kind === 'scene.cue') {
      const payload = envelope.payload as { cue?: string } | null
      const cueText = payload?.cue
      if (!cueText) {
        return
      }
      setCues((prev) => {
        const next = [
          ...prev,
          {
            seq: envelope.seq,
            sourceNodeId: envelope.sourceNodeId,
            cue: cueText,
            at: envelope.serverTs,
          },
        ]
        return next.slice(-120)
      })
      return
    }

    if (envelope.kind === 'transcript.text') {
      const payload = envelope.payload as { text?: string } | null
      if (payload?.text) {
        setLatestTranscript(payload.text)
      }
    }
  }
}

export default App
