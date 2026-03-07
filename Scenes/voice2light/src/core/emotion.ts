import type { EmotionPolarity, EmotionProfile } from '../types/scene'

type EmotionAnalyzerOptions = {
  apiKey: string
  model: string
  language?: string
}

type ResponsesApiOutput = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

const POSITIVE_HINTS = [
  '嬉しい',
  '安心',
  'ありがとう',
  '好き',
  '希望',
  '楽しい',
  'うれしい',
  '助かる',
  'beautiful',
  'happy',
  'love',
]

const NEGATIVE_HINTS = [
  'つらい',
  '苦しい',
  '怖い',
  '嫌',
  '無理',
  '悲しい',
  'しんどい',
  '失敗',
  'lonely',
  'sad',
  'hate',
]

export interface EmotionAnalyzer {
  analyze(text: string): Promise<EmotionProfile>
}

export class OpenAIEmotionAnalyzer implements EmotionAnalyzer {
  private readonly apiKey: string
  private readonly model: string
  private readonly language: string

  constructor(options: EmotionAnalyzerOptions) {
    this.apiKey = options.apiKey.trim()
    this.model = options.model
    this.language = options.language ?? 'ja'
  }

  async analyze(text: string): Promise<EmotionProfile> {
    const trimmed = text.trim()
    if (!trimmed) {
      return { polarity: 'neutral', intensity: 0.2, confidence: 0.4 }
    }

    if (!this.apiKey) {
      return inferEmotionLocally(trimmed)
    }

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_output_tokens: 120,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: [
                    `${this.language}の短文に対して感情を判定してください。`,
                    '返答はJSONのみ。',
                    'polarityはpositive/negative/neutralのいずれか。',
                    'intensityとconfidenceは0から1の実数。',
                  ].join('\n'),
                },
              ],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: trimmed }],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'emotion_profile',
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['polarity', 'intensity', 'confidence'],
                properties: {
                  polarity: {
                    type: 'string',
                    enum: ['positive', 'negative', 'neutral'],
                  },
                  intensity: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                  },
                  confidence: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                  },
                },
              },
              strict: true,
            },
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`OpenAI emotion request failed (${response.status})`)
      }

      const payload = (await response.json()) as ResponsesApiOutput
      const outputText = extractOutputText(payload)
      if (!outputText) {
        return inferEmotionLocally(trimmed)
      }

      const parsed = JSON.parse(outputText) as Partial<EmotionProfile>
      return normalizeEmotion(parsed, trimmed)
    } catch {
      return inferEmotionLocally(trimmed)
    }
  }
}

function extractOutputText(payload: ResponsesApiOutput): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (!Array.isArray(payload.output)) {
    return null
  }

  for (const item of payload.output) {
    if (!Array.isArray(item.content)) {
      continue
    }
    for (const content of item.content) {
      if (typeof content.text === 'string' && content.text.trim()) {
        return content.text.trim()
      }
    }
  }

  return null
}

function normalizeEmotion(candidate: Partial<EmotionProfile>, text: string): EmotionProfile {
  const fallback = inferEmotionLocally(text)
  const polarity = normalizePolarity(candidate.polarity) ?? fallback.polarity
  const intensity = clamp01(Number.isFinite(candidate.intensity) ? Number(candidate.intensity) : fallback.intensity)
  const confidence = clamp01(
    Number.isFinite(candidate.confidence) ? Number(candidate.confidence) : fallback.confidence,
  )

  return { polarity, intensity, confidence }
}

function normalizePolarity(value: unknown): EmotionPolarity | null {
  if (value === 'positive' || value === 'negative' || value === 'neutral') {
    return value
  }
  return null
}

function inferEmotionLocally(text: string): EmotionProfile {
  const normalized = text.toLowerCase()
  let score = 0
  let hitCount = 0

  POSITIVE_HINTS.forEach((word) => {
    if (normalized.includes(word.toLowerCase())) {
      score += 1
      hitCount += 1
    }
  })

  NEGATIVE_HINTS.forEach((word) => {
    if (normalized.includes(word.toLowerCase())) {
      score -= 1
      hitCount += 1
    }
  })

  const punctuationBoost = (text.match(/[!！?？]/g)?.length ?? 0) * 0.08
  const lengthBoost = Math.min(0.22, text.length / 110)
  const baseIntensity = 0.35 + punctuationBoost + lengthBoost + Math.min(0.22, hitCount * 0.08)
  const intensity = clamp01(baseIntensity)

  if (score > 0) {
    return {
      polarity: 'positive',
      intensity,
      confidence: clamp01(0.48 + Math.min(0.4, hitCount * 0.12)),
    }
  }
  if (score < 0) {
    return {
      polarity: 'negative',
      intensity,
      confidence: clamp01(0.48 + Math.min(0.4, hitCount * 0.12)),
    }
  }

  return {
    polarity: 'neutral',
    intensity: clamp01(intensity * 0.72),
    confidence: 0.42,
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}
