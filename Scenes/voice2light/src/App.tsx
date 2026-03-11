import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { SceneDirector } from './core/director'
import { OpenAIEmotionAnalyzer } from './core/emotion'
import { SceneRenderer } from './core/renderer'
import { SampleVoiceFeed } from './core/sampleFeed'
import { VisionEngine } from './core/vision'
import { SceneBusClient, type EventEnvelope } from './net/sceneBus'
import type { VisionSnapshot } from './types/scene'

type RuntimeStatus = 'idle' | 'booting' | 'running' | 'error-camera' | 'error-model'

const TARGET_FPS = Number(import.meta.env.VITE_TARGET_FPS ?? 24)
const CAMERA_WIDTH = Number(import.meta.env.VITE_CAMERA_WIDTH ?? 960)
const CAMERA_HEIGHT = Number(import.meta.env.VITE_CAMERA_HEIGHT ?? 540)
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_EMOTION_MODEL ?? 'gpt-4.1-mini'
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY ?? ''
const UI_TOGGLE_KEY = import.meta.env.VITE_UI_TOGGLE_KEY ?? 'KeyU'
const ENABLE_HANDS = false
const ENABLE_SILHOUETTE = String(import.meta.env.VITE_ENABLE_SILHOUETTE ?? 'false').toLowerCase() === 'true'
const BUS_ENABLED = String(import.meta.env.VITE_SCENE_BUS_ENABLED ?? 'false').toLowerCase() === 'true'
const BUS_URL = import.meta.env.VITE_SCENE_BUS_URL ?? 'ws://127.0.0.1:8787/ws'
const BUS_TOKEN = import.meta.env.VITE_SCENE_BUS_TOKEN ?? ''
const BUS_NODE_ID = import.meta.env.VITE_SCENE_NODE_ID ?? `voice2light-${location.hostname}`
const BUS_ROOM = import.meta.env.VITE_SCENE_ROOM ?? 'default'
const BUS_GROUPS = String(import.meta.env.VITE_SCENE_GROUPS ?? 'main')
  .split(',')
  .map((v: string) => v.trim())
  .filter((v: string) => v.length > 0)

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [status, setStatus] = useState<RuntimeStatus>('idle')
  const [message, setMessage] = useState('起動待機中')
  const [runningTimeMs, setRunningTimeMs] = useState(0)
  const [panelVisible, setPanelVisible] = useState(false)
  const [handCount, setHandCount] = useState(0)
  const [particleCount, setParticleCount] = useState(0)
  const [fps, setFps] = useState(0)
  const [busConnected, setBusConnected] = useState(false)
  const [receiveLogs, setReceiveLogs] = useState<Array<{ at: number; source: string; kind: string; text: string }>>([])
  const statusRef = useRef<RuntimeStatus>('idle')

  const resourcesRef = useRef<{
    animationId: number | null
    vision: VisionEngine | null
    director: SceneDirector | null
    feed: SampleVoiceFeed | null
    bus: SceneBusClient | null
    bootedAt: number
    lastFrameAt: number
    smoothedFps: number
    lastHudUpdate: number
    latestHandCount: number
    latestParticleCount: number
    lastMetricsSentAt: number
    recentExternalTexts: Map<string, number>
    busStatusTimerId: number | null
  }>({
    animationId: null,
    vision: null,
    director: null,
    feed: null,
    bus: null,
    bootedAt: 0,
    lastFrameAt: 0,
    smoothedFps: 0,
    lastHudUpdate: 0,
    latestHandCount: 0,
    latestParticleCount: 0,
    lastMetricsSentAt: 0,
    recentExternalTexts: new Map<string, number>(),
    busStatusTimerId: null,
  })

  const hasApiKey = useMemo(() => OPENAI_API_KEY.length > 0, [])

  function teardown(): void {
    const resources = resourcesRef.current
    if (resources.animationId !== null) {
      cancelAnimationFrame(resources.animationId)
      resources.animationId = null
    }

    resources.director?.stop()
    resources.vision?.dispose()
    resources.feed?.stop()
    resources.bus?.stop()
    if (resources.busStatusTimerId !== null) {
      window.clearInterval(resources.busStatusTimerId)
      resources.busStatusTimerId = null
    }

    resources.director = null
    resources.vision = null
    resources.feed = null
    resources.bus = null
    resources.bootedAt = 0
    resources.lastFrameAt = 0
    resources.smoothedFps = 0
    resources.lastHudUpdate = 0
    resources.latestHandCount = 0
    resources.latestParticleCount = 0
    resources.lastMetricsSentAt = 0
    resources.recentExternalTexts.clear()
    setBusConnected(false)

    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach((track) => track.stop())
      videoRef.current.srcObject = null
    }
  }

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === UI_TOGGLE_KEY) {
        setPanelVisible((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      teardown()
    }
  }, [])

  const start = async (): Promise<void> => {
    teardown()

    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) {
      return
    }

    setStatus('booting')
    setMessage('カメラとモデルを初期化中...')

    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: CAMERA_WIDTH },
          height: { ideal: CAMERA_HEIGHT },
          facingMode: 'user',
        },
        audio: false,
      })
      video.srcObject = cameraStream
      await video.play()
    } catch {
      setStatus('error-camera')
      setMessage('カメラ権限が必要です')
      return
    }

    let vision: VisionEngine
    try {
      vision = await VisionEngine.create({
        enableHands: ENABLE_HANDS,
        enableSilhouette: ENABLE_SILHOUETTE,
      })
    } catch {
      setStatus('error-model')
      setMessage('MediaPipeモデルの読み込みに失敗しました')
      return
    }

    const renderer = new SceneRenderer(canvas, {
      showHands: ENABLE_HANDS,
    })
    const bus = new SceneBusClient({
      enabled: BUS_ENABLED,
      wsUrl: BUS_URL,
      authToken: BUS_TOKEN,
      nodeId: BUS_NODE_ID,
      sourceApp: 'voice2light',
      room: BUS_ROOM,
      groups: BUS_GROUPS,
    })
    bus.onError((errorMessage) => {
      console.warn('[scene-bus][voice2light]', errorMessage)
      pushReceiveLog('scene-bus', 'server.error', errorMessage)
      setMessage('scene-bus 未接続: ローカル中継サーバを起動してください')
    })
    bus.onEvent((envelope) => {
      setBusConnected(bus.isConnected())
      handleRemoteEnvelope(envelope)
    })
    bus.start()

    const emotionAnalyzer = new OpenAIEmotionAnalyzer({
      apiKey: OPENAI_API_KEY,
      model: OPENAI_MODEL,
      language: 'ja',
    })
    const director = new SceneDirector({
      renderer,
      canvas,
      emotionAnalyzer,
      enableHandInteraction: ENABLE_HANDS,
      maxParticles: 780,
      onTextMaterialized: (event) => {
        bus.publish('transcript.text', {
          text: event.text,
          speakerId: event.speakerId,
          createdAt: event.createdAt,
        })
        bus.publish('emotion.profile', {
          text: event.text,
          speakerId: event.speakerId,
          polarity: event.emotion.polarity,
          intensity: event.emotion.intensity,
          confidence: event.emotion.confidence,
          createdAt: event.createdAt,
        })
      },
    })
    const feed = new SampleVoiceFeed()

    feed.start((text) => {
      director.enqueueText(text)
    })
    director.start()

    const frameInterval = 1000 / TARGET_FPS
    const visionInterval = Math.max(frameInterval, 1000 / 15)
    let lastRenderAt = 0
    let lastVisionAt = 0
    let cachedSnapshot: VisionSnapshot = {
      participants: [],
      hands: [],
      silhouetteStrength: 0,
      timestamp: performance.now(),
    }

    const loop = (timestamp: number): void => {
      const active = resourcesRef.current
      if (!active.vision || !active.director) {
        return
      }

      if (timestamp - lastRenderAt >= frameInterval) {
        if (timestamp - lastVisionAt >= visionInterval) {
          cachedSnapshot = active.vision.detect(video, timestamp)
          lastVisionAt = timestamp
        }

        const frameSnapshot: VisionSnapshot = {
          participants: cachedSnapshot.participants,
          hands: cachedSnapshot.hands,
          silhouetteStrength: cachedSnapshot.silhouetteStrength,
          timestamp,
        }

        active.director.onVisionFrame(frameSnapshot)
        active.latestHandCount = frameSnapshot.hands.length
        active.latestParticleCount = active.director.getParticleCount()
        lastRenderAt = timestamp
      }

      if (active.lastFrameAt > 0) {
        const delta = timestamp - active.lastFrameAt
        const instantFps = delta > 0 ? 1000 / delta : 0
        active.smoothedFps = active.smoothedFps > 0 ? active.smoothedFps * 0.84 + instantFps * 0.16 : instantFps
      }
      active.lastFrameAt = timestamp

      if (active.bootedAt > 0 && timestamp - active.lastHudUpdate > 220) {
        setRunningTimeMs(performance.now() - active.bootedAt)
        setFps(active.smoothedFps)
        setHandCount(active.latestHandCount)
        setParticleCount(active.latestParticleCount)
        active.lastHudUpdate = timestamp
      }

      if (active.bus && timestamp - active.lastMetricsSentAt > 200) {
        active.bus.publish('metrics.runtime', {
          status: 'running',
          fps: Number(active.smoothedFps.toFixed(2)),
          particles: active.latestParticleCount,
          hands: ENABLE_HANDS ? active.latestHandCount : 0,
          runtimeMs: active.bootedAt > 0 ? performance.now() - active.bootedAt : 0,
        })
        active.lastMetricsSentAt = timestamp
      }

      active.animationId = requestAnimationFrame(loop)
    }

    resourcesRef.current = {
      animationId: requestAnimationFrame(loop),
      vision,
      director,
      feed,
      bus,
      bootedAt: performance.now(),
      lastFrameAt: 0,
      smoothedFps: 0,
      lastHudUpdate: 0,
      latestHandCount: 0,
      latestParticleCount: 0,
      lastMetricsSentAt: 0,
      recentExternalTexts: new Map<string, number>(),
      busStatusTimerId: window.setInterval(() => {
        setBusConnected(bus.isConnected())
      }, 500),
    }

    bus.publish(
      'scene.cue',
      {
        cue: 'voice2light-started',
      },
      { priority: 'reliable' },
    )

    setStatus('running')
    setMessage(hasApiKey ? 'VOICE2LIGHT 稼働中' : 'VOICE2LIGHT 稼働中（感情判定はフォールバック）')
  }

  const stop = (): void => {
    const activeBus = resourcesRef.current.bus
    if (activeBus?.isConnected()) {
      activeBus.publish(
        'scene.cue',
        {
          cue: 'voice2light-stopped',
        },
        { priority: 'reliable' },
      )
    }
    teardown()
    setStatus('idle')
    setMessage('停止しました')
    setRunningTimeMs(0)
    setFps(0)
    setHandCount(0)
    setParticleCount(0)
  }

  const handleRemoteEnvelope = (envelope: EventEnvelope): void => {
    if (envelope.kind === 'transcript.text' && envelope.sourceNodeId !== BUS_NODE_ID) {
      const payload = envelope.payload as { text?: string } | null
      const text = payload?.text?.trim()
      if (text && shouldAcceptExternalText(envelope.sourceNodeId, text)) {
        pushReceiveLog(envelope.sourceNodeId, envelope.kind, text)
        resourcesRef.current.feed?.addLoopText(text)
        resourcesRef.current.feed?.enqueueText(text)
        resourcesRef.current.director?.enqueueText(text)
      }
      return
    }

    if (envelope.kind === 'control.command') {
      const payload = envelope.payload as { command?: string } | null
      if (payload?.command === 'start' && statusRef.current === 'idle') {
        void start()
      } else if (payload?.command === 'stop' && statusRef.current !== 'idle') {
        stop()
      } else if (payload?.command === 'reload') {
        window.location.reload()
      }
      return
    }

    if (envelope.kind === 'scene.cue') {
      const payload = envelope.payload as { cue?: string } | null
      if (payload?.cue) {
        pushReceiveLog(envelope.sourceNodeId, envelope.kind, payload.cue)
        setMessage(`CUE受信: ${payload.cue}`)
      }
    }
  }

  const shouldAcceptExternalText = (sourceNodeId: string, text: string): boolean => {
    const now = Date.now()
    const key = `${sourceNodeId}:${text}`
    const recent = resourcesRef.current.recentExternalTexts
    const prev = recent.get(key)
    recent.set(key, now)

    for (const [cacheKey, ts] of recent) {
      if (now - ts > 6000) {
        recent.delete(cacheKey)
      }
    }

    if (!prev) {
      return true
    }
    return now - prev > 1500
  }

  const pushReceiveLog = (source: string, kind: string, text: string): void => {
    setReceiveLogs((prev) => [...prev, { at: Date.now(), source, kind, text }].slice(-10))
  }

  const runtimeMinutes = Math.floor(runningTimeMs / 60000)
  const runtimeSeconds = Math.floor((runningTimeMs % 60000) / 1000)
  const showPanel = panelVisible || status === 'booting' || status === 'error-camera' || status === 'error-model'
  const runtimeLabel = `${runtimeMinutes.toString().padStart(2, '0')}:${runtimeSeconds.toString().padStart(2, '0')}`
  const handMeter = ENABLE_HANDS ? Math.min(1, handCount / 2) : 0
  const particleMeter = Math.min(1, particleCount / 450)
  const fpsMeter = Math.min(1, fps / Math.max(1, TARGET_FPS))

  return (
    <div className="voice2light-app">
      <video ref={videoRef} className="input-video" playsInline muted />
      <canvas ref={canvasRef} className="scene-canvas" />
      <div className="overlay-frame" aria-hidden="true" />

      <p className="ui-hint">{UI_TOGGLE_KEY} :: INTERFACE</p>

      {showPanel && (
        <section className="control-panel">
          <header className="panel-header">
            <p className="title-ja">声が光になる場所</p>
            <h1 className="title-main">Voice2Light</h1>
            <p className="title-sub">Luminous Speech Field</p>
          </header>

          <div className="status-band">
            <span className="status-label">STATUS</span>
            <p className="status">{message}</p>
            <p className="status">BUS: {BUS_ENABLED ? (busConnected ? 'ONLINE' : 'OFFLINE') : 'DISABLED'}</p>
          </div>

          {BUS_ENABLED && !busConnected && (
            <p className="warning">`scene-bus` が未接続です。`scene-bus` を起動しない限り voiceborn の文字は流入しません。</p>
          )}

          <div className="metrics">
            <div className="metric-row">
              <span>Runtime</span>
              <strong>{runtimeLabel}</strong>
            </div>
            <div className="metric-row">
              <span>Hands</span>
              <strong>{ENABLE_HANDS ? handCount : 'OFF'}</strong>
            </div>
            <div className="metric-row">
              <span>Particles</span>
              <strong>{particleCount}</strong>
            </div>
            <div className="metric-row">
              <span>FPS</span>
              <strong>{fps.toFixed(1)}</strong>
            </div>
          </div>

          <div className="meter-stack" aria-hidden="true">
            <div className="meter">
              <label>HAND</label>
              <div className="meter-track">
                <div className="meter-fill" style={{ width: `${handMeter * 100}%` }} />
              </div>
            </div>
            <div className="meter">
              <label>PARTICLE</label>
              <div className="meter-track">
                <div className="meter-fill is-particle" style={{ width: `${particleMeter * 100}%` }} />
              </div>
            </div>
            <div className="meter">
              <label>FRAME</label>
              <div className="meter-track">
                <div className="meter-fill is-fps" style={{ width: `${fpsMeter * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="actions">
            <button type="button" onClick={() => void start()} disabled={status === 'booting'}>
              START
            </button>
            <button type="button" onClick={stop} disabled={status !== 'running' && status !== 'booting'}>
              STOP
            </button>
          </div>

          <div className="metrics">
            <div className="metric-row">
              <span>Receive Log</span>
              <strong>{receiveLogs.length}</strong>
            </div>
            {receiveLogs.length === 0 && <p className="warning">まだ受信ログはありません。</p>}
            {receiveLogs.map((log, index) => (
              <div className="metric-row" key={`${log.at}-${index}`}>
                <span>
                  {new Date(log.at).toLocaleTimeString('ja-JP', { hour12: false })} {log.source}
                </span>
                <strong>{`${log.kind}: ${log.text.slice(0, 42)}`}</strong>
              </div>
            ))}
          </div>

          {!hasApiKey && <p className="warning">`VITE_OPENAI_API_KEY` 未設定のため感情判定はローカル推定です。</p>}
        </section>
      )}
    </div>
  )
}

export default App
