import { useCallback, useEffect, useState } from 'react'

export function useVideoInputDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const video = all.filter((device) => device.kind === 'videoinput')
      setDevices(video)
    } catch (e) {
      console.warn('カメラデバイス列挙に失敗しました:', e)
      setDevices([])
    }
  }, [])

  useEffect(() => {
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])

  return { devices, refresh }
}
