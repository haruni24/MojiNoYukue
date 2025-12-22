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
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm'
        )

        const createSegmenter = (delegate: 'GPU' | 'CPU') =>
          ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
              delegate
            },
            runningMode: 'VIDEO',
            outputCategoryMask: false,
            outputConfidenceMasks: true
          })

        let imageSegmenter: ImageSegmenter
        try {
          imageSegmenter = await createSegmenter('GPU')
        } catch (gpuError) {
          console.warn('GPUデリゲートでの初期化に失敗したため、CPUにフォールバックします:', gpuError)
          imageSegmenter = await createSegmenter('CPU')
        }

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

  if (canvasElement.width !== width) canvasElement.width = width
  if (canvasElement.height !== height) canvasElement.height = height

  // セグメンテーション実行
  const result = segmenter.segmentForVideo(videoElement, timestamp)

  // confidenceMasksを使用
  if (result && result.confidenceMasks && result.confidenceMasks.length > 0) {
    const labels = segmenter.getLabels?.() ?? []
    let foregroundMaskIndex = result.confidenceMasks.length - 1
    if (labels.length === result.confidenceMasks.length) {
      const lowerLabels = labels.map(label => label.toLowerCase())
      const preferredIndex = lowerLabels.findIndex(label =>
        label.includes('person') || label.includes('foreground') || label.includes('selfie')
      )
      if (preferredIndex !== -1) {
        foregroundMaskIndex = preferredIndex
      } else {
        const backgroundIndex = lowerLabels.findIndex(label => label.includes('background'))
        if (backgroundIndex !== -1 && result.confidenceMasks.length === 2) {
          foregroundMaskIndex = backgroundIndex === 0 ? 1 : 0
        }
      }
    }

    const confidenceMask = result.confidenceMasks[Math.max(0, Math.min(foregroundMaskIndex, result.confidenceMasks.length - 1))]
    const mask = confidenceMask.getAsFloat32Array()
    const maskWidth = confidenceMask.width
    const maskHeight = confidenceMask.height
    if (maskWidth <= 0 || maskHeight <= 0 || mask.length === 0) {
      ctx.drawImage(videoElement, 0, 0, width, height)
      return
    }

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

    const outputData = outputImageData.data
    const videoData = videoImageData.data
    const backgroundData = backgroundImageData.data

    // マスクを適用して合成（マスク解像度が入力と異なる場合に備えてスケーリング）
    for (let y = 0; y < height; y++) {
      const maskY = Math.min(maskHeight - 1, Math.floor((y * maskHeight) / height))
      const maskRowOffset = maskY * maskWidth
      const rowOffset = y * width

      for (let x = 0; x < width; x++) {
        const maskX = Math.min(maskWidth - 1, Math.floor((x * maskWidth) / width))
        let maskValue = mask[maskRowOffset + maskX] // 0 = 背景, 1 = 人物（想定）
        if (!Number.isFinite(maskValue)) maskValue = 0
        if (maskValue < 0) maskValue = 0
        if (maskValue > 1) maskValue = 1

        const pixelIndex = (rowOffset + x) * 4

        // マスク値に基づいてブレンド（人物部分はビデオ、背景部分は背景画像）
        outputData[pixelIndex] =
          videoData[pixelIndex] * maskValue + backgroundData[pixelIndex] * (1 - maskValue)
        outputData[pixelIndex + 1] =
          videoData[pixelIndex + 1] * maskValue + backgroundData[pixelIndex + 1] * (1 - maskValue)
        outputData[pixelIndex + 2] =
          videoData[pixelIndex + 2] * maskValue + backgroundData[pixelIndex + 2] * (1 - maskValue)
        outputData[pixelIndex + 3] = 255
      }
    }

    ctx.putImageData(outputImageData, 0, 0)
  } else {
    // セグメンテーション結果がない場合はビデオをそのまま表示
    ctx.drawImage(videoElement, 0, 0, width, height)
  }
}
