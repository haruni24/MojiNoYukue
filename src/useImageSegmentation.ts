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
          outputCategoryMask: false,
          outputConfidenceMasks: true
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

  // ビデオが準備できているかチェック
  if (videoElement.readyState < 2 || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    return
  }

  const width = videoElement.videoWidth
  const height = videoElement.videoHeight

  canvasElement.width = width
  canvasElement.height = height

  // セグメンテーション実行
  const result = segmenter.segmentForVideo(videoElement, timestamp)

  // confidenceMasksを使用
  if (result && result.confidenceMasks && result.confidenceMasks.length > 0) {
    const mask = result.confidenceMasks[0].getAsFloat32Array()

    // まずビデオフレームを描画
    ctx.drawImage(videoElement, 0, 0, width, height)
    const videoImageData = ctx.getImageData(0, 0, width, height)

    // 背景用のImageDataを作成
    let backgroundImageData: ImageData

    if (backgroundImage) {
      // 背景画像を描画
      ctx.drawImage(backgroundImage, 0, 0, width, height)
      backgroundImageData = ctx.getImageData(0, 0, width, height)
    } else {
      // 白い背景
      backgroundImageData = ctx.createImageData(width, height)
      for (let i = 0; i < backgroundImageData.data.length; i += 4) {
        backgroundImageData.data[i] = 255     // R
        backgroundImageData.data[i + 1] = 255 // G
        backgroundImageData.data[i + 2] = 255 // B
        backgroundImageData.data[i + 3] = 255 // A
      }
    }

    // 出力用ImageData
    const outputImageData = ctx.createImageData(width, height)

    // マスクを適用して合成
    for (let i = 0; i < mask.length; i++) {
      const maskValue = mask[i] // 0 = 背景, 1 = 人物
      const pixelIndex = i * 4

      // マスク値に基づいてブレンド（人物部分はビデオ、背景部分は背景画像）
      outputImageData.data[pixelIndex] =
        videoImageData.data[pixelIndex] * maskValue +
        backgroundImageData.data[pixelIndex] * (1 - maskValue)
      outputImageData.data[pixelIndex + 1] =
        videoImageData.data[pixelIndex + 1] * maskValue +
        backgroundImageData.data[pixelIndex + 1] * (1 - maskValue)
      outputImageData.data[pixelIndex + 2] =
        videoImageData.data[pixelIndex + 2] * maskValue +
        backgroundImageData.data[pixelIndex + 2] * (1 - maskValue)
      outputImageData.data[pixelIndex + 3] = 255
    }

    ctx.putImageData(outputImageData, 0, 0)
  } else {
    // セグメンテーション結果がない場合はビデオをそのまま表示
    ctx.drawImage(videoElement, 0, 0, width, height)
  }
}
