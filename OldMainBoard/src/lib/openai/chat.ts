import { openai } from './client'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

export async function chat(
  messages: ChatCompletionMessageParam[],
  options: ChatOptions = {}
): Promise<string> {
  const { model = 'gpt-4o', temperature = 0.7, maxTokens } = options

  const response = await openai.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  })

  return response.choices[0].message.content ?? ''
}
