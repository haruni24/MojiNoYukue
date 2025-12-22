import { useEffect, useRef, useState } from 'react'
import './App.css'
import { useImageSegmentation, applyBackgroundReplacement } from './useImageSegmentation'
import { CommentOverlay } from './features/comments/CommentOverlay'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>('')
  const [videoReady, setVideoReady] = useState(false)
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null)
  const { segmenter, isLoading, error: segmenterError } = useImageSegmentation()
  const animationFrameRef = useRef<number | undefined>(undefined)

  // カメラの初期化
  useEffect(() => {
    const videoElement = videoRef.current

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        })

        if (videoElement) {
          videoElement.srcObject = stream

          // メタデータ/初回フレームが読み込めたタイミングで処理開始
          videoElement.onloadedmetadata = () => {
            setVideoReady(true)
          }
          videoElement.onloadeddata = () => {
            setVideoReady(true)
          }

          // autoplayが効かない環境でも再生を試みる
          videoElement.play().catch((playError) => {
            console.warn('カメラ映像の再生開始に失敗しました:', playError)
          })
        }
      } catch (err) {
        console.error('カメラへのアクセスエラー:', err)
        setError('カメラにアクセスできませんでした。カメラの使用を許可してください。')
      }
    }

    startCamera()

    return () => {
      if (videoElement?.srcObject) {
        const stream = videoElement.srcObject as MediaStream
        stream.getTracks().forEach(track => track.stop())
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      setVideoReady(false)
    }
  }, [])

  // セグメンテーション処理
  useEffect(() => {
    if (!segmenter || !videoRef.current || !canvasRef.current || !videoReady) return

    const processFrame = (timestamp: number) => {
      if (!videoRef.current || !canvasRef.current || !segmenter) return

      applyBackgroundReplacement(
        videoRef.current,
        canvasRef.current,
        segmenter,
        backgroundImage,
        timestamp
      )

      animationFrameRef.current = requestAnimationFrame(processFrame)
    }

    animationFrameRef.current = requestAnimationFrame(processFrame)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [segmenter, backgroundImage, videoReady])

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
              muted
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: 0.0001,
                pointerEvents: 'none'
              }}
            />
            <canvas ref={canvasRef} className="canvas" />
            <CommentOverlay />
          </div>
        </>
      )}
    </div>
  )
}

export default App
