import { speak } from './audio'

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/**
 * OpenAI TTS-1 で音声を合成し、Web Audio API で再生する。
 *
 * Tauri環境の場合は invoke('audio_play_pcm_f32') を使う拡張ポイントもあるが、
 * まずはWeb Audio APIで再生し、Tauriが利用可能な場合はネイティブ再生にフォールバックする。
 */
export async function speakWithOpenAI(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
): Promise<void> {
  const blob = await speak(text, voice)
  const arrayBuffer = await blob.arrayBuffer()

  // Tauri環境の場合はネイティブオーディオを試みる
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const ctx = getAudioContext()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))

      // ステレオ→モノにミックスダウンし、Float32Arrayに変換
      const sampleRate = audioBuffer.sampleRate
      const length = audioBuffer.length
      const pcm = new Float32Array(length)
      const channels = audioBuffer.numberOfChannels
      for (let ch = 0; ch < channels; ch++) {
        const channelData = audioBuffer.getChannelData(ch)
        for (let i = 0; i < length; i++) {
          pcm[i] += channelData[i] / channels
        }
      }

      await invoke('audio_play_pcm_f32', {
        samples: Array.from(pcm),
        sampleRate,
      })
      return
    } catch {
      // Tauriコマンドが無い場合はWeb Audio APIにフォールバック
    }
  }

  // Web Audio API で再生
  const ctx = getAudioContext()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
  const source = ctx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(ctx.destination)
  source.start()
}
