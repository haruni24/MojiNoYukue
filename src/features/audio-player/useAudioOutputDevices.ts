import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'

export type AudioOutputDevice = {
  id: string
  name: string
}

export function useAudioOutputDevices() {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([])
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  const refreshDevices = useCallback(async () => {
    setIsLoading(true)
    try {
      const outputs = await invoke<AudioOutputDevice[]>('audio_list_output_devices')
      setDevices(outputs)
      setError('')
    } catch (invokeError) {
      console.error('音声出力デバイス取得エラー:', invokeError)
      setError(invokeError instanceof Error ? invokeError.message : String(invokeError))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshDevices()
  }, [refreshDevices])

  return {
    devices,
    error,
    isLoading,
    refreshDevices,
  }
}
