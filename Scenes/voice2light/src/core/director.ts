import { createTextEvent, materializeText, stepParticles } from './materializer'
import type { EmotionAnalyzer } from './emotion'
import { SceneRenderer } from './renderer'
import type { EmotionProfile, GlyphParticle, HandTrack, ParticipantTrack, SceneState, VisionSnapshot } from '../types/scene'

type DirectorOptions = {
  renderer: SceneRenderer
  emotionAnalyzer: EmotionAnalyzer
  canvas: HTMLCanvasElement
  enableHandInteraction?: boolean
  maxParticles?: number
}

export class SceneDirector {
  private readonly renderer: SceneRenderer
  private readonly emotionAnalyzer: EmotionAnalyzer
  private readonly canvas: HTMLCanvasElement
  private readonly enableHandInteraction: boolean
  private readonly maxParticles: number

  private participants: ParticipantTrack[] = []
  private hands: HandTrack[] = []
  private particles: GlyphParticle[] = []
  private handGrabMap = new Map<string, string>()
  private lastText = ''
  private lastEmotion: EmotionProfile | null = null
  private lastFrameTimestamp = 0
  private running = false

  private textQueue: string[] = []
  private processingText = false

  constructor(options: DirectorOptions) {
    this.renderer = options.renderer
    this.emotionAnalyzer = options.emotionAnalyzer
    this.canvas = options.canvas
    this.enableHandInteraction = options.enableHandInteraction ?? false
    this.maxParticles = options.maxParticles ?? 900
  }

  start(): void {
    this.running = true
  }

  stop(): void {
    this.running = false
    this.textQueue = []
    this.handGrabMap.clear()
  }

  enqueueText(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    this.textQueue.push(trimmed)
    void this.processTextQueue()
  }

  onVisionFrame(snapshot: VisionSnapshot): void {
    if (!this.running) {
      return
    }

    this.participants = this.applyPrimarySpeakerSelection(snapshot.participants)
    this.hands = this.enableHandInteraction ? snapshot.hands : []

    const deltaMs = this.lastFrameTimestamp > 0 ? snapshot.timestamp - this.lastFrameTimestamp : 16
    this.lastFrameTimestamp = snapshot.timestamp

    this.particles = stepParticles(this.particles, {
      deltaMs: Math.max(1, deltaMs),
      hands: this.hands,
      width: this.canvas.clientWidth || this.canvas.width,
      height: this.canvas.clientHeight || this.canvas.height,
      handGrabMap: this.handGrabMap,
      enableHandInteraction: this.enableHandInteraction,
    })

    const width = this.canvas.clientWidth || this.canvas.width
    const height = this.canvas.clientHeight || this.canvas.height
    this.renderer.resize(width, height)

    const state: SceneState = {
      participants: this.participants,
      hands: this.hands,
      particles: this.particles,
      lastText: this.lastText,
      lastEmotion: this.lastEmotion,
      silhouetteStrength: snapshot.silhouetteStrength,
    }

    this.renderer.render(state, snapshot.timestamp)
  }

  getParticleCount(): number {
    return this.particles.length
  }

  private applyPrimarySpeakerSelection(participants: ParticipantTrack[]): ParticipantTrack[] {
    if (participants.length === 0) {
      return []
    }

    const existing = new Map(this.participants.map((participant) => [participant.id, participant]))
    const merged = participants.map((participant) => {
      const prev = existing.get(participant.id)
      const centerDistance = Math.hypot(participant.centroid.x - 0.5, participant.centroid.y - 0.5)
      const centerBonus = Math.max(0, 1 - centerDistance * 1.6)
      const continuityBonus = Math.min(1, participant.activeMs / 4500)
      const movement = Math.hypot(participant.velocity.x, participant.velocity.y)
      const stability = Math.max(0, 1 - movement * 7)
      const gain =
        participant.confidence * 0.45 + centerBonus * 0.3 + continuityBonus * 0.2 + stability * 0.05
      const score = (prev?.score ?? 0) * 0.9 + gain * 0.4

      return {
        ...participant,
        score,
        isPrimary: false,
      }
    })

    const ranked = [...merged].sort((a, b) => b.score - a.score)
    const primaryId = ranked[0]?.id ?? null

    return merged.map((participant) => ({
      ...participant,
      isPrimary: participant.id === primaryId,
    }))
  }

  private async processTextQueue(): Promise<void> {
    if (this.processingText || !this.running) {
      return
    }

    const nextText = this.textQueue.shift()
    if (!nextText) {
      return
    }

    this.processingText = true
    try {
      const emotion = await this.emotionAnalyzer.analyze(nextText)
      const primary = this.participants.find((participant) => participant.isPrimary) ?? null
      const event = createTextEvent(nextText, primary?.id ?? null, Date.now(), emotion)

      this.lastText = event.text
      this.lastEmotion = emotion

      const created = materializeText(
        event,
        primary,
        this.canvas.clientWidth || this.canvas.width,
        this.canvas.clientHeight || this.canvas.height,
      )
      this.particles.push(...created)
      if (this.particles.length > this.maxParticles) {
        this.particles = this.particles.slice(this.particles.length - this.maxParticles)
      }
    } finally {
      this.processingText = false
      if (this.textQueue.length > 0) {
        void this.processTextQueue()
      }
    }
  }
}
