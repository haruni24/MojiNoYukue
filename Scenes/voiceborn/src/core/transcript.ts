export type TranscriptConfig = {
  apiKey: string
  model: string
  language: string
}

type OpenAITranscriptionResponse = {
  text?: string
}

const FALLBACK_MODELS = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']

export async function transcribeWithOpenAI(blob: Blob, config: TranscriptConfig): Promise<string> {
  const models = [config.model, ...FALLBACK_MODELS].filter((model, index, list) => model && list.indexOf(model) === index)
  let lastError = 'unknown error'

  for (const model of models) {
    try {
      return await requestTranscription(blob, {
        ...config,
        model,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'transcription failed'
      lastError = message
      const retriable = /model|invalid.*model|not found|unsupported/i.test(message)
      if (!retriable) {
        throw error
      }
    }
  }

  throw new Error(lastError)
}

async function requestTranscription(blob: Blob, config: TranscriptConfig): Promise<string> {
  const extension = getExtension(blob.type)
  const file = new File([blob], `voiceborn-${Date.now()}.${extension}`, {
    type: blob.type || 'audio/webm',
  })

  const form = new FormData()
  form.append('file', file)
  form.append('model', config.model)
  form.append('language', config.language)
  form.append('response_format', 'json')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI transcription failed (${response.status}) [${config.model}]: ${body}`)
  }

  const json = (await response.json()) as OpenAITranscriptionResponse
  return (json.text ?? '').trim()
}

function getExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) {
    return 'ogg'
  }
  if (mimeType.includes('mp4')) {
    return 'mp4'
  }
  if (mimeType.includes('wav')) {
    return 'wav'
  }
  return 'webm'
}
