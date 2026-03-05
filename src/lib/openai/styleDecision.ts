export type Mood = 'calm' | 'energetic' | 'melancholy' | 'joyful' | 'mysterious'

export type VisualStyle = {
  hue: number
  scale: number
  speed: number
  exitMode: 'evaporate' | 'sink' | 'shatter'
}

const MOOD_STYLES: Record<Mood, VisualStyle> = {
  calm:       { hue: 210, scale: 1.0, speed: 0.6, exitMode: 'evaporate' },
  energetic:  { hue: 35,  scale: 1.3, speed: 1.4, exitMode: 'shatter' },
  melancholy: { hue: 250, scale: 0.9, speed: 0.4, exitMode: 'sink' },
  joyful:     { hue: 50,  scale: 1.2, speed: 1.1, exitMode: 'evaporate' },
  mysterious: { hue: 280, scale: 1.1, speed: 0.7, exitMode: 'evaporate' },
}

const VALID_MOODS = new Set<string>(Object.keys(MOOD_STYLES))

export function getStyleForMood(mood: string): VisualStyle {
  if (VALID_MOODS.has(mood)) {
    return MOOD_STYLES[mood as Mood]
  }
  return MOOD_STYLES.calm
}

export function isMood(value: string): value is Mood {
  return VALID_MOODS.has(value)
}
