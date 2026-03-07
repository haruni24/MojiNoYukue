import { createTranscriptEvent, materializeTranscript, stepParticles } from './materializer'
import { SceneRenderer } from './renderer'
import { transcribeWithOpenAI, type TranscriptConfig } from './transcript'
import type {
  AudioMetrics,
  GlyphParticle,
  ParticipantTrack,
  SceneState,
  SpeechChunk,
  VisionSnapshot,
} from '../types/scene'

type DirectorOptions = {
  renderer: SceneRenderer
  transcriptConfig: TranscriptConfig
  canvas: HTMLCanvasElement
}

const INITIAL_AUDIO_METRICS: AudioMetrics = {
  rms: 0,
  speaking: false,
  speakingMs: 0,
  timestamp: 0,
}

export class SceneDirector {
  private readonly renderer: SceneRenderer
  private readonly transcriptConfig: TranscriptConfig
  private readonly canvas: HTMLCanvasElement

  private participants: ParticipantTrack[] = []
  private particles: GlyphParticle[] = []
  private lastTranscript = ''
  private audioMetrics: AudioMetrics = INITIAL_AUDIO_METRICS
  private lastFrameTimestamp = 0
  private running = false
  private sttDisabledUntil = 0

  private transcriptQueue: SpeechChunk[] = []
  private processingTranscript = false

  constructor(options: DirectorOptions) {
    this.renderer = options.renderer
    this.transcriptConfig = options.transcriptConfig
    this.canvas = options.canvas
  }

  start(): void {
    this.running = true
  }

  stop(): void {
    this.running = false
  }

  onVisionFrame(snapshot: VisionSnapshot, videoFrame: HTMLVideoElement | null): void {
    if (!this.running) {
      return
    }

    this.participants = this.applyPrimarySpeakerSelection(snapshot.participants)
    const deltaMs = this.lastFrameTimestamp > 0 ? snapshot.timestamp - this.lastFrameTimestamp : 16
    this.lastFrameTimestamp = snapshot.timestamp

    this.particles = stepParticles(this.particles, Math.max(1, deltaMs), this.audioMetrics.rms)

    this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight)
    const state: SceneState = {
      participants: this.participants,
      particles: this.particles,
      lastTranscript: this.lastTranscript,
      silhouetteStrength: snapshot.silhouetteStrength,
      segmentation: snapshot.segmentation,
      videoFrame,
      audioMetrics: this.audioMetrics,
    }

    this.renderer.render(state, snapshot.timestamp)
  }

  onAudioMetrics(metrics: AudioMetrics): void {
    this.audioMetrics = metrics
    if (!metrics.speaking) {
      this.participants = this.participants.map((participant) => ({
        ...participant,
        score: participant.score * 0.96,
      }))
      return
    }

    this.participants = this.participants.map((participant) => {
      const centerDistance = Math.hypot(participant.centroid.x - 0.5, participant.centroid.y - 0.5)
      const centerBonus = Math.max(0, 1 - centerDistance * 1.6)
      const continuityBonus = Math.min(1, participant.activeMs / 4000)
      const gain = (metrics.rms * 1.2 + continuityBonus * 0.5 + centerBonus * 0.3) * 0.35

      return {
        ...participant,
        score: participant.score * 0.92 + gain,
      }
    })

    const ranked = [...this.participants].sort((a, b) => b.score - a.score)
    const primaryId = ranked[0]?.id ?? null
    this.participants = this.participants.map((participant) => ({
      ...participant,
      isPrimary: participant.id === primaryId,
    }))
  }

  enqueueSpeech(chunk: SpeechChunk): void {
    if (Date.now() < this.sttDisabledUntil) {
      return
    }
    this.transcriptQueue.push(chunk)
    void this.processTranscripts()
  }

  private applyPrimarySpeakerSelection(participants: ParticipantTrack[]): ParticipantTrack[] {
    if (participants.length === 0) {
      return []
    }

    const existing = new Map(this.participants.map((p) => [p.id, p]))
    const merged = participants.map((participant) => {
      const prev = existing.get(participant.id)
      return {
        ...participant,
        score: prev?.score ?? 0,
        isPrimary: prev?.isPrimary ?? false,
      }
    })

    const ranked = [...merged].sort((a, b) => b.score - a.score)
    const primaryId = ranked[0]?.id ?? null

    return merged.map((participant) => ({
      ...participant,
      isPrimary: participant.id === primaryId,
    }))
  }

  private async processTranscripts(): Promise<void> {
    if (this.processingTranscript) {
      return
    }

    const next = this.transcriptQueue.shift()
    if (!next) {
      return
    }

    this.processingTranscript = true

    try {
      const text = await transcribeWithOpenAI(next.blob, this.transcriptConfig)
      if (!text) {
        return
      }
      console.info('[VOICEBORN][STT] transcript:', text)

      const primary = this.participants.find((participant) => participant.isPrimary) ?? null
      const event = createTranscriptEvent(text, primary?.id ?? null, Date.now())
      this.lastTranscript = event.text

      const created = materializeTranscript(
        event,
        primary,
        this.canvas.clientWidth || this.canvas.width,
        this.canvas.clientHeight || this.canvas.height,
      )

      this.particles.push(...created)
      if (this.particles.length > 1800) {
        this.particles = this.particles.slice(this.particles.length - 1800)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'transcription failed'
      console.error('[VOICEBORN][STT] error:', message)
      this.lastTranscript = `STT ERROR: ${message.slice(0, 100)}`
      this.sttDisabledUntil = Date.now() + 10_000
    } finally {
      this.processingTranscript = false
      if (this.transcriptQueue.length > 0) {
        void this.processTranscripts()
      }
    }
  }
}
