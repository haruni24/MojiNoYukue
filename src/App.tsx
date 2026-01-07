import { useEffect, useRef, useState } from 'react'
import './App.css'

// Features
import { useCamera, CameraSelector } from './features/camera'
import { useAudioOutputDevices, AudioPlayerPanel } from './features/audio-player'
import { useDebug, DebugPanel, type RenderMode } from './features/debug'
import { useBackgroundImage } from './features/background'
import { CommentOverlay } from './features/comments/CommentOverlay'

// Lib
import { ensureCanvasSize, drawTestPattern, drawStatusPlaceholder } from './lib/canvas'

// Segmentation
import { useImageSegmentation, applyBackgroundReplacement } from './useImageSegmentation'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)

  // Feature hooks
  const camera = useCamera()
  const audioOutput = useAudioOutputDevices()
  const debug = useDebug()
  const background = useBackgroundImage()
  const { segmenter, isLoading, error: segmenterError } = useImageSegmentation()
  const [audioPanels, setAudioPanels] = useState<number[]>(() => [1])
  const [nextAudioPanelId, setNextAudioPanelId] = useState(2)

  const addAudioPanel = () => {
    setAudioPanels((prev) => [...prev, nextAudioPanelId])
    setNextAudioPanelId((prev) => prev + 1)
  }

  const removeAudioPanel = (panelId: number) => {
    setAudioPanels((prev) => prev.filter((id) => id !== panelId))
  }

  // セグメンテーション処理
  useEffect(() => {
    const videoElement = camera.videoRef.current
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
          `segmenter=${segmenter ? 'ready' : isLoading ? 'loading' : 'none'} videoReady(state)=${camera.videoReady}`,
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
        const track = camera.streamRef.current?.getVideoTracks?.()?.[0]
        debug.updateDebugText(timestamp, [
          `mode=${debug.renderMode} fps=${debug.fpsRef.current.toFixed(1)} frameMs=${debug.lastFrameMsRef.current.toFixed(1)}`,
          `video: readyState=${videoElement.readyState} paused=${videoElement.paused} time=${videoElement.currentTime.toFixed(3)}`,
          `video: ${videoElement.videoWidth}x${videoElement.videoHeight} (ready=${videoIsReady} state(videoReady)=${camera.videoReady})`,
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
  }, [background.image, debug, isLoading, segmenter, camera.videoReady, camera.videoRef, camera.streamRef])

  const handleCaptureSnapshot = () => {
    debug.captureSnapshot(
      camera.videoRef.current,
      canvasRef.current,
      camera.streamRef,
      segmenter
    )
  }

  return (
    <div className="app">
      <div className="video-container">
        <video
          ref={camera.videoRef}
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
        <CommentOverlay />

        {/* 上部UI */}
        <div className="overlay-ui overlay-ui--top">
          {/* カメラ選択バー */}
          {camera.devices.length > 1 && (
            <CameraSelector
              devices={camera.devices}
              selectedDeviceId={camera.selectedDeviceId}
              onSelect={camera.setSelectedDeviceId}
            />
          )}

          <div className="controls">
            <button onClick={background.triggerUpload} className="glass-button">
              背景画像をアップロード
            </button>
            <button type="button" onClick={addAudioPanel} className="glass-button">
              音声プレイヤー追加
            </button>
            {background.image && (
              <button onClick={background.remove} className="glass-button glass-button--danger">
                背景を削除
              </button>
            )}
            <button
              type="button"
              onClick={() => debug.setDebugEnabled((prev) => !prev)}
              className="glass-button glass-button--secondary"
            >
              {debug.debugEnabled ? 'デバッグON' : 'デバッグOFF'}
            </button>
          </div>

          <div className="audio-player-stack">
            {audioPanels.map((panelId) => (
              <AudioPlayerPanel
                key={panelId}
                outputDevices={audioOutput.devices}
                outputError={audioOutput.error}
                isOutputLoading={audioOutput.isLoading}
                onRefreshOutputs={audioOutput.refreshDevices}
                onRemove={audioPanels.length > 1 ? () => removeAudioPanel(panelId) : undefined}
              />
            ))}
          </div>
        </div>

        <input
          ref={background.fileInputRef}
          type="file"
          accept="image/*"
          onChange={background.handleUpload}
          style={{ display: 'none' }}
        />

        {/* 下部UI（ステータス・デバッグ用） */}
        <div className="overlay-ui overlay-ui--bottom">
          {(camera.error || segmenterError) && (
            <div className="error">{camera.error || segmenterError}</div>
          )}
          {isLoading && (
            <div className="loading">MediaPipeを読み込んでいます...</div>
          )}

          {debug.debugEnabled && (
            <DebugPanel
              renderMode={debug.renderMode}
              onRenderModeChange={debug.setRenderMode as (mode: RenderMode) => void}
              selectedMaskIndex={debug.selectedMaskIndex}
              onMaskIndexChange={debug.setSelectedMaskIndex}
              maskIndexOptions={debug.maskIndexOptions}
              debugText={debug.debugText}
              debugSnapshot={debug.debugSnapshot}
              segmenterDisabled={!segmenter}
              onCaptureSnapshot={handleCaptureSnapshot}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
