import { useEffect, useRef, useState, type ChangeEvent } from 'react'

export type UseAudioPlayerOptions = {
  onError?: (error: string) => void
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }

    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    setFileName(file.name)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    event.target.value = ''
  }

  const triggerUpload = () => {
    fileInputRef.current?.click()
  }

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!url || !audio) return

    try {
      if (audio.paused || audio.ended) {
        await audio.play()
      } else {
        audio.pause()
      }
    } catch (playError) {
      console.error('音声再生エラー:', playError)
      options.onError?.(playError instanceof Error ? playError.message : String(playError))
    }
  }

  const stop = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setIsPlaying(false)
    setCurrentTime(0)
  }

  const seek = (nextTime: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const total = Math.floor(seconds)
    const minutes = Math.floor(total / 60)
    const remain = total % 60
    return `${minutes}:${String(remain).padStart(2, '0')}`
  }

  const handleLoadedMetadata = (dur: number) => {
    setDuration(Number.isFinite(dur) ? dur : 0)
  }

  const handleTimeUpdate = (time: number) => {
    setCurrentTime(time || 0)
  }

  const handlePlayStateChange = (playing: boolean) => {
    setIsPlaying(playing)
  }

  // URL cleanup
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  return {
    audioRef,
    fileInputRef,
    url,
    fileName,
    isPlaying,
    currentTime,
    duration,
    handleUpload,
    triggerUpload,
    togglePlayback,
    stop,
    seek,
    formatTime,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePlayStateChange,
  }
}
