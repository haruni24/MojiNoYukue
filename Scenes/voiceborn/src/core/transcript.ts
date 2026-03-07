export type TranscriptConfig = {
  apiKey: string
  model: string
  language: string
}

type OpenAITranscriptionResponse = {
  text?: string
}

export async function transcribeWithOpenAI(blob: Blob, config: TranscriptConfig): Promise<string> {
  const file = new File([blob], `voiceborn-${Date.now()}.webm`, {
    type: blob.type || 'audio/webm',
  })

  const form = new FormData()
  form.append('file', file)
  form.append('model', config.model)
  form.append('language', config.language)

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI transcription failed (${response.status}): ${body}`)
  }

  const json = (await response.json()) as OpenAITranscriptionResponse
  return (json.text ?? '').trim()
}
