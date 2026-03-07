import { openai } from './client'

export async function transcribe(audioFile: File): Promise<string> {
  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: audioFile,
  })
  return response.text
}

export async function speak(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'alloy'
): Promise<Blob> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
  })
  return new Blob([await response.arrayBuffer()], { type: 'audio/mpeg' })
}
