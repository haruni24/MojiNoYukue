import { useEffect, useMemo, useState } from 'react'

export type TrackingCameraInfo = {
  index: number
  source: string
}

export type TrackingTrack = {
  id: number
  conf: number
  bbox: [number, number, number, number]
  center: [number, number]
  bboxN: [number, number, number, number]
  centerN: [number, number]
  areaN: number
}

export type TrackingTracksMessage = {
  type: 'tracks'
  ts: number
  seq: number
  cameraIndex: number
  source: string
  frame: number
  size: { w: number; h: number }
  tracks: TrackingTrack[]
  targetId?: number | null
}

export type TrackingHelloMessage = {
  type: 'hello'
  version: number
  cameras: TrackingCameraInfo[]
  ts: number
}

export type TrackingConnectionStatus = 'idle' | 'connecting' | 'open' | 'error'

export type TrackingSseState = {
  status: TrackingConnectionStatus
  url: string
  error: string
  cameras: TrackingCameraInfo[]
  tracksByCameraIndex: Record<number, TrackingTracksMessage>
  lastEventAt: number | null
}

export type UseTrackingSseOptions = {
  enabled?: boolean
}

const safeJsonParse = <T,>(value: string): T | null => {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function useTrackingSse(url: string, options: UseTrackingSseOptions = {}): TrackingSseState {
  const enabled = options.enabled ?? true
  const [status, setStatus] = useState<TrackingConnectionStatus>(() =>
    enabled && url ? 'connecting' : 'idle'
  )
  const [error, setError] = useState<string>('')
  const [cameras, setCameras] = useState<TrackingCameraInfo[]>([])
  const [tracksByCameraIndex, setTracksByCameraIndex] = useState<Record<number, TrackingTracksMessage>>({})
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)

  const enabledKey = useMemo(() => (enabled && url ? `${url}` : ''), [enabled, url])

  useEffect(() => {
    if (!enabled || !url) {
      setStatus('idle')
      setError('')
      return
    }

    setStatus('connecting')
    setError('')

    const es = new EventSource(url)

    const markEvent = () => setLastEventAt(Date.now())

    const handleOpen = () => {
      setStatus('open')
      setError('')
      markEvent()
    }

    const handleError = () => {
      // EventSourceは自動でリトライするので「致命的なエラー」扱いにはしない
      const ready = es.readyState
      if (ready === EventSource.CONNECTING) {
        setStatus('connecting')
      } else if (ready === EventSource.CLOSED) {
        setStatus('error')
      } else {
        setStatus('error')
      }
      setError('PythonのSSEサーバに接続できません（再接続中）')
    }

    const handleHello = (event: MessageEvent<string>) => {
      const data = safeJsonParse<TrackingHelloMessage>(event.data)
      if (!data || data.type !== 'hello') return
      setCameras(Array.isArray(data.cameras) ? data.cameras : [])
      markEvent()
    }

    const handleTracks = (event: MessageEvent<string>) => {
      const data = safeJsonParse<TrackingTracksMessage>(event.data)
      if (!data || data.type !== 'tracks') return
      setTracksByCameraIndex((prev) => ({ ...prev, [data.cameraIndex]: data }))
      markEvent()
    }

    es.addEventListener('open', handleOpen)
    es.addEventListener('error', handleError)
    es.addEventListener('hello', handleHello as EventListener)
    es.addEventListener('tracks', handleTracks as EventListener)
    es.addEventListener('ping', markEvent as unknown as EventListener)

    return () => {
      es.removeEventListener('open', handleOpen)
      es.removeEventListener('error', handleError)
      es.close()
    }
  }, [enabledKey, enabled, url])

  return {
    status,
    url,
    error,
    cameras,
    tracksByCameraIndex,
    lastEventAt,
  }
}
