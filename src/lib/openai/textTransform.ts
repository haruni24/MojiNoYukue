import { chat } from './chat'
import { getStyleForMood, type Mood, type VisualStyle } from './styleDecision'

const SYSTEM_PROMPT = `あなたはインタラクティブアートのテキスト変換エンジンです。
入力された日本語テキストを以下の規則で変換してください：

1. 本質的な意味を保ちながら、詩的・視覚的に印象的な表現に変換
2. 漢字を崩したり関連文字に展開してもよい
3. 1〜3個の関連断片ワードも生成
4. 必ず以下のJSON形式のみで応答（説明文は不要）:
{"main":"変換後テキスト","fragments":["断片1","断片2"],"mood":"calm"}

moodは以下のいずれか: calm, energetic, melancholy, joyful, mysterious`

export type TransformResult = {
  main: string
  fragments: string[]
  mood: Mood
  style: VisualStyle
}

export async function transformText(input: string): Promise<TransformResult> {
  const response = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input },
    ],
    { temperature: 0.9, maxTokens: 200 },
  )

  const parsed = parseResponse(response)
  return {
    ...parsed,
    style: getStyleForMood(parsed.mood),
  }
}

function parseResponse(raw: string): { main: string; fragments: string[]; mood: Mood } {
  // JSONブロックの抽出（```json ... ``` で囲まれている場合を考慮）
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { main: raw.trim(), fragments: [], mood: 'calm' }
  }

  try {
    const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const main = typeof obj.main === 'string' ? obj.main : raw.trim()
    const fragments = Array.isArray(obj.fragments)
      ? obj.fragments.filter((f): f is string => typeof f === 'string')
      : []
    const mood =
      typeof obj.mood === 'string' &&
      ['calm', 'energetic', 'melancholy', 'joyful', 'mysterious'].includes(obj.mood)
        ? (obj.mood as Mood)
        : 'calm'
    return { main, fragments, mood }
  } catch {
    return { main: raw.trim(), fragments: [], mood: 'calm' }
  }
}
