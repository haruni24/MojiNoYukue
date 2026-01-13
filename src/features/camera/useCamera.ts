import { useEffect, useRef, useState } from 'react'

const CAMERA_DEVICE_KEY = 'camera.selectedDeviceId'

const readStoredDeviceId = () => {
  try {
    return window.localStorage.getItem(CAMERA_DEVICE_KEY) ?? ''
  } catch {
    return ''
  }
}

const storeDeviceId = (deviceId: string) => {
  try {
    if (!deviceId) window.localStorage.removeItem(CAMERA_DEVICE_KEY)
    else window.localStorage.setItem(CAMERA_DEVICE_KEY, deviceId)
  } catch {
    // ignore
  }
}

export type UseCameraOptions = {
  initialDeviceId?: string
  videoConstraints?: {
    width?: { ideal: number }
    height?: { ideal: number }
  }
}

export function useCamera(options: UseCameraOptions = {}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => options.initialDeviceId ?? readStoredDeviceId())
  const [videoReady, setVideoReady] = useState(false)
  const [error, setError] = useState<string>('')
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const selectedDeviceIdRef = useRef<string>(selectedDeviceId)

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId
  }, [selectedDeviceId])

  useEffect(() => {
    storeDeviceId(selectedDeviceId)
  }, [selectedDeviceId])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CAMERA_DEVICE_KEY) return
      const next = event.newValue ?? ''
      if (next && next !== selectedDeviceIdRef.current) {
        setSelectedDeviceId(next)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // カメラデバイスリストの取得
  useEffect(() => {
    const getDevices = async () => {
      try {
        // 最初にカメラへのアクセス許可を取得（デバイスラベルを取得するために必要）
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        permissionStream.getTracks().forEach((track) => track.stop())
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = allDevices.filter(device => device.kind === 'videoinput')
        setDevices(videoDevices)
        if (videoDevices.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoDevices[0].deviceId)
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
  }, [])

  // カメラの初期化
  useEffect(() => {
    if (!selectedDeviceId) return

    let cancelled = false

    const startCamera = async () => {
      // 既存のストリームを停止
      streamRef.current?.getTracks().forEach(track => track.stop())
      setVideoReady(false)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedDeviceId },
            width: options.videoConstraints?.width ?? { ideal: 1280 },
            height: options.videoConstraints?.height ?? { ideal: 720 }
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
      setVideoReady(false)
    }
  }, [selectedDeviceId, options.videoConstraints])

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    videoReady,
    error,
    streamRef,
    videoRef,
  }
}
