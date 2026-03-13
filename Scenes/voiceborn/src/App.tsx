import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AudioEngine } from './core/audio'
import { SceneDirector } from './core/director'
import { SceneRenderer } from './core/renderer'
import { VisionEngine } from './core/vision'
import { SceneBusClient, type EventEnvelope } from './net/sceneBus'

type RuntimeStatus =
  | 'idle'
  | 'booting'
  | 'running'
  | 'error-camera'
  | 'error-mic'
  | 'error-model'

const TARGET_FPS = Number(import.meta.env.VITE_TARGET_FPS ?? 30)
const CAMERA_WIDTH = Number(import.meta.env.VITE_CAMERA_WIDTH ?? 1920)
const CAMERA_HEIGHT = Number(import.meta.env.VITE_CAMERA_HEIGHT ?? 1080)
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe'
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY ?? ''
const BUS_ENABLED = String(import.meta.env.VITE_SCENE_BUS_ENABLED ?? 'false').toLowerCase() === 'true'
const BUS_URL = import.meta.env.VITE_SCENE_BUS_URL ?? 'ws://127.0.0.1:8787/ws'
const BUS_TOKEN = import.meta.env.VITE_SCENE_BUS_TOKEN ?? ''
const BUS_NODE_ID = import.meta.env.VITE_SCENE_NODE_ID ?? `voiceborn-${location.hostname}`
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
  const [showDebugUi, setShowDebugUi] = useState(true)
  const statusRef = useRef<RuntimeStatus>('idle')

  const resourcesRef = useRef<{
    animationId: number | null
    vision: VisionEngine | null
    audio: AudioEngine | null
    director: SceneDirector | null
    bus: SceneBusClient | null
    bootedAt: number
    lastMetricsSentAt: number
  }>({
    animationId: null,
    vision: null,
    audio: null,
    director: null,
    bus: null,
    bootedAt: 0,
    lastMetricsSentAt: 0,
  })

  const hasApiKey = useMemo(() => OPENAI_API_KEY.length > 0, [])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyU' || event.repeat) {
        return
      }
      setShowDebugUi((current) => !current)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    return () => {
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const teardown = (): void => {
    const resources = resourcesRef.current
    if (resources.animationId !== null) {
      cancelAnimationFrame(resources.animationId)
      resources.animationId = null
    }

    resources.director?.stop()
    resources.vision?.dispose()
    resources.audio?.stop()
    resources.bus?.stop()

    resources.director = null
    resources.vision = null
    resources.audio = null
    resources.bus = null
    resources.lastMetricsSentAt = 0

    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach((t) => t.stop())
      videoRef.current.srcObject = null
    }
  }

  const start = async (): Promise<void> => {
    teardown()

    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) {
      return
    }

    setStatus('booting')
    setMessage('デバイスとモデルを初期化中...')

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

    let audio: AudioEngine
    try {
      audio = await AudioEngine.create()
    } catch {
      setStatus('error-mic')
      setMessage('マイク権限が必要です')
      return
    }

    let vision: VisionEngine
    try {
      vision = await VisionEngine.create()
    } catch {
      setStatus('error-model')
      setMessage('MediaPipeモデルの読み込みに失敗しました')
      audio.stop()
      return
    }

    const renderer = new SceneRenderer(canvas)
    const bus = new SceneBusClient({
      enabled: BUS_ENABLED,
      wsUrl: BUS_URL,
      authToken: BUS_TOKEN,
      nodeId: BUS_NODE_ID,
      sourceApp: 'voiceborn',
      room: BUS_ROOM,
      groups: BUS_GROUPS,
    })
    bus.onError((errorMessage) => {
      console.warn('[scene-bus][voiceborn]', errorMessage)
      setMessage('scene-bus 未接続: transcript を配信できません')
    })
    bus.onEvent((envelope) => {
      handleRemoteEnvelope(envelope)
    })
    bus.start()

    const director = new SceneDirector({
      renderer,
      canvas,
      transcriptConfig: {
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        language: 'ja',
      },
      onTranscript: (event) => {
        bus.publish('transcript.text', {
          text: event.text,
          speakerId: event.speakerId,
          createdAt: event.createdAt,
        })
      },
      onTranscriptError: (errorMessage) => {
        bus.publish(
          'scene.cue',
          {
            cue: 'stt-error',
            message: errorMessage,
          },
          {
            priority: 'reliable',
          },
        )
      },
    })

    audio.setMetricsHandler((metrics) => {
      director.onAudioMetrics(metrics)
    })
    audio.setChunkHandler((chunk) => {
      if (!hasApiKey) {
        return
      }
      director.enqueueSpeech(chunk)
    })

    audio.start()
    director.start()

    const frameInterval = 1000 / TARGET_FPS
    let lastFrame = 0

    const loop = (timestamp: number): void => {
      if (!resourcesRef.current.director || !resourcesRef.current.vision) {
        return
      }

      if (timestamp - lastFrame >= frameInterval) {
        const snapshot = resourcesRef.current.vision.detect(video, timestamp)
        resourcesRef.current.director.onVisionFrame(snapshot, video)
        lastFrame = timestamp
      }

      const bootedAt = resourcesRef.current.bootedAt
      if (bootedAt > 0) {
        setRunningTimeMs(performance.now() - bootedAt)
      }

      if (resourcesRef.current.bus && timestamp - resourcesRef.current.lastMetricsSentAt > 200) {
        resourcesRef.current.bus.publish('metrics.runtime', {
          status: 'running',
          fpsTarget: TARGET_FPS,
          speaking: resourcesRef.current.audio ? 'active' : 'none',
          runtimeMs: resourcesRef.current.bootedAt > 0 ? performance.now() - resourcesRef.current.bootedAt : 0,
        })
        resourcesRef.current.lastMetricsSentAt = timestamp
      }

      resourcesRef.current.animationId = requestAnimationFrame(loop)
    }

    resourcesRef.current = {
      animationId: requestAnimationFrame(loop),
      vision,
      audio,
      director,
      bus,
      bootedAt: performance.now(),
      lastMetricsSentAt: 0,
    }

    bus.publish(
      'scene.cue',
      {
        cue: 'voiceborn-started',
      },
      { priority: 'reliable' },
    )

    setStatus('running')
    setMessage(hasApiKey ? '展示モード稼働中' : '展示モード稼働中（STTは無効）')
  }

  const stop = (): void => {
    const activeBus = resourcesRef.current.bus
    if (activeBus?.isConnected()) {
      activeBus.publish(
        'scene.cue',
        {
          cue: 'voiceborn-stopped',
        },
        { priority: 'reliable' },
      )
    }
    teardown()
    setStatus('idle')
    setMessage('停止しました')
    setRunningTimeMs(0)
  }

  const handleRemoteEnvelope = (envelope: EventEnvelope): void => {
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
        setMessage(`CUE受信: ${payload.cue}`)
      }
    }
  }

  const runtimeMinutes = Math.floor(runningTimeMs / 60000)
  const runtimeSeconds = Math.floor((runningTimeMs % 60000) / 1000)

  return (
    <div className="voiceborn-app">
      <video ref={videoRef} className="input-video" playsInline muted />
      <canvas ref={canvasRef} className="scene-canvas" />

      <div className="overlay-frame" aria-hidden="true" />

      {showDebugUi && (
        <section className="control-panel">
          <p className="title-ja">声が文字として誕生する</p>
          <h1 className="title-main">声</h1>
          <p className="status">{message}</p>
          <p className="runtime">
            {runtimeMinutes.toString().padStart(2, '0')}:{runtimeSeconds
              .toString()
              .padStart(2, '0')}
          </p>

          <div className="actions">
            <button type="button" onClick={() => void start()} disabled={status === 'booting'}>
              START
            </button>
            <button type="button" onClick={stop} disabled={status !== 'running' && status !== 'booting'}>
              STOP
            </button>
          </div>

          {!hasApiKey && (
            <p className="warning">VITE_OPENAI_API_KEY が未設定のため文字化演出は無効です。</p>
          )}
        </section>
      )}
    </div>
  )
}

export default App
