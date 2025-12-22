import { useEffect, useRef, useState } from 'react'
import './App.css'
import { useImageSegmentation, applyBackgroundReplacement } from './useImageSegmentation'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>('')
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null)
  const { segmenter, isLoading, error: segmenterError } = useImageSegmentation()
  const animationFrameRef = useRef<number | undefined>(undefined)

  // カメラの初期化
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (err) {
        console.error('カメラへのアクセスエラー:', err)
        setError('カメラにアクセスできませんでした。カメラの使用を許可してください。')
      }
    }

    startCamera()

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach(track => track.stop())
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // セグメンテーション処理
  useEffect(() => {
    if (!segmenter || !videoRef.current || !canvasRef.current) return

    let lastVideoTime = -1

    const processFrame = () => {
      if (!videoRef.current || !canvasRef.current || !segmenter) return

      const currentTime = videoRef.current.currentTime
      if (currentTime !== lastVideoTime) {
        lastVideoTime = currentTime
        const timestamp = performance.now()

        applyBackgroundReplacement(
          videoRef.current,
          canvasRef.current,
          segmenter,
          backgroundImage,
          timestamp
        )
      }

      animationFrameRef.current = requestAnimationFrame(processFrame)
    }

    processFrame()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [segmenter, backgroundImage])

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

  const handleRemoveBackground = () => {
    setBackgroundImage(null)
  }

  return (
    <div className="app">
      <h1>背景合成カメラ</h1>

      {error || segmenterError ? (
        <div className="error">{error || segmenterError}</div>
      ) : isLoading ? (
        <div className="loading">MediaPipeを読み込んでいます...</div>
      ) : (
        <>
          <div className="controls">
            <button onClick={handleUploadClick} className="upload-button">
              背景画像をアップロード
            </button>
            {backgroundImage && (
              <button onClick={handleRemoveBackground} className="remove-button">
                背景を削除
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: 'none' }}
          />

          <div className="video-container">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              style={{ display: 'none' }}
            />
            <canvas ref={canvasRef} className="canvas" />
          </div>
        </>
      )}
    </div>
  )
}

export default App
