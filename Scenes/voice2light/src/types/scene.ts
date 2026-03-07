export type Vec2 = {
  x: number
  y: number
}

export type Landmark = {
  x: number
  y: number
  z: number
  visibility: number
}

export type ParticipantTrack = {
  id: string
  centroid: Vec2
  velocity: Vec2
  confidence: number
  activeMs: number
  score: number
  isPrimary: boolean
  landmarks: Landmark[]
}

export type EmotionPolarity = 'positive' | 'negative' | 'neutral'

export type EmotionProfile = {
  polarity: EmotionPolarity
  intensity: number
  confidence: number
}

export type HandTrack = {
  id: string
  handedness: 'Left' | 'Right' | 'Unknown'
  confidence: number
  wrist: Vec2
  thumbTip: Vec2
  indexTip: Vec2
  middleTip: Vec2
  velocity: Vec2
  pinchStrength: number
  isPinching: boolean
  trail: Vec2[]
}

export type VisionSnapshot = {
  participants: ParticipantTrack[]
  hands: HandTrack[]
  silhouetteStrength: number
  timestamp: number
}

export type TextEvent = {
  id: string
  speakerId: string | null
  text: string
  tokens: string[]
  emotion: EmotionProfile
  createdAt: number
}

export type GlyphParticle = {
  id: string
  speakerId: string | null
  glyph: string
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  glow: number
  polarity: EmotionPolarity
  intensity: number
  confidence: number
  grabbedBy?: string
}

export type SceneState = {
  participants: ParticipantTrack[]
  hands: HandTrack[]
  particles: GlyphParticle[]
  lastText: string
  lastEmotion: EmotionProfile | null
  silhouetteStrength: number
}
