import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { useImageSegmentation, applyBackgroundReplacement } from './useImageSegmentation'
import { CommentOverlay } from './features/comments/CommentOverlay'

type RenderMode = 'composite' | 'raw' | 'mask' | 'background' | 'test'

type DebugSnapshot = {
  at: string
  renderMode: RenderMode
  video: {
    readyState: number
    paused: boolean
    ended: boolean
    currentTime: number
    videoWidth: number
    videoHeight: number
  }
  canvas: {
    width: number
    height: number
    cssWidth: number
    cssHeight: number
  }
  stream?: {
    active: boolean
    track: {
      readyState: MediaStreamTrack['readyState']
      enabled: boolean
      muted: boolean
      settings: MediaTrackSettings
    }
  }
  segmenter?: {
    loaded: boolean
    labels: string[]
    confidenceMaskCount?: number
    selectedMaskIndex?: number
    maskWidth?: number
    maskHeight?: number
    maskStats?: {
      min: number
      max: number
      mean: number
      nanCount: number
      sample: number[]
    }
  }
  errors: string[]
}

const getInitialDebugEnabled = () => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('debug')
}

const ensureCanvasSize = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (width <= 0 || height <= 0) return
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

const drawTestPattern = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  const { width, height } = canvas
  ctx.save()
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(0, 0, width, height)

  const tile = 24
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const shouldFill = ((x / tile) | 0) % 2 === ((y / tile) | 0) % 2
      if (!shouldFill) continue
      ctx.fillStyle = 'rgba(17, 24, 39, 0.06)'
      ctx.fillRect(x, y, tile, tile)
    }
  }

  ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)'
  ctx.lineWidth = Math.max(2, Math.min(6, width / 240))
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(width, height)
  ctx.moveTo(width, 0)
  ctx.lineTo(0, height)
  ctx.stroke()

  ctx.fillStyle = '#111827'
  ctx.font = `${Math.max(14, Math.min(26, width / 32))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
  ctx.fillText('CANVAS TEST PATTERN', Math.max(16, width / 40), Math.max(38, height / 14))
  ctx.restore()
}

const drawStatusPlaceholder = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, lines: string[]) => {
  const { width, height } = canvas
  ctx.save()
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)'
  ctx.fillRect(0, 0, width, Math.max(52, height * 0.12))

  ctx.fillStyle = '#0f172a'
  ctx.font = `${Math.max(13, Math.min(18, width / 56))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
  const startX = Math.max(14, width / 40)
  let y = Math.max(30, height * 0.07)
  const lineHeight = Math.max(18, Math.min(26, width / 60))
  for (const line of lines.slice(0, 8)) {
    ctx.fillText(line, startX, y)
    y += lineHeight
  }
  ctx.restore()
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string>('')
  const [videoReady, setVideoReady] = useState(false)
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null)
  const [audioUrl, setAudioUrl] = useState<string>('')
  const [audioFileName, setAudioFileName] = useState<string>('')
  const [audioIsPlaying, setAudioIsPlaying] = useState(false)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const { segmenter, isLoading, error: segmenterError } = useImageSegmentation()
  const animationFrameRef = useRef<number | undefined>(undefined)
  const [debugEnabled, setDebugEnabled] = useState(getInitialDebugEnabled)
  const [renderMode, setRenderMode] = useState<RenderMode>('composite')
  const [selectedMaskIndex, setSelectedMaskIndex] = useState<number | 'auto'>('auto')
  const [debugText, setDebugText] = useState<string>('')
  const debugTextRef = useRef<string>('')
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null)
  const lastUiUpdateRef = useRef<number>(0)
  const fpsRef = useRef<number>(0)
  const frameCountRef = useRef<number>(0)
  const fpsWindowStartRef = useRef<number>(0)
  const lastFrameMsRef = useRef<number>(0)

  // カメラデバイス関連
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')

  // カメラデバイスリストの取得
  useEffect(() => {
    const getDevices = async () => {
      try {
        // 最初にカメラへのアクセス許可を取得（デバイスラベルを取得するために必要）
        await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = devices.filter(device => device.kind === 'videoinput')
        setCameraDevices(videoDevices)
        if (videoDevices.length > 0 && !selectedCameraId) {
          setSelectedCameraId(videoDevices[0].deviceId)
        }
      } catch (err) {
        console.error('デバイスリストの取得エラー:', err)
      }
    }
    getDevices()

    // デバイス変更時にリストを更新
    navigator.mediaDevices.addEventListener('devicechange', getDevices)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices)
    }
  }, [selectedCameraId])

  // カメラの初期化
  useEffect(() => {
    if (!selectedCameraId) return

    let cancelled = false

    const startCamera = async () => {
      // 既存のストリームを停止
      streamRef.current?.getTracks().forEach(track => track.stop())
      setVideoReady(false)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedCameraId },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        })

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream

        const attach = () => {
          if (cancelled) return
          const videoElement = videoRef.current
          if (!videoElement) {
            requestAnimationFrame(attach)
            return
          }

          videoElement.srcObject = stream

          // メタデータ/初回フレームが読み込めたタイミングで処理開始
          const markReady = () => {
            setVideoReady(true)
          }
          videoElement.onloadedmetadata = markReady
          videoElement.onloadeddata = markReady
          videoElement.onplaying = markReady

          // autoplayが効かない環境でも再生を試みる
          videoElement.play().catch((playError) => {
            console.warn('カメラ映像の再生開始に失敗しました:', playError)
          })
        }

        attach()
        setError('')
      } catch (err) {
        console.error('カメラへのアクセスエラー:', err)
        setError('カメラにアクセスできませんでした。カメラの使用を許可してください。')
      }
    }

    startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      setVideoReady(false)
    }
  }, [selectedCameraId])

  // セグメンテーション処理
  useEffect(() => {
    const videoElement = videoRef.current
    const canvasElement = canvasRef.current
    if (!videoElement || !canvasElement) return

    const ctx = canvasElement.getContext('2d')
    if (!ctx) return

    const drawMask = (timestamp: number) => {
      if (!segmenter) return false
      if (videoElement.readyState < 2 || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) return false

      const result = segmenter.segmentForVideo(videoElement, timestamp)
      if (!result?.confidenceMasks?.length) return false

      const maskCount = result.confidenceMasks.length
      const labels = segmenter.getLabels?.() ?? []

      const pickForegroundIndex = () => {
        if (selectedMaskIndex !== 'auto') return Math.max(0, Math.min(selectedMaskIndex, maskCount - 1))
        if (labels.length !== maskCount) return maskCount - 1
        const lower = labels.map(label => label.toLowerCase())
        const preferred = lower.findIndex(label =>
          label.includes('person') || label.includes('foreground') || label.includes('selfie')
        )
        if (preferred !== -1) return preferred
        const background = lower.findIndex(label => label.includes('background'))
        if (background !== -1 && maskCount === 2) return background === 0 ? 1 : 0
        return maskCount - 1
      }

      const maskIndex = pickForegroundIndex()
      const selectedMask = result.confidenceMasks[maskIndex]
      const maskWidth = selectedMask.width
      const maskHeight = selectedMask.height
      const mask = selectedMask.getAsFloat32Array()
      if (maskWidth <= 0 || maskHeight <= 0 || mask.length === 0) return false

      const maskCanvas: HTMLCanvasElement | OffscreenCanvas =
        typeof OffscreenCanvas === 'undefined'
          ? Object.assign(document.createElement('canvas'), { width: maskWidth, height: maskHeight })
          : new OffscreenCanvas(maskWidth, maskHeight)
      const maskCtx = maskCanvas.getContext('2d')
      if (!maskCtx) return false

      const imageData = maskCtx.createImageData(maskWidth, maskHeight)
      const data = imageData.data
      for (let i = 0; i < mask.length; i++) {
        let value = mask[i]
        if (!Number.isFinite(value)) value = 0
        if (value < 0) value = 0
        if (value > 1) value = 1
        const gray = Math.round(value * 255)
        const index = i * 4
        data[index] = gray
        data[index + 1] = gray
        data[index + 2] = gray
        data[index + 3] = 255
      }
      maskCtx.putImageData(imageData, 0, 0)

      ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, canvasElement.width, canvasElement.height)
      ctx.drawImage(maskCanvas as unknown as CanvasImageSource, 0, 0, canvasElement.width, canvasElement.height)
      ctx.restore()
      return true
    }

    const processFrame = (timestamp: number) => {
      const frameStart = performance.now()

      const videoIsReady =
        videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0

      if (!videoIsReady) {
        if (canvasElement.width === 0 || canvasElement.height === 0) {
          ensureCanvasSize(canvasElement, 640, 360)
        }
        drawStatusPlaceholder(ctx, canvasElement, [
          'VIDEO NOT READY',
          `readyState=${videoElement.readyState} paused=${videoElement.paused} ended=${videoElement.ended}`,
          `videoWidth=${videoElement.videoWidth} videoHeight=${videoElement.videoHeight}`,
          `segmenter=${segmenter ? 'ready' : isLoading ? 'loading' : 'none'} videoReady(state)=${videoReady}`,
          `mode=${renderMode}${debugEnabled ? ' (debug)' : ''}`
        ])
      } else if (renderMode === 'test') {
        ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
        drawTestPattern(ctx, canvasElement)
      } else if (renderMode === 'background') {
        ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height)
        if (backgroundImage) {
          ctx.drawImage(backgroundImage, 0, 0, canvasElement.width, canvasElement.height)
        } else {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvasElement.width, canvasElement.height)
        }
      } else if (renderMode === 'raw' || !segmenter) {
        ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height)
        ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height)
      } else if (renderMode === 'mask') {
        const ok = drawMask(timestamp)
        if (!ok) {
          ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
          drawStatusPlaceholder(ctx, canvasElement, [
            'MASK DRAW FAILED',
            `segmenter=${segmenter ? 'ready' : 'none'} confidenceMasks=0?`,
            `mode=${renderMode}`
          ])
        }
      } else {
        applyBackgroundReplacement(videoElement, canvasElement, segmenter, backgroundImage, timestamp)
      }

      const frameEnd = performance.now()
      lastFrameMsRef.current = frameEnd - frameStart

      frameCountRef.current += 1
      if (fpsWindowStartRef.current === 0) {
        fpsWindowStartRef.current = timestamp
      } else if (timestamp - fpsWindowStartRef.current >= 1000) {
        fpsRef.current = (frameCountRef.current * 1000) / (timestamp - fpsWindowStartRef.current)
        frameCountRef.current = 0
        fpsWindowStartRef.current = timestamp
      }

      if (debugEnabled && timestamp - lastUiUpdateRef.current >= 250) {
        const canvasRect = canvasElement.getBoundingClientRect()
        const labels = segmenter?.getLabels?.() ?? []
        const track = streamRef.current?.getVideoTracks?.()?.[0]
        const lines = [
          `mode=${renderMode} fps=${fpsRef.current.toFixed(1)} frameMs=${lastFrameMsRef.current.toFixed(1)}`,
          `video: readyState=${videoElement.readyState} paused=${videoElement.paused} time=${videoElement.currentTime.toFixed(3)}`,
          `video: ${videoElement.videoWidth}x${videoElement.videoHeight} (ready=${videoIsReady} state(videoReady)=${videoReady})`,
          `canvas: ${canvasElement.width}x${canvasElement.height} css=${Math.round(canvasRect.width)}x${Math.round(canvasRect.height)}`,
          `segmenter: ${segmenter ? 'ready' : isLoading ? 'loading' : 'none'} labels=${labels.length}`,
          track
            ? `track: readyState=${track.readyState} enabled=${track.enabled} muted=${track.muted} settings=${JSON.stringify(track.getSettings())}`
            : 'track: none'
        ]

        const nextText = lines.join('\n')
        if (debugTextRef.current !== nextText) {
          debugTextRef.current = nextText
          setDebugText(nextText)
        }
        lastUiUpdateRef.current = timestamp
      }

      animationFrameRef.current = requestAnimationFrame(processFrame)
    }

    animationFrameRef.current = requestAnimationFrame(processFrame)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [backgroundImage, debugEnabled, isLoading, renderMode, segmenter, selectedMaskIndex, videoReady])

  // 背景画像のアップロード処理
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        setBackgroundImage(img)
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleAudioUploadClick = () => {
    audioInputRef.current?.click()
  }

  const handleAudioUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }

    const nextUrl = URL.createObjectURL(file)
    setAudioUrl(nextUrl)
    setAudioFileName(file.name)
    setAudioCurrentTime(0)
    setAudioDuration(0)
    setAudioIsPlaying(false)
    event.target.value = ''
  }

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const total = Math.floor(seconds)
    const minutes = Math.floor(total / 60)
    const remain = total % 60
    return `${minutes}:${String(remain).padStart(2, '0')}`
  }

  const handleToggleAudioPlayback = async () => {
    const audio = audioRef.current
    if (!audioUrl || !audio) return

    try {
      if (audio.paused || audio.ended) {
        await audio.play()
      } else {
        audio.pause()
      }
    } catch (playError) {
      console.error('音声再生エラー:', playError)
      setError(playError instanceof Error ? playError.message : String(playError))
    }
  }

  const handleStopAudio = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setAudioIsPlaying(false)
    setAudioCurrentTime(0)
  }

  const handleSeekAudio = (nextTime: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = nextTime
    setAudioCurrentTime(nextTime)
  }

  const handleRemoveBackground = () => {
    setBackgroundImage(null)
  }

  const maskIndexOptions = useMemo(() => {
    const labels = segmenter?.getLabels?.() ?? []
    const count = labels.length > 0 ? labels.length : 2
    const optionCount = Math.min(count, 6)
    return Array.from({ length: optionCount }, (_, index) => ({
      index,
      label: labels[index]
    }))
  }, [segmenter])

  const handleCaptureSnapshot = () => {
    const errors: string[] = []
    const videoElement = videoRef.current
    const canvasElement = canvasRef.current
    if (!videoElement || !canvasElement) return

    const canvasRect = canvasElement.getBoundingClientRect()
    const snapshot: DebugSnapshot = {
      at: new Date().toISOString(),
      renderMode,
      video: {
        readyState: videoElement.readyState,
        paused: videoElement.paused,
        ended: videoElement.ended,
        currentTime: videoElement.currentTime,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight
      },
      canvas: {
        width: canvasElement.width,
        height: canvasElement.height,
        cssWidth: Math.round(canvasRect.width),
        cssHeight: Math.round(canvasRect.height)
      },
      errors
    }

    const track = streamRef.current?.getVideoTracks?.()?.[0]
    if (track) {
      snapshot.stream = {
        active: streamRef.current?.active ?? false,
        track: {
          readyState: track.readyState,
          enabled: track.enabled,
          muted: track.muted,
          settings: track.getSettings()
        }
      }
    }

    if (segmenter) {
      const labels = segmenter.getLabels?.() ?? []
      snapshot.segmenter = { loaded: true, labels }

      try {
        const videoIsReady =
          videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0
        if (!videoIsReady) {
          errors.push('videoが未準備のためsegmentForVideoをスキップしました')
        } else {
          const result = segmenter.segmentForVideo(videoElement, performance.now())
          const maskCount = result.confidenceMasks?.length ?? 0
          snapshot.segmenter.confidenceMaskCount = maskCount

          if (maskCount > 0 && result.confidenceMasks) {
            const pickIndex = () => {
              if (selectedMaskIndex !== 'auto') return Math.max(0, Math.min(selectedMaskIndex, maskCount - 1))
              if (labels.length !== maskCount) return maskCount - 1
              const lower = labels.map(label => label.toLowerCase())
              const preferred = lower.findIndex(label =>
                label.includes('person') || label.includes('foreground') || label.includes('selfie')
              )
              if (preferred !== -1) return preferred
              const background = lower.findIndex(label => label.includes('background'))
              if (background !== -1 && maskCount === 2) return background === 0 ? 1 : 0
              return maskCount - 1
            }

            const maskIndex = pickIndex()
            const selectedMask = result.confidenceMasks[maskIndex]
            const mask = selectedMask.getAsFloat32Array()
            const maskWidth = selectedMask.width
            const maskHeight = selectedMask.height

            snapshot.segmenter.selectedMaskIndex = maskIndex
            snapshot.segmenter.maskWidth = maskWidth
            snapshot.segmenter.maskHeight = maskHeight

            if (mask.length > 0) {
              let min = Number.POSITIVE_INFINITY
              let max = Number.NEGATIVE_INFINITY
              let sum = 0
              let count = 0
              let nanCount = 0
              const sample: number[] = []

              const sampleIndices = [
                0,
                Math.floor(mask.length / 4),
                Math.floor(mask.length / 2),
                Math.floor((mask.length * 3) / 4),
                mask.length - 1
              ].filter((index) => index >= 0 && index < mask.length)

              for (const index of sampleIndices) {
                const value = mask[index]
                sample.push(Number.isFinite(value) ? Number(value.toFixed(4)) : NaN)
              }

              for (let i = 0; i < mask.length; i++) {
                const value = mask[i]
                if (!Number.isFinite(value)) {
                  nanCount += 1
                  continue
                }
                if (value < min) min = value
                if (value > max) max = value
                sum += value
                count += 1
              }

              snapshot.segmenter.maskStats = {
                min: Number.isFinite(min) ? Number(min.toFixed(6)) : NaN,
                max: Number.isFinite(max) ? Number(max.toFixed(6)) : NaN,
                mean: count ? Number((sum / count).toFixed(6)) : NaN,
                nanCount,
                sample
              }
            }
          }
        }
      } catch (segmentError) {
        errors.push(`segmentForVideo失敗: ${segmentError instanceof Error ? segmentError.message : String(segmentError)}`)
      }
    } else {
      snapshot.segmenter = { loaded: false, labels: [] }
    }

    setDebugSnapshot(snapshot)
    console.groupCollapsed('[debug snapshot]', snapshot.at)
    console.log(snapshot)
    console.groupEnd()
  }

  return (
    <div className="app">
      <div className="video-container">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: debugEnabled ? 0.08 : 0.0001,
            pointerEvents: 'none'
          }}
        />
        <canvas ref={canvasRef} className="canvas" />
        <CommentOverlay />

        {/* 上部UI */}
        <div className="overlay-ui overlay-ui--top">
          {/* カメラ選択バー */}
          {cameraDevices.length > 1 && (
            <div className="camera-selector">
              {cameraDevices.map((device, index) => (
                <button
                  key={device.deviceId}
                  onClick={() => setSelectedCameraId(device.deviceId)}
                  className={`glass-button camera-selector__button ${selectedCameraId === device.deviceId ? 'camera-selector__button--active' : ''}`}
                >
                  {device.label || `カメラ ${index + 1}`}
                </button>
              ))}
            </div>
          )}

          <div className="controls">
            <button onClick={handleUploadClick} className="glass-button">
              背景画像をアップロード
            </button>
            <button type="button" onClick={handleAudioUploadClick} className="glass-button">
              MP3をアップロード
            </button>
            {backgroundImage && (
              <button onClick={handleRemoveBackground} className="glass-button glass-button--danger">
                背景を削除
              </button>
            )}
            <button
              type="button"
              onClick={() => setDebugEnabled((prev) => !prev)}
              className="glass-button glass-button--secondary"
            >
              {debugEnabled ? 'デバッグON' : 'デバッグOFF'}
            </button>
          </div>

          <div className="audio-player" aria-label="音声プレイヤー">
            <audio
              ref={audioRef}
              src={audioUrl || undefined}
              preload="metadata"
              onLoadedMetadata={(e) => {
                const duration = e.currentTarget.duration
                setAudioDuration(Number.isFinite(duration) ? duration : 0)
              }}
              onTimeUpdate={(e) => setAudioCurrentTime(e.currentTarget.currentTime || 0)}
              onPlay={() => setAudioIsPlaying(true)}
              onPause={() => setAudioIsPlaying(false)}
              onEnded={() => setAudioIsPlaying(false)}
            />

            <div className="audio-player__row">
              <div className="audio-player__meta" title={audioFileName || '未選択'}>
                {audioFileName ? `♪ ${audioFileName}` : 'MP3未選択'}
              </div>
              <div className="controls audio-player__buttons">
                <button
                  type="button"
                  onClick={handleToggleAudioPlayback}
                  className="glass-button glass-button--secondary"
                  disabled={!audioUrl}
                >
                  {audioIsPlaying ? '一時停止' : '再生'}
                </button>
                <button
                  type="button"
                  onClick={handleStopAudio}
                  className="glass-button glass-button--secondary"
                  disabled={!audioUrl}
                >
                  停止
                </button>
              </div>
            </div>

            <div className="audio-player__row audio-player__timeline">
              <span className="audio-player__time">{formatTime(audioCurrentTime)}</span>
              <input
                className="audio-player__slider"
                type="range"
                min={0}
                max={audioDuration || 0}
                step={0.01}
                value={audioDuration ? Math.min(audioCurrentTime, audioDuration) : 0}
                onChange={(e) => handleSeekAudio(Number(e.target.value))}
                disabled={!audioUrl || !audioDuration}
                aria-label="再生位置"
              />
              <span className="audio-player__time">{formatTime(audioDuration)}</span>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          style={{ display: 'none' }}
        />

        <input
          ref={audioInputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,.mp3"
          onChange={handleAudioUpload}
          style={{ display: 'none' }}
        />

        {/* 下部UI（ステータス・デバッグ用） */}
        <div className="overlay-ui overlay-ui--bottom">
          {(error || segmenterError) && (
            <div className="error">{error || segmenterError}</div>
          )}
          {isLoading && (
            <div className="loading">MediaPipeを読み込んでいます...</div>
          )}

          {debugEnabled && (
            <>
              <div className="controls">
                <button type="button" onClick={handleCaptureSnapshot} className="glass-button glass-button--secondary">
                  スナップショット
                </button>
              </div>
              <details className="debug-panel" open>
                <summary className="debug-panel__summary">デバッグパネル</summary>
                <div className="debug-panel__row">
                  <label className="debug-panel__field">
                    表示モード
                    <select value={renderMode} onChange={(e) => setRenderMode(e.target.value as RenderMode)}>
                      <option value="composite">合成（通常）</option>
                      <option value="raw">元映像のみ</option>
                      <option value="mask">マスクのみ</option>
                      <option value="background">背景のみ</option>
                      <option value="test">テストパターン</option>
                    </select>
                  </label>

                  <label className="debug-panel__field">
                    マスク
                    <select
                      value={selectedMaskIndex === 'auto' ? 'auto' : String(selectedMaskIndex)}
                      onChange={(e) => {
                        const value = e.target.value
                        setSelectedMaskIndex(value === 'auto' ? 'auto' : Number(value))
                      }}
                      disabled={!segmenter}
                    >
                      <option value="auto">auto</option>
                      {maskIndexOptions.map(({ index, label }) => (
                        <option key={index} value={String(index)}>
                          {label ? `${index}: ${label}` : index}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <pre className="debug-panel__log">{debugText || '...'}</pre>
                {debugSnapshot && <pre className="debug-panel__snapshot">{JSON.stringify(debugSnapshot, null, 2)}</pre>}
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
