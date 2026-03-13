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
      <header className="ending-header">
        <p className="scene-label">終幕制御</p>
        <h1 className="scene-title">文字のゆくえ</h1>
        <div className="connection-info">
          <span className={`status-badge ${connected ? 'is-online' : 'is-offline'}`}>
            {connected ? 'ONLINE' : 'OFFLINE'}
          </span>
          <span className="scene-subtitle">BUS {enabledLabel}</span>
        </div>
        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </header>

      <section className="last-cue">
        <p className="section-label">LAST CUE</p>
        <p className={`cue-value ${lastCue ? '' : 'is-empty'}`}>
          {lastCue ? lastCue.cue : '待機中'}
        </p>
        <p className="cue-meta">
          {lastCue
            ? `${lastCue.sourceNodeId} — ${new Date(lastCue.at).toLocaleTimeString('ja-JP', { hour12: false })}`
            : '—'}
        </p>
      </section>

      <nav className="control-actions">
        <button type="button" className="btn btn--start" onClick={() => sendControl('start')} disabled={!connected}>
          START
        </button>
        <button type="button" className="btn btn--stop" onClick={() => sendControl('stop')} disabled={!connected}>
          STOP
        </button>
        <button type="button" className="btn" onClick={() => sendControl('reload')} disabled={!connected}>
          RELOAD
        </button>
      </nav>

      <section className="transcript-section">
        <p className="section-label">TRANSCRIPT</p>
        <p className={`transcript-text ${latestTranscript ? '' : 'is-empty'}`}>
          {latestTranscript || '未受信'}
        </p>
      </section>

      <section className="log-section">
        <div className="section-heading">
          <span className="section-heading__text">受信キューログ</span>
        </div>
        <div className="log-table-wrap">
          <table className="ink-table">
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
        </div>
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
