import { useEffect, useState } from 'react'
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision'

export const useImageSegmentation = () => {
  const [segmenter, setSegmenter] = useState<ImageSegmenter | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const initializeSegmenter = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )

        const imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: false
        })

        setSegmenter(imageSegmenter)
        setIsLoading(false)
      } catch (err) {
        console.error('セグメンテーションの初期化エラー:', err)
        setError('セグメンテーションの初期化に失敗しました')
        setIsLoading(false)
      }
    }

    initializeSegmenter()
  }, [])

  return { segmenter, isLoading, error }
}

export const applyBackgroundReplacement = (
  videoElement: HTMLVideoElement,
  canvasElement: HTMLCanvasElement,
  segmenter: ImageSegmenter,
  backgroundImage: HTMLImageElement | null,
  timestamp: number
) => {
  const ctx = canvasElement.getContext('2d')
  if (!ctx) return

  canvasElement.width = videoElement.videoWidth
  canvasElement.height = videoElement.videoHeight

  const result = segmenter.segmentForVideo(videoElement, timestamp)

  if (result && result.categoryMask) {
    const mask = result.categoryMask.getAsFloat32Array()

    // 背景を描画
    if (backgroundImage) {
      ctx.drawImage(backgroundImage, 0, 0, canvasElement.width, canvasElement.height)
    } else {
      // デフォルトの背景色
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvasElement.width, canvasElement.height)
    }

    // 一時的なキャンバスにビデオフレームを描画
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = canvasElement.width
    tempCanvas.height = canvasElement.height
    const tempCtx = tempCanvas.getContext('2d')
    if (!tempCtx) return

    tempCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height)
    const videoImageData = tempCtx.getImageData(0, 0, canvasElement.width, canvasElement.height)
    const currentImageData = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height)

    // マスクを適用して人物部分のみを合成
    for (let i = 0; i < mask.length; i++) {
      const maskValue = mask[i]
      if (maskValue > 0.5) {
        // 人物部分
        const pixelIndex = i * 4
        currentImageData.data[pixelIndex] = videoImageData.data[pixelIndex]
        currentImageData.data[pixelIndex + 1] = videoImageData.data[pixelIndex + 1]
        currentImageData.data[pixelIndex + 2] = videoImageData.data[pixelIndex + 2]
        currentImageData.data[pixelIndex + 3] = videoImageData.data[pixelIndex + 3]
      }
    }

    ctx.putImageData(currentImageData, 0, 0)
  }
}
