import { chat } from './chat'

const SYSTEM_PROMPT = `あなたはインタラクティブアートのテキスト生成エンジンです。
与えられたテーマやキーワードから、壁面投影に使う日本語テキストを生成してください。

1. テーマに関連する短い日本語フレーズを5〜10個生成
2. 各フレーズは1〜15文字程度
3. 多様な表現(漢字、ひらがな、カタカナ、混在)を使う
4. 必ず以下のJSON配列のみで応答（説明文は不要）:
["フレーズ1","フレーズ2","フレーズ3"]`

export async function generateTextsFromTheme(theme: string): Promise<string[]> {
  const response = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: theme },
    ],
    { temperature: 1.0, maxTokens: 400 },
  )

  return parseResponse(response)
}

function parseResponse(raw: string): string[] {
  // JSON配列の抽出
  const arrayMatch = raw.match(/\[[\s\S]*\]/)
  if (!arrayMatch) {
    // フォールバック: 改行区切りのテキストとして扱う
    return raw
      .split('\n')
      .map((line) => line.replace(/^[\d.)\-\s]+/, '').trim())
      .filter((line) => line.length > 0 && line.length <= 20)
  }

  try {
    const arr = JSON.parse(arrayMatch[0]) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((item): item is string => typeof item === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  } catch {
    return []
  }
}
