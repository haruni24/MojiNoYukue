import type {
  EmotionProfile,
  GlyphParticle,
  HandTrack,
  ParticipantTrack,
  TextEvent,
  Vec2,
} from '../types/scene'

type ParticleStepOptions = {
  deltaMs: number
  hands: HandTrack[]
  width: number
  height: number
  handGrabMap: Map<string, string>
  enableHandInteraction: boolean
}

type SpawnMode = 'top' | 'bottom' | 'left' | 'right' | 'center'

export function tokenizeText(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return []
  }

  const sentenceChunks = normalized
    .split(/(?<=[。！？!?])/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
  if (sentenceChunks.length > 1) {
    return sentenceChunks
  }

  const commaChunks = normalized
    .split(/[、,，]/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
  if (commaChunks.length > 1) {
    return commaChunks
  }

  return [normalized]
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
  const particles: GlyphParticle[] = []
  const baseIntensity = 0.9 + event.emotion.intensity * 0.7

  event.tokens.forEach((token, tokenIndex) => {
    const copies = token.length > 14 ? 2 : 1
    for (let i = 0; i < copies; i += 1) {
      const spawnMode = pickSpawnMode()
      const spawn = pickSpawnPosition(spawnMode, width, height)
      const origin = speaker
        ? {
            x: spawn.x * 0.78 + speaker.centroid.x * width * 0.22,
            y: spawn.y * 0.82 + speaker.centroid.y * height * 0.18,
          }
        : spawn

      const velocity = pickInitialVelocity(spawnMode, baseIntensity)
      const spread = tokenIndex * 36 + i * 24

      particles.push({
        id: `${event.id}-${tokenIndex}-${i}-${Math.random().toString(16).slice(2)}`,
        speakerId: event.speakerId,
        glyph: token,
        x: origin.x + (Math.random() - 0.5) * Math.min(width * 0.26, 260),
        y: origin.y + (Math.random() - 0.5) * Math.min(height * 0.18, 170) - spread * 0.15,
        vx: velocity.x + (Math.random() - 0.5) * 12,
        vy: velocity.y + (Math.random() - 0.5) * 10,
        life: 0,
        maxLife: 9000 + Math.random() * 7000,
        size: 20 + Math.random() * 24 + token.length * 0.4,
        glow: 0.42 + event.emotion.intensity * 0.75 + Math.random() * 0.2,
        polarity: event.emotion.polarity,
        intensity: event.emotion.intensity,
        confidence: event.emotion.confidence,
      })
    }
  })

  return particles
}

export function stepParticles(particles: GlyphParticle[], options: ParticleStepOptions): GlyphParticle[] {
  const dt = Math.max(0.001, options.deltaMs / 1000)
  const nextParticles = particles.map((particle) => ({ ...particle, grabbedBy: undefined }))
  const particleById = new Map(nextParticles.map((particle) => [particle.id, particle]))

  if (options.enableHandInteraction) {
    releaseInvalidGrabs(options.hands, options.handGrabMap, particleById, options.width, options.height)
  } else if (options.handGrabMap.size > 0) {
    options.handGrabMap.clear()
  }

  applyAmbientMotion(nextParticles, dt, options.width, options.height)

  if (options.enableHandInteraction && options.hands.length > 0) {
    applyHandPush(nextParticles, options.hands, dt, options.width, options.height)
    applyHandGrab(nextParticles, options.hands, dt, options.width, options.height, options.handGrabMap)
  }

  const survived = nextParticles.filter((particle) => particle.life < particle.maxLife)
  const survivedIds = new Set(survived.map((particle) => particle.id))
  for (const [handId, particleId] of options.handGrabMap.entries()) {
    if (!survivedIds.has(particleId)) {
      options.handGrabMap.delete(handId)
    }
  }

  return survived
}

function applyAmbientMotion(particles: GlyphParticle[], dt: number, width: number, height: number): void {
  const wrapMargin = 180

  particles.forEach((particle) => {
    const lifeRatio = particle.life / particle.maxLife
    const seed = hash01(particle.id)
    const phase = lifeRatio * Math.PI * (1.6 + seed * 2.1)
    const wobbleX = Math.sin(phase * (1.2 + seed * 1.8) + seed * 16) * (6 + particle.intensity * 12)
    const wobbleY = Math.cos(phase * (1.1 + seed * 1.4) + seed * 10) * (4 + particle.intensity * 10)
    const spiral = (seed - 0.5) * 8

    const verticalBias =
      particle.polarity === 'positive'
        ? -2.8
        : particle.polarity === 'negative'
          ? 1.4
          : seed > 0.5
            ? -1.2
            : 1

    const damping = 0.993 - particle.intensity * 0.002
    particle.vx = particle.vx * damping + wobbleX * 0.9 + spiral * dt
    particle.vy = particle.vy * (damping + 0.001) + wobbleY * 0.8 + verticalBias * dt * 9

    particle.x += particle.vx * dt
    particle.y += particle.vy * dt

    // 画面外に出ても循環させることで、空間全体に漂っている感覚を維持する
    if (particle.x < -wrapMargin) {
      particle.x = width + wrapMargin * 0.4
    } else if (particle.x > width + wrapMargin) {
      particle.x = -wrapMargin * 0.4
    }

    if (particle.y < -wrapMargin) {
      particle.y = height + wrapMargin * 0.4
    } else if (particle.y > height + wrapMargin) {
      particle.y = -wrapMargin * 0.4
    }

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

function pickSpawnMode(): SpawnMode {
  const r = Math.random()
  if (r < 0.22) return 'top'
  if (r < 0.44) return 'bottom'
  if (r < 0.62) return 'left'
  if (r < 0.8) return 'right'
  return 'center'
}

function pickSpawnPosition(mode: SpawnMode, width: number, height: number): Vec2 {
  const marginX = width * 0.08
  const marginY = height * 0.08
  switch (mode) {
    case 'top':
      return { x: marginX + Math.random() * (width - marginX * 2), y: marginY + Math.random() * (height * 0.18) }
    case 'bottom':
      return {
        x: marginX + Math.random() * (width - marginX * 2),
        y: height - marginY - Math.random() * (height * 0.16),
      }
    case 'left':
      return { x: marginX + Math.random() * (width * 0.16), y: marginY + Math.random() * (height - marginY * 2) }
    case 'right':
      return {
        x: width - marginX - Math.random() * (width * 0.16),
        y: marginY + Math.random() * (height - marginY * 2),
      }
    case 'center':
    default:
      return {
        x: width * 0.2 + Math.random() * (width * 0.6),
        y: height * 0.2 + Math.random() * (height * 0.6),
      }
  }
}

function pickInitialVelocity(mode: SpawnMode, intensity: number): Vec2 {
  const speed = (14 + Math.random() * 42) * intensity
  switch (mode) {
    case 'top':
      return { x: (Math.random() - 0.5) * speed * 0.9, y: speed * (0.18 + Math.random() * 0.5) }
    case 'bottom':
      return { x: (Math.random() - 0.5) * speed * 0.9, y: -speed * (0.22 + Math.random() * 0.56) }
    case 'left':
      return { x: speed * (0.28 + Math.random() * 0.6), y: (Math.random() - 0.5) * speed * 0.8 }
    case 'right':
      return { x: -speed * (0.28 + Math.random() * 0.6), y: (Math.random() - 0.5) * speed * 0.8 }
    case 'center':
    default:
      return { x: (Math.random() - 0.5) * speed * 1.2, y: (Math.random() - 0.5) * speed * 1.1 }
  }
}

function hash01(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000000) / 1000000
}
