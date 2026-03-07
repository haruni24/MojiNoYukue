import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'

export type UseAudioPlayerOptions = {
  onError?: (error: string) => void
  initialOutputId?: string
  pollIntervalMs?: number
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playerIdRef = useRef<number | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [playerId, setPlayerId] = useState<number | null>(null)
  const [selectedOutputId, setSelectedOutputId] = useState<string>(options.initialOutputId ?? 'default')
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [error, setError] = useState<string>('')

  type PlayerState = {
    player_id: number
    device_id: string
    file_name: string
    has_audio: boolean
    is_playing: boolean
    is_paused: boolean
    is_empty: boolean
  }

  const applyState = (state: PlayerState) => {
    setSelectedOutputId(state.device_id || 'default')
    setFileName(state.file_name || '')
    setHasAudio(Boolean(state.has_audio))
    setIsPlaying(Boolean(state.is_playing))
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!playerId) {
      options.onError?.('プレイヤー初期化中です')
      return
    }

    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
      const state = await invoke<PlayerState>('audio_load_mp3', {
        playerId,
        bytes,
        fileName: file.name,
      })
      applyState(state)
      setError('')
    } catch (invokeError) {
      console.error('MP3ロードエラー:', invokeError)
      const message = invokeError instanceof Error ? invokeError.message : String(invokeError)
      setError(message)
      options.onError?.(message)
    } finally {
      event.target.value = ''
    }
  }

  const triggerUpload = () => {
    fileInputRef.current?.click()
  }

  const togglePlayback = async () => {
    if (!playerId) return

    try {
      const state = await invoke<PlayerState>('audio_toggle_playback', { playerId })
      applyState(state)
      setError('')
    } catch (invokeError) {
      console.error('音声再生エラー:', invokeError)
      const message = invokeError instanceof Error ? invokeError.message : String(invokeError)
      setError(message)
      options.onError?.(message)
    }
  }

  const stop = async () => {
    if (!playerId) return
    try {
      const state = await invoke<PlayerState>('audio_stop', { playerId })
      applyState(state)
      setError('')
    } catch (invokeError) {
      console.error('停止エラー:', invokeError)
      const message = invokeError instanceof Error ? invokeError.message : String(invokeError)
      setError(message)
      options.onError?.(message)
    }
  }

  const selectOutput = async (deviceId: string) => {
    setSelectedOutputId(deviceId)
    if (!playerId) return
    try {
      const state = await invoke<PlayerState>('audio_set_player_device', { playerId, deviceId })
      applyState(state)
      setError('')
    } catch (invokeError) {
      console.error('出力デバイス切替エラー:', invokeError)
      const message = invokeError instanceof Error ? invokeError.message : String(invokeError)
      setError(message)
      options.onError?.(message)
    }
  }

  const playPcmF32 = async (samples: number[], sampleRate: number, channels: number) => {
    if (!playerId) return
    try {
      const state = await invoke<PlayerState>('audio_play_pcm_f32', {
        playerId,
        samples,
        sampleRate,
        channels,
      })
      applyState(state)
      setError('')
    } catch (invokeError) {
      console.error('PCM再生エラー:', invokeError)
      const message = invokeError instanceof Error ? invokeError.message : String(invokeError)
      setError(message)
      options.onError?.(message)
    }
  }

  useEffect(() => {
    let disposed = false

    const init = async () => {
      try {
        const createdId = await invoke<number>('audio_create_player')
        if (disposed) {
          void invoke('audio_destroy_player', { playerId: createdId })
          return
        }
        playerIdRef.current = createdId
        setPlayerId(createdId)
      } catch (invokeError) {
        console.error('プレイヤー作成エラー:', invokeError)
        const message = invokeError instanceof Error ? invokeError.message : String(invokeError)
        setError(message)
        options.onError?.(message)
      }
    }

    init()

    return () => {
      disposed = true
      const id = playerIdRef.current
      if (!id) return
      void invoke('audio_destroy_player', { playerId: id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!playerId) return
    void selectOutput(selectedOutputId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId])

  useEffect(() => {
    if (!playerId) return

    const intervalMs = Number.isFinite(options.pollIntervalMs) ? (options.pollIntervalMs as number) : 250
    if (intervalMs <= 0) return

    const handle = window.setInterval(async () => {
      try {
        const state = await invoke<PlayerState>('audio_get_state', { playerId })
        applyState(state)
      } catch {
        // ignore polling errors
      }
    }, intervalMs)

    return () => {
      window.clearInterval(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId])

  return {
    fileInputRef,
    fileName,
    playerId,
    selectedOutputId,
    isPlaying,
    hasAudio,
    error,
    handleUpload,
    triggerUpload,
    togglePlayback,
    stop,
    selectOutput,
    playPcmF32,
  }
}
