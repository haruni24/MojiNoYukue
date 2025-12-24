import { useEffect, useMemo, useState } from 'react'

export type UseAudioOutputDevicesOptions = {
  initialDeviceId?: string
}

export function useAudioOutputDevices(options: UseAudioOutputDevicesOptions = {}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(options.initialDeviceId ?? 'default')
  const [error, setError] = useState<string>('')

  const supportsSetSinkId = useMemo(() => {
    if (typeof window === 'undefined') return false
    return typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function'
  }, [])

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const outputs = allDevices.filter((device) => device.kind === 'audiooutput')
      setDevices(outputs)
      setError('')

      if (outputs.length > 0) {
        const hasSelected = outputs.some((device) => device.deviceId === selectedDeviceId)
        if (!hasSelected) {
          const nextId = outputs.some((device) => device.deviceId === 'default') ? 'default' : outputs[0].deviceId
          setSelectedDeviceId(nextId)
        }
      }
    } catch (enumerateError) {
      console.error('音声出力デバイス取得エラー:', enumerateError)
      setError(enumerateError instanceof Error ? enumerateError.message : String(enumerateError))
    }
  }

  const selectDevice = async (deviceId: string, audioElement?: HTMLAudioElement | null) => {
    setSelectedDeviceId(deviceId)

    const audio = audioElement as unknown as { setSinkId?: (id: string) => Promise<void> }
    if (!audio?.setSinkId) return

    try {
      await audio.setSinkId(deviceId)
      setError('')
    } catch (sinkError) {
      console.error('出力デバイス切替エラー:', sinkError)
      setError(sinkError instanceof Error ? sinkError.message : String(sinkError))
    }
  }

  const requestLabelPermission = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach((track) => track.stop())
      await refreshDevices()
    } catch (permissionError) {
      console.error('音声権限取得エラー:', permissionError)
      setError(permissionError instanceof Error ? permissionError.message : String(permissionError))
    }
  }

  useEffect(() => {
    refreshDevices()
    const handler = () => refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handler)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    devices,
    selectedDeviceId,
    selectDevice,
    error,
    supportsSetSinkId,
    requestLabelPermission,
  }
}
