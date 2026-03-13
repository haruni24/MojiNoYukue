import type { GlyphParticle, ParticipantTrack, TranscriptEvent } from '../types/scene'

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
