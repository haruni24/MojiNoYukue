import { useCallback, useRef, useState } from 'react'
import { transcribe } from './audio'

export type MicTranscriptionStatus = 'idle' | 'recording' | 'transcribing'

export type UseMicTranscriptionReturn = {
  status: MicTranscriptionStatus
  startRecording: () => void
  stopRecording: () => Promise<string>
  toggleRecording: () => Promise<string | null>
  error: string
}

/**
 * マイク録音 → Whisper 音声認識 Hook
 *
 * MediaRecorder API で録音し、OpenAI Whisper-1 で文字起こしする。
 * toggleRecording() を呼ぶとトグル動作:
 *   idle → recording 開始
 *   recording → 停止 + transcribe → テキストを返す
 */
export function useMicTranscription(): UseMicTranscriptionReturn {
  const [status, setStatus] = useState<MicTranscriptionStatus>('idle')
  const [error, setError] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() })
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setStatus('recording')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'マイクにアクセスできません')
      setStatus('idle')
    }
  }, [])

  const stopRecording = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return ''

    return new Promise<string>((resolve) => {
      recorder.onstop = async () => {
        setStatus('transcribing')

        // すべてのトラックを停止してマイクを解放
        recorder.stream.getTracks().forEach((track) => track.stop())

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        const ext = recorder.mimeType.includes('webm') ? 'webm' : 'mp4'
        const file = new File([blob], `recording.${ext}`, { type: recorder.mimeType })

        try {
          const text = await transcribe(file)
          setStatus('idle')
          resolve(text)
        } catch (e) {
          setError(e instanceof Error ? e.message : '音声認識に失敗しました')
          setStatus('idle')
          resolve('')
        }
      }

      recorder.stop()
      mediaRecorderRef.current = null
    })
  }, [])

  const toggleRecording = useCallback(async (): Promise<string | null> => {
    if (status === 'recording') {
      return stopRecording()
    }
    if (status === 'idle') {
      await startRecording()
      return null // 録音開始 — テキストはまだない
    }
    // transcribing 中は何もしない
    return null
  }, [status, startRecording, stopRecording])

  return { status, startRecording, stopRecording: () => stopRecording(), toggleRecording, error }
}

function getSupportedMimeType(): string {
  // ブラウザ対応順: webm > mp4
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}
