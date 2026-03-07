import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { SceneDirector } from './core/director'
import { OpenAIEmotionAnalyzer } from './core/emotion'
import { SceneRenderer } from './core/renderer'
import { SampleVoiceFeed } from './core/sampleFeed'
import { VisionEngine } from './core/vision'
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

  const resourcesRef = useRef<{
    animationId: number | null
    vision: VisionEngine | null
    director: SceneDirector | null
    feed: SampleVoiceFeed | null
    bootedAt: number
    lastFrameAt: number
    smoothedFps: number
    lastHudUpdate: number
    latestHandCount: number
    latestParticleCount: number
  }>({
    animationId: null,
    vision: null,
    director: null,
    feed: null,
    bootedAt: 0,
    lastFrameAt: 0,
    smoothedFps: 0,
    lastHudUpdate: 0,
    latestHandCount: 0,
    latestParticleCount: 0,
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

    resources.director = null
    resources.vision = null
    resources.feed = null
    resources.bootedAt = 0
    resources.lastFrameAt = 0
    resources.smoothedFps = 0
    resources.lastHudUpdate = 0
    resources.latestHandCount = 0
    resources.latestParticleCount = 0

    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach((track) => track.stop())
      videoRef.current.srcObject = null
    }
  }

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

      active.animationId = requestAnimationFrame(loop)
    }

    resourcesRef.current = {
      animationId: requestAnimationFrame(loop),
      vision,
      director,
      feed,
      bootedAt: performance.now(),
      lastFrameAt: 0,
      smoothedFps: 0,
      lastHudUpdate: 0,
      latestHandCount: 0,
      latestParticleCount: 0,
    }

    setStatus('running')
    setMessage(hasApiKey ? 'VOICE2LIGHT 稼働中' : 'VOICE2LIGHT 稼働中（感情判定はフォールバック）')
  }

  const stop = (): void => {
    teardown()
    setStatus('idle')
    setMessage('停止しました')
    setRunningTimeMs(0)
    setFps(0)
    setHandCount(0)
    setParticleCount(0)
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
          </div>

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

          {!hasApiKey && <p className="warning">`VITE_OPENAI_API_KEY` 未設定のため感情判定はローカル推定です。</p>}
        </section>
      )}
    </div>
  )
}

export default App
