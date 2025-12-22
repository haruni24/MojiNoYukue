import { openai } from './client'

export interface ImageOptions {
  model?: 'dall-e-2' | 'dall-e-3'
  size?: '1024x1024' | '1792x1024' | '1024x1792'
  quality?: 'standard' | 'hd'
  n?: number
}

export async function generateImage(
  prompt: string,
  options: ImageOptions = {}
): Promise<string[]> {
  const { model = 'dall-e-3', size = '1024x1024', quality = 'standard', n = 1 } = options

  const response = await openai.images.generate({
    model,
    prompt,
    size,
    quality,
    n,
  })

  return (response.data ?? []).map(img => img.url).filter((url): url is string => url !== undefined)
}
