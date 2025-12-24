import { useMemo, useRef, useState } from 'react'
import type { RenderMode, DebugSnapshot } from './types'

const getInitialDebugEnabled = () => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('debug')
}

export type UseDebugOptions = {
  initialEnabled?: boolean
}

export type SegmenterLike = {
  getLabels?: () => string[]
  segmentForVideo: (
    video: HTMLVideoElement,
    timestamp: number
  ) => {
    confidenceMasks?: Array<{
      width: number
      height: number
      getAsFloat32Array: () => Float32Array
    }>
  }
}

export function useDebug(options: UseDebugOptions = {}) {
  const [debugEnabled, setDebugEnabled] = useState(options.initialEnabled ?? getInitialDebugEnabled())
  const [renderMode, setRenderMode] = useState<RenderMode>('composite')
  const [selectedMaskIndex, setSelectedMaskIndex] = useState<number | 'auto'>('auto')
  const [debugText, setDebugText] = useState<string>('')
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null)

  // FPS tracking refs
  const fpsRef = useRef<number>(0)
  const frameCountRef = useRef<number>(0)
  const fpsWindowStartRef = useRef<number>(0)
  const lastFrameMsRef = useRef<number>(0)
  const lastUiUpdateRef = useRef<number>(0)
  const debugTextRef = useRef<string>('')

  const updateFps = (timestamp: number, frameMs: number) => {
    lastFrameMsRef.current = frameMs
    frameCountRef.current += 1

    if (fpsWindowStartRef.current === 0) {
      fpsWindowStartRef.current = timestamp
    } else if (timestamp - fpsWindowStartRef.current >= 1000) {
      fpsRef.current = (frameCountRef.current * 1000) / (timestamp - fpsWindowStartRef.current)
      frameCountRef.current = 0
      fpsWindowStartRef.current = timestamp
    }
  }

  const updateDebugText = (timestamp: number, lines: string[]) => {
    if (timestamp - lastUiUpdateRef.current < 250) return

    const nextText = lines.join('\n')
    if (debugTextRef.current !== nextText) {
      debugTextRef.current = nextText
      setDebugText(nextText)
    }
    lastUiUpdateRef.current = timestamp
  }

  const captureSnapshot = (
    videoElement: HTMLVideoElement | null,
    canvasElement: HTMLCanvasElement | null,
    streamRef: React.RefObject<MediaStream | null>,
    segmenter: SegmenterLike | null
  ) => {
    const errors: string[] = []
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

  const maskIndexOptions = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) => ({
      index,
      label: ''
    }))
  }, [])

  return {
    debugEnabled,
    setDebugEnabled,
    renderMode,
    setRenderMode,
    selectedMaskIndex,
    setSelectedMaskIndex,
    debugText,
    debugSnapshot,
    maskIndexOptions,
    captureSnapshot,
    updateFps,
    updateDebugText,
    fpsRef,
    lastFrameMsRef,
  }
}
