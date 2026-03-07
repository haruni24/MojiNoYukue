import type {
  EmotionProfile,
  GlyphParticle,
  HandTrack,
  ParticipantTrack,
  TextEvent,
  Vec2,
} from '../types/scene'

const JA_SEGMENTER =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('ja-JP', { granularity: 'word' })
    : null

type ParticleStepOptions = {
  deltaMs: number
  hands: HandTrack[]
  width: number
  height: number
  handGrabMap: Map<string, string>
}

export function tokenizeText(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  if (JA_SEGMENTER) {
    const segmented = Array.from(JA_SEGMENTER.segment(trimmed))
      .map((item) => item.segment.trim())
      .filter((item) => item.length > 0)
    if (segmented.length > 0) {
      return segmented
    }
  }

  if (trimmed.includes(' ')) {
    return trimmed.split(/\s+/).filter(Boolean)
  }

  return Array.from(trimmed)
}

export function createTextEvent(
  text: string,
  speakerId: string | null,
  createdAt: number,
  emotion: EmotionProfile,
): TextEvent {
  return {
    id: crypto.randomUUID(),
    speakerId,
    text,
    tokens: tokenizeText(text),
    emotion,
    createdAt,
  }
}

export function materializeText(
  event: TextEvent,
  speaker: ParticipantTrack | null,
  width: number,
  height: number,
): GlyphParticle[] {
  const originX = speaker ? speaker.centroid.x * width : width * (0.35 + Math.random() * 0.3)
  const originY = speaker ? speaker.centroid.y * height : height * (0.45 + Math.random() * 0.24)
  const densityMultiplier = speaker?.isPrimary ? 1 : 0.7
  const intensityBoost = 0.8 + event.emotion.intensity * 0.7

  const particles: GlyphParticle[] = []

  event.tokens.forEach((token, tokenIndex) => {
    const glyphs = Array.from(token)
    glyphs.forEach((glyph, glyphIndex) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.25
      const speed = (20 + Math.random() * 54) * intensityBoost
      const spread = tokenIndex * 18 + glyphIndex * 8

      particles.push({
        id: `${event.id}-${tokenIndex}-${glyphIndex}-${Math.random().toString(16).slice(2)}`,
        speakerId: event.speakerId,
        glyph,
        x: originX + (Math.random() - 0.5) * 48,
        y: originY - 36 - spread,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 3200 + Math.random() * 2200,
        size: (18 + Math.random() * 26) * densityMultiplier * (0.9 + event.emotion.intensity * 0.48),
        glow: 0.65 + event.emotion.intensity * 1.1 + Math.random() * 0.35,
        polarity: event.emotion.polarity,
        intensity: event.emotion.intensity,
        confidence: event.emotion.confidence,
      })
    })
  })

  return particles
}

export function stepParticles(particles: GlyphParticle[], options: ParticleStepOptions): GlyphParticle[] {
  const dt = Math.max(0.001, options.deltaMs / 1000)
  const nextParticles = particles.map((particle) => ({ ...particle, grabbedBy: undefined }))
  const particleById = new Map(nextParticles.map((particle) => [particle.id, particle]))

  releaseInvalidGrabs(options.hands, options.handGrabMap, particleById, options.width, options.height)
  applyAmbientMotion(nextParticles, dt)
  applyHandPush(nextParticles, options.hands, dt, options.width, options.height)
  applyHandGrab(nextParticles, options.hands, dt, options.width, options.height, options.handGrabMap)

  const survived = nextParticles.filter((particle) => particle.life < particle.maxLife)
  const survivedIds = new Set(survived.map((particle) => particle.id))

  for (const [handId, particleId] of options.handGrabMap.entries()) {
    if (!survivedIds.has(particleId)) {
      options.handGrabMap.delete(handId)
    }
  }

  return survived
}

function applyAmbientMotion(particles: GlyphParticle[], dt: number): void {
  particles.forEach((particle) => {
    const lifeRatio = particle.life / particle.maxLife
    const phase = lifeRatio * Math.PI * 2.2
    const turbulence = 17 + particle.intensity * 35
    const wobbleX = Math.sin(phase * 1.9 + particle.size * 0.08) * turbulence * 0.018
    const wobbleY = Math.cos(phase * 1.4 + particle.glow * 1.6) * turbulence * 0.014

    const emotionLift = particle.polarity === 'positive' ? -3.4 : particle.polarity === 'negative' ? 1.3 : -1.2
    const damping = 0.986 - particle.intensity * 0.01

    particle.vx = particle.vx * damping + wobbleX
    particle.vy = particle.vy * (damping + 0.002) + wobbleY + emotionLift * dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.life += dt * 1000
  })
}

function applyHandPush(
  particles: GlyphParticle[],
  hands: HandTrack[],
  dt: number,
  width: number,
  height: number,
): void {
  const pushRadius = Math.min(width, height) * 0.14

  hands.forEach((hand) => {
    const center = handCenterPx(hand, width, height)

    particles.forEach((particle) => {
      const dx = particle.x - center.x
      const dy = particle.y - center.y
      const distance = Math.hypot(dx, dy)
      if (distance <= 0.001 || distance > pushRadius) {
        return
      }

      const normalized = 1 - distance / pushRadius
      const strength = (hand.isPinching ? 58 : 108) * normalized
      particle.vx += (dx / distance) * strength * dt
      particle.vy += (dy / distance) * strength * dt
    })
  })
}

function applyHandGrab(
  particles: GlyphParticle[],
  hands: HandTrack[],
  dt: number,
  width: number,
  height: number,
  handGrabMap: Map<string, string>,
): void {
  const usedParticles = new Set<string>()

  hands.forEach((hand) => {
    const pinchTarget = pinchTargetPx(hand, width, height)
    const currentGrabId = handGrabMap.get(hand.id)

    if (!hand.isPinching) {
      if (currentGrabId) {
        const released = particles.find((particle) => particle.id === currentGrabId)
        if (released) {
          released.vx += hand.velocity.x * width * 20
          released.vy += hand.velocity.y * height * 20
        }
        handGrabMap.delete(hand.id)
      }
      return
    }

    let activeParticle = currentGrabId ? particles.find((particle) => particle.id === currentGrabId) : undefined
    if (!activeParticle) {
      activeParticle = findNearestParticle(particles, pinchTarget, usedParticles, Math.min(width, height) * 0.16)
      if (!activeParticle) {
        handGrabMap.delete(hand.id)
        return
      }
      handGrabMap.set(hand.id, activeParticle.id)
    }

    usedParticles.add(activeParticle.id)
    activeParticle.grabbedBy = hand.id
    activeParticle.life = Math.max(0, activeParticle.life - dt * 520)

    const spring = 22
    const damping = 0.86
    activeParticle.vx = activeParticle.vx * damping + (pinchTarget.x - activeParticle.x) * spring * dt
    activeParticle.vy = activeParticle.vy * damping + (pinchTarget.y - activeParticle.y) * spring * dt
    activeParticle.x += activeParticle.vx * dt * 0.9
    activeParticle.y += activeParticle.vy * dt * 0.9
  })
}

function releaseInvalidGrabs(
  hands: HandTrack[],
  handGrabMap: Map<string, string>,
  particleById: Map<string, GlyphParticle>,
  width: number,
  height: number,
): void {
  const handById = new Map(hands.map((hand) => [hand.id, hand]))
  for (const [handId, particleId] of handGrabMap.entries()) {
    const hand = handById.get(handId)
    const particle = particleById.get(particleId)
    if (!hand || !particle) {
      handGrabMap.delete(handId)
      continue
    }
    if (hand.isPinching) {
      continue
    }
    particle.vx += hand.velocity.x * width * 18
    particle.vy += hand.velocity.y * height * 18
    handGrabMap.delete(handId)
  }
}

function findNearestParticle(
  particles: GlyphParticle[],
  target: Vec2,
  usedIds: Set<string>,
  maxDistance: number,
): GlyphParticle | undefined {
  let best: GlyphParticle | undefined
  let bestDistance = maxDistance

  particles.forEach((particle) => {
    if (usedIds.has(particle.id) || particle.grabbedBy) {
      return
    }

    const distance = Math.hypot(particle.x - target.x, particle.y - target.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = particle
    }
  })

  return best
}

function handCenterPx(hand: HandTrack, width: number, height: number): Vec2 {
  return {
    x: ((hand.indexTip.x + hand.middleTip.x + hand.wrist.x) / 3) * width,
    y: ((hand.indexTip.y + hand.middleTip.y + hand.wrist.y) / 3) * height,
  }
}

function pinchTargetPx(hand: HandTrack, width: number, height: number): Vec2 {
  return {
    x: ((hand.indexTip.x + hand.thumbTip.x) * 0.5) * width,
    y: ((hand.indexTip.y + hand.thumbTip.y) * 0.5) * height,
  }
}
