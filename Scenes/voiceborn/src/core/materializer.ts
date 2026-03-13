import type { GlyphParticle, ParticipantTrack, SpeechTrace, TranscriptEvent, Vec2 } from '../types/scene'

const JA_SEGMENTER =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('ja-JP', { granularity: 'word' })
    : null

export function tokenizeTranscript(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  if (JA_SEGMENTER) {
    const segments = Array.from(JA_SEGMENTER.segment(trimmed))
      .map((segment) => segment.segment.trim())
      .filter((segment) => segment.length > 0)

    if (segments.length > 0) {
      return segments
    }
  }

  if (trimmed.includes(' ')) {
    return trimmed.split(/\s+/).filter(Boolean)
  }

  return Array.from(trimmed)
}

export function createTranscriptEvent(
  text: string,
  speakerId: string | null,
  createdAt: number,
): TranscriptEvent {
  return {
    id: crypto.randomUUID(),
    speakerId,
    text,
    tokens: tokenizeTranscript(text),
    createdAt,
  }
}

function resolveAnchor(speaker: ParticipantTrack | null): Vec2 {
  if (speaker && speaker.landmarks.length > 0) {
    const nose = speaker.landmarks[0]
    const leftShoulder = speaker.landmarks[11]
    const rightShoulder = speaker.landmarks[12]

    if (nose && (nose.visibility ?? 0) > 0.35) {
      return {
        x: nose.x,
        y: Math.max(0.06, nose.y - 0.035),
      }
    }

    if (leftShoulder && rightShoulder) {
      return {
        x: (leftShoulder.x + rightShoulder.x) * 0.5,
        y: Math.max(0.08, Math.min(leftShoulder.y, rightShoulder.y) - 0.08),
      }
    }
  }

  return speaker
    ? {
        x: speaker.centroid.x,
        y: Math.max(0.08, speaker.centroid.y - 0.08),
      }
    : {
        x: 0.35 + Math.random() * 0.3,
        y: 0.3 + Math.random() * 0.18,
      }
}

export function materializeTranscript(
  event: TranscriptEvent,
  speaker: ParticipantTrack | null,
  width: number,
  height: number,
): GlyphParticle[] {
  const originX = speaker ? speaker.centroid.x * width : width * (0.35 + Math.random() * 0.3)
  const originY = speaker ? speaker.centroid.y * height : height * (0.45 + Math.random() * 0.2)
  const densityMultiplier = speaker?.isPrimary ? 1 : 0.6
  const particles: GlyphParticle[] = []

  event.tokens.forEach((token, tokenIndex) => {
    const glyphs = Array.from(token)
    glyphs.forEach((glyph, glyphIndex) => {
      const baseAngle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.1
      const speed = 12 + Math.random() * 48
      const spread = (tokenIndex * 16) + glyphIndex * 7
      particles.push({
        id: `${event.id}-${tokenIndex}-${glyphIndex}-${Math.random().toString(16).slice(2)}`,
        speakerId: event.speakerId,
        glyph,
        x: originX + (Math.random() - 0.5) * 30,
        y: originY - 40 - spread,
        vx: Math.cos(baseAngle) * speed,
        vy: Math.sin(baseAngle) * speed,
        life: 0,
        maxLife: 6000 + Math.random() * 6000,
        size: (20 + Math.random() * 22) * densityMultiplier,
        hue: 170 + Math.random() * 120,
        glow: 0.5 + Math.random() * 0.6,
      })
    })
  })

  return particles
}

export function materializeSpeechTrace(
  event: TranscriptEvent,
  speaker: ParticipantTrack | null,
  width: number,
  _height: number,
): SpeechTrace {
  const anchor = resolveAnchor(speaker)
  const compact = event.text.replace(/\s+/g, ' ').trim()
  const textLength = compact.length
  const bubbleWidth = Math.min(width * 0.44, Math.max(260, 180 + textLength * 11))
  const estimatedLines = Math.max(1, Math.ceil(textLength / 16))
  const bubbleHeight = 62 + Math.min(5, estimatedLines - 1) * 24

  return {
    id: event.id,
    speakerId: event.speakerId,
    text: compact,
    anchor,
    life: 0,
    maxLife: 7200 + Math.random() * 2600,
    width: bubbleWidth,
    height: bubbleHeight,
    offset: {
      x: 0,
      y: 0,
    },
    seed: Math.random() * Math.PI * 2,
    intensity: speaker?.isPrimary ? 1 : 0.72,
  }
}

export function stepParticles(particles: GlyphParticle[], deltaMs: number, audioRms: number): GlyphParticle[] {
  const dt = deltaMs / 1000
  const turbulence = 14 + audioRms * 220

  return particles
    .map((particle) => {
      const phase = (particle.life / particle.maxLife) * Math.PI * 2
      const wobbleX = Math.sin(phase * 1.6 + particle.hue) * turbulence * 0.02
      const wobbleY = Math.cos(phase * 1.2 + particle.hue * 0.2) * turbulence * 0.015

      const vx = particle.vx * 0.988 + wobbleX
      const vy = particle.vy * 0.992 + wobbleY - 3.5 * dt

      return {
        ...particle,
        x: particle.x + vx * dt,
        y: particle.y + vy * dt,
        vx,
        vy,
        life: particle.life + deltaMs,
      }
    })
    .filter((particle) => particle.life < particle.maxLife)
}

export function stepSpeechTraces(
  traces: SpeechTrace[],
  participants: ParticipantTrack[],
  deltaMs: number,
  audioRms: number,
): SpeechTrace[] {
  const dt = deltaMs / 1000
  const participantMap = new Map(participants.map((participant) => [participant.id, participant]))

  return traces
    .map((trace) => {
      const speaker = trace.speakerId ? participantMap.get(trace.speakerId) ?? null : null
      const target = speaker
        ? resolveAnchor(speaker)
        : trace.anchor

      const follow = Math.min(1, dt * (speaker ? 4.2 : 0.9))
      const intensityTarget = (speaker?.isPrimary ? 1 : 0.75) + audioRms * 0.25

      return {
        ...trace,
        anchor: {
          x: trace.anchor.x + (target.x - trace.anchor.x) * follow,
          y: trace.anchor.y + (target.y - trace.anchor.y) * follow,
        },
        intensity: trace.intensity + (intensityTarget - trace.intensity) * Math.min(1, dt * 1.8),
        offset: {
          x: Math.sin(trace.life * 0.001 + trace.seed) * 4,
          y: Math.cos(trace.life * 0.0013 + trace.seed * 0.7) * 3,
        },
        life: trace.life + deltaMs,
      }
    })
    .filter((trace) => trace.life < trace.maxLife)
}
