import { useEffect, useRef } from 'react'
import './App.css'

// Features
import { useCamera } from './features/camera'
import { useDebug } from './features/debug'
import { useBackgroundImage } from './features/background'
import { TrackedTextOverlay } from './features/tracked-text/TrackedTextOverlay'

// Lib
import { ensureCanvasSize, drawTestPattern, drawStatusPlaceholder } from './lib/canvas'
import { ensureSettingsWindow } from './lib/ensureSettingsWindow'

// Segmentation
import { useImageSegmentation, applyBackgroundReplacement } from './useImageSegmentation'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)

  // Feature hooks
  const { videoRef, streamRef, videoReady, error: cameraError } = useCamera()
  const debug = useDebug()
  const background = useBackgroundImage()
  const { segmenter, isLoading, error: segmenterError } = useImageSegmentation()

  useEffect(() => {
    void ensureSettingsWindow({ focus: false })

    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (!mod) return
      if (event.key !== ',') return
      event.preventDefault()
      void ensureSettingsWindow({ focus: true })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
        if (debug.selectedMaskIndex !== 'auto') return Math.max(0, Math.min(debug.selectedMaskIndex, maskCount - 1))
        if (labels.length !== maskCount) return maskCount - 1
        const lower = labels.map(label => label.toLowerCase())
        const preferred = lower.findIndex(label =>
          label.includes('person') || label.includes('foreground') || label.includes('selfie')
        )
        if (preferred !== -1) return preferred
        const backgroundIdx = lower.findIndex(label => label.includes('background'))
        if (backgroundIdx !== -1 && maskCount === 2) return backgroundIdx === 0 ? 1 : 0
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
          `mode=${debug.renderMode}${debug.debugEnabled ? ' (debug)' : ''}`
        ])
      } else if (debug.renderMode === 'test') {
        ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
        drawTestPattern(ctx, canvasElement)
      } else if (debug.renderMode === 'background') {
        ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height)
        if (background.image) {
          ctx.drawImage(background.image, 0, 0, canvasElement.width, canvasElement.height)
        } else {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvasElement.width, canvasElement.height)
        }
      } else if (debug.renderMode === 'raw' || !segmenter) {
        ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height)
        ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height)
      } else if (debug.renderMode === 'mask') {
        const ok = drawMask(timestamp)
        if (!ok) {
          ensureCanvasSize(canvasElement, videoElement.videoWidth, videoElement.videoHeight)
          drawStatusPlaceholder(ctx, canvasElement, [
            'MASK DRAW FAILED',
            `segmenter=${segmenter ? 'ready' : 'none'} confidenceMasks=0?`,
            `mode=${debug.renderMode}`
          ])
        }
      } else {
        applyBackgroundReplacement(videoElement, canvasElement, segmenter, background.image, timestamp)
      }

      const frameEnd = performance.now()
      debug.updateFps(timestamp, frameEnd - frameStart)

      if (debug.debugEnabled) {
        const canvasRect = canvasElement.getBoundingClientRect()
        const labels = segmenter?.getLabels?.() ?? []
        const track = streamRef.current?.getVideoTracks?.()?.[0]
        debug.updateDebugText(timestamp, [
          `mode=${debug.renderMode} fps=${debug.fpsRef.current.toFixed(1)} frameMs=${debug.lastFrameMsRef.current.toFixed(1)}`,
          `video: readyState=${videoElement.readyState} paused=${videoElement.paused} time=${videoElement.currentTime.toFixed(3)}`,
          `video: ${videoElement.videoWidth}x${videoElement.videoHeight} (ready=${videoIsReady} state(videoReady)=${videoReady})`,
          `canvas: ${canvasElement.width}x${canvasElement.height} css=${Math.round(canvasRect.width)}x${Math.round(canvasRect.height)}`,
          `segmenter: ${segmenter ? 'ready' : isLoading ? 'loading' : 'none'} labels=${labels.length}`,
          track
            ? `track: readyState=${track.readyState} enabled=${track.enabled} muted=${track.muted} settings=${JSON.stringify(track.getSettings())}`
            : 'track: none'
        ])
      }

      animationFrameRef.current = requestAnimationFrame(processFrame)
    }

    animationFrameRef.current = requestAnimationFrame(processFrame)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [background.image, debug, isLoading, segmenter, videoReady, videoRef, streamRef])

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
            opacity: debug.debugEnabled ? 0.08 : 0.0001,
            pointerEvents: 'none'
          }}
        />
        <canvas ref={canvasRef} className="canvas" />
        <TrackedTextOverlay showStatusControls={false} />

        {/* 下部UI（ステータス・デバッグ用） */}
        <div className="overlay-ui overlay-ui--bottom">
          {(cameraError || segmenterError) && (
            <div className="error">{cameraError || segmenterError}</div>
          )}
          {isLoading && (
            <div className="loading">MediaPipeを読み込んでいます...</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
