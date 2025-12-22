import OpenAI from 'openai'

const apiKey = import.meta.env.VITE_OPENAI_API_KEY

if (!apiKey) {
  console.warn('VITE_OPENAI_API_KEY is not set')
}

export const openai = new OpenAI({
  apiKey,
  dangerouslyAllowBrowser: true,
})
