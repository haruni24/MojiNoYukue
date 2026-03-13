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

export type VisionSnapshot = {
  participants: ParticipantTrack[]
  silhouetteStrength: number
  segmentation: SegmentationFrame | null
  timestamp: number
}

export type SegmentationFrame = {
  alpha: Uint8ClampedArray
  width: number
  height: number
}

export type AudioMetrics = {
  rms: number
  speaking: boolean
  speakingMs: number
  timestamp: number
}

export type SpeechChunk = {
  id: string
  blob: Blob
  avgVolume: number
  durationMs: number
  createdAt: number
}

export type TranscriptEvent = {
  id: string
  speakerId: string | null
  text: string
  tokens: string[]
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
  hue: number
  glow: number
}

export type SpeechTrace = {
  id: string
  speakerId: string | null
  text: string
  anchor: Vec2
  life: number
  maxLife: number
  width: number
  height: number
  offset: Vec2
  seed: number
  intensity: number
}

export type SceneState = {
  participants: ParticipantTrack[]
  particles: GlyphParticle[]
  traces: SpeechTrace[]
  lastTranscript: string
  silhouetteStrength: number
  segmentation: SegmentationFrame | null
  videoFrame: HTMLVideoElement | null
  audioMetrics: AudioMetrics
}
