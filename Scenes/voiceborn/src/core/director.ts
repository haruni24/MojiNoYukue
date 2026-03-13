import { createTranscriptEvent, materializeSpeechTrace, stepSpeechTraces } from './materializer'
import { SceneRenderer } from './renderer'
import { transcribeWithOpenAI, type TranscriptConfig } from './transcript'
import type {
  AudioMetrics,
  GlyphParticle,
  ParticipantTrack,
  SceneState,
  SpeechTrace,
  SpeechChunk,
  VisionSnapshot,
} from '../types/scene'

type DirectorOptions = {
  renderer: SceneRenderer
  transcriptConfig: TranscriptConfig
  canvas: HTMLCanvasElement
  onTranscript?: (event: { text: string; speakerId: string | null; createdAt: number }) => void
  onTranscriptError?: (errorMessage: string) => void
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
  private readonly onTranscript?: (event: { text: string; speakerId: string | null; createdAt: number }) => void
  private readonly onTranscriptError?: (errorMessage: string) => void

  private participants: ParticipantTrack[] = []
  private particles: GlyphParticle[] = []
  private traces: SpeechTrace[] = []
  private lastTranscript = ''
  private audioMetrics: AudioMetrics = INITIAL_AUDIO_METRICS
  private lastFrameTimestamp = 0
  private running = false
  private sttDisabledUntil = 0
  private transcriptBuffer = ''
  private transcriptBufferSpeakerId: string | null = null
  private lastSpeakingAt = 0

  private transcriptQueue: SpeechChunk[] = []
  private processingTranscript = false

  constructor(options: DirectorOptions) {
    this.renderer = options.renderer
    this.transcriptConfig = options.transcriptConfig
    this.canvas = options.canvas
    this.onTranscript = options.onTranscript
    this.onTranscriptError = options.onTranscriptError
  }

  start(): void {
    this.running = true
  }

  stop(): void {
    this.running = false
    this.particles = []
    this.traces = []
    this.lastTranscript = ''
    this.lastFrameTimestamp = 0
    this.transcriptBuffer = ''
    this.transcriptBufferSpeakerId = null
    this.lastSpeakingAt = 0
  }

  onVisionFrame(snapshot: VisionSnapshot, videoFrame: HTMLVideoElement | null): void {
    if (!this.running) {
      return
    }

    this.participants = this.applyPrimarySpeakerSelection(snapshot.participants)
    const deltaMs = this.lastFrameTimestamp > 0 ? snapshot.timestamp - this.lastFrameTimestamp : 16
    this.lastFrameTimestamp = snapshot.timestamp

    this.traces = stepSpeechTraces(this.traces, this.participants, Math.max(1, deltaMs), this.audioMetrics.rms)

    this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight)
    const state: SceneState = {
      participants: this.participants,
      particles: this.particles,
      traces: this.traces,
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
      this.maybeFlushTranscriptBuffer(metrics.timestamp)
      this.participants = this.participants.map((participant) => ({
        ...participant,
        score: participant.score * 0.96,
      }))
      return
    }

    this.lastSpeakingAt = metrics.timestamp

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
      this.ingestTranscriptText(text, primary)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'transcription failed'
      console.error('[VOICEBORN][STT] error:', message)
      this.lastTranscript = `STT ERROR: ${message.slice(0, 100)}`
      this.onTranscriptError?.(message)
      this.sttDisabledUntil = Date.now() + 10_000
    } finally {
      this.processingTranscript = false
      if (this.transcriptQueue.length > 0) {
        void this.processTranscripts()
      }
    }
  }

  private ingestTranscriptText(text: string, primary: ParticipantTrack | null): void {
    const normalized = this.normalizeTranscript(text)
    if (!normalized) {
      return
    }

    if (!this.transcriptBuffer) {
      this.transcriptBufferSpeakerId = primary?.id ?? null
    }

    this.transcriptBuffer = this.mergeTranscriptBuffer(this.transcriptBuffer, normalized)
    const extracted = this.extractReadySegments(this.transcriptBuffer, false)
    this.transcriptBuffer = extracted.rest
    extracted.ready.forEach((segment) => {
      this.emitTranscriptSegment(segment, primary)
    })

    if (!this.transcriptBuffer) {
      this.transcriptBufferSpeakerId = null
    }
  }

  private maybeFlushTranscriptBuffer(now: number): void {
    if (!this.transcriptBuffer) {
      return
    }

    const silenceMs = this.lastSpeakingAt > 0 ? now - this.lastSpeakingAt : Infinity
    if (silenceMs < 1200) {
      return
    }

    const shouldForceFlush = silenceMs >= 2800
    const looksComplete = this.looksSentenceComplete(this.transcriptBuffer)
    if (!shouldForceFlush && !looksComplete) {
      return
    }

    this.flushTranscriptBuffer(shouldForceFlush)
  }

  private flushTranscriptBuffer(forceTail = true): void {
    const pending = this.transcriptBuffer.trim()
    if (!pending) {
      return
    }

    const speaker = this.transcriptBufferSpeakerId
      ? this.participants.find((participant) => participant.id === this.transcriptBufferSpeakerId) ?? null
      : this.participants.find((participant) => participant.isPrimary) ?? null
    const extracted = this.extractReadySegments(pending, forceTail)

    extracted.ready.forEach((segment) => {
      this.emitTranscriptSegment(segment, speaker)
    })

    this.transcriptBuffer = extracted.rest
    if (!this.transcriptBuffer) {
      this.transcriptBufferSpeakerId = null
    }
  }

  private emitTranscriptSegment(text: string, primary: ParticipantTrack | null): void {
    const event = createTranscriptEvent(text, primary?.id ?? null, Date.now())
    this.lastTranscript = event.text
    this.onTranscript?.({
      text: event.text,
      speakerId: event.speakerId,
      createdAt: event.createdAt,
    })

    const trace = materializeSpeechTrace(
      event,
      primary,
      this.canvas.clientWidth || this.canvas.width,
      this.canvas.clientHeight || this.canvas.height,
    )

    this.traces.push(trace)
    if (this.traces.length > 12) {
      this.traces = this.traces.slice(this.traces.length - 12)
    }
  }

  private normalizeTranscript(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[「」]/g, '')
      .replace(/([。！？!?])\1+/g, '$1')
      .trim()
  }

  private mergeTranscriptBuffer(existing: string, incoming: string): string {
    if (!existing) {
      return incoming
    }

    if (existing === incoming || existing.endsWith(incoming)) {
      return existing
    }

    if (incoming.startsWith(existing)) {
      return incoming
    }

    const maxOverlap = Math.min(existing.length, incoming.length)
    for (let overlap = maxOverlap; overlap >= 4; overlap -= 1) {
      if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
        return `${existing}${incoming.slice(overlap)}`.trim()
      }
    }

    return `${existing}${incoming}`.trim()
  }

  private extractReadySegments(
    text: string,
    forceTail: boolean,
  ): { ready: string[]; rest: string } {
    const segments = text.match(/[^。！？!?]+[。！？!?]?/g) ?? []
    const ready: string[] = []
    let rest = ''

    segments.forEach((segment, index) => {
      const trimmed = segment.trim()
      if (!trimmed) {
        return
      }

      const isLast = index === segments.length - 1
      if (!isLast) {
        ready.push(trimmed)
        return
      }

      if (/[。！？!?]$/.test(trimmed)) {
        ready.push(trimmed)
        return
      }

      if (forceTail || this.looksSentenceComplete(trimmed)) {
        ready.push(trimmed)
        return
      }

      rest = trimmed
    })

    return { ready, rest }
  }

  private looksSentenceComplete(text: string): boolean {
    const normalized = text.trim()
    if (!normalized) {
      return false
    }

    if (/[。！？!?]$/.test(normalized)) {
      return true
    }

    return /(です|ます|でした|ました|ません|ないです|たいです|だよ|だね|ですよ|ですね|かも|かな|だろう|でしょう|と思う|と思います|ください|ですか|ますか|だった|なんです|んです)$/.test(
      normalized,
    )
  }
}
