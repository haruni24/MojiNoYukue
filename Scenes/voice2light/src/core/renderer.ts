import type { GlyphParticle, HandTrack, ParticipantTrack, SceneState } from '../types/scene'

const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
]

export class SceneRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('2D canvas context not available')
    }

    this.canvas = canvas
    this.ctx = context
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  render(state: SceneState, timestamp: number): void {
    const { width, height } = this.canvas
    const ctx = this.ctx

    this.drawBackground(width, height, state.silhouetteStrength, timestamp)
    this.drawParticipants(state.participants, width, height)
    this.drawHands(state.hands, width, height)
    this.drawParticles(state.particles)
    this.drawSubtitle(state, width, height)

    ctx.globalCompositeOperation = 'source-over'
  }

  private drawBackground(width: number, height: number, silhouetteStrength: number, timestamp: number): void {
    const ctx = this.ctx
    const t = timestamp * 0.00011

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#060713')
    gradient.addColorStop(0.48, '#090717')
    gradient.addColorStop(1, '#04040d')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    const fog = 0.1 + silhouetteStrength * 0.38
    for (let i = 0; i < 5; i += 1) {
      const radius = 220 + i * 150 + (Math.sin(t * 1.8 + i) + 1) * 65
      const x = width * (0.12 + i * 0.2) + Math.sin(t * 1.3 + i * 1.8) * 80
      const y = height * (0.24 + (i % 3) * 0.2) + Math.cos(t * 1.5 + i * 1.2) * 52
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      glow.addColorStop(0, `rgba(199, 172, 255, ${fog})`)
      glow.addColorStop(0.45, `rgba(146, 103, 255, ${fog * 0.35})`)
      glow.addColorStop(1, 'rgba(2, 5, 12, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, width, height)
    }
  }

  private drawParticipants(participants: ParticipantTrack[], width: number, height: number): void {
    const ctx = this.ctx

    participants.forEach((participant) => {
      const px = participant.centroid.x * width
      const py = participant.centroid.y * height
      const radius = participant.isPrimary ? 120 : 92

      const aura = ctx.createRadialGradient(px, py, 0, px, py, radius)
      aura.addColorStop(0, participant.isPrimary ? 'rgba(244, 244, 255, 0.16)' : 'rgba(174, 138, 255, 0.1)')
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = aura
      ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2)

      ctx.strokeStyle = participant.isPrimary
        ? `rgba(238, 245, 255, ${0.2 + participant.confidence * 0.34})`
        : `rgba(172, 129, 255, ${0.14 + participant.confidence * 0.3})`
      ctx.lineWidth = participant.isPrimary ? 1.9 : 1.1

      POSE_CONNECTIONS.forEach(([from, to]) => {
        const a = participant.landmarks[from]
        const b = participant.landmarks[to]
        if (!a || !b || a.visibility < 0.35 || b.visibility < 0.35) {
          return
        }
        ctx.beginPath()
        ctx.moveTo(a.x * width, a.y * height)
        ctx.lineTo(b.x * width, b.y * height)
        ctx.stroke()
      })
    })
  }

  private drawHands(hands: HandTrack[], width: number, height: number): void {
    const ctx = this.ctx

    hands.forEach((hand) => {
      const wristX = hand.wrist.x * width
      const wristY = hand.wrist.y * height
      const indexX = hand.indexTip.x * width
      const indexY = hand.indexTip.y * height
      const middleX = hand.middleTip.x * width
      const middleY = hand.middleTip.y * height
      const thumbX = hand.thumbTip.x * width
      const thumbY = hand.thumbTip.y * height

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'

      if (hand.trail.length > 1) {
        ctx.beginPath()
        ctx.lineWidth = 2.8 + hand.pinchStrength * 2.2
        for (let i = 0; i < hand.trail.length; i += 1) {
          const t = hand.trail[i]
          const x = t.x * width
          const y = t.y * height
          if (i === 0) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
        }
        ctx.strokeStyle = 'rgba(206, 189, 255, 0.34)'
        ctx.shadowBlur = 16
        ctx.shadowColor = 'rgba(215, 200, 255, 0.6)'
        ctx.stroke()
      }

      const palmRadius = 52 + hand.pinchStrength * 30
      const palm = ctx.createRadialGradient(wristX, wristY, 0, wristX, wristY, palmRadius)
      palm.addColorStop(0, `rgba(245, 248, 255, ${0.24 + hand.pinchStrength * 0.22})`)
      palm.addColorStop(1, 'rgba(167, 120, 255, 0)')
      ctx.fillStyle = palm
      ctx.fillRect(wristX - palmRadius, wristY - palmRadius, palmRadius * 2, palmRadius * 2)

      drawFingerBloom(ctx, indexX, indexY, 24 + hand.pinchStrength * 14)
      drawFingerBloom(ctx, middleX, middleY, 20 + hand.pinchStrength * 11)
      drawFingerBloom(ctx, thumbX, thumbY, 19 + hand.pinchStrength * 12)

      if (hand.isPinching) {
        ctx.beginPath()
        ctx.moveTo(indexX, indexY)
        ctx.lineTo(thumbX, thumbY)
        ctx.lineWidth = 1.8
        ctx.strokeStyle = 'rgba(246, 249, 255, 0.64)'
        ctx.shadowBlur = 14
        ctx.shadowColor = 'rgba(242, 245, 255, 0.82)'
        ctx.stroke()
      }

      ctx.restore()
    })
  }

  private drawParticles(particles: GlyphParticle[]): void {
    const ctx = this.ctx
    ctx.textBaseline = 'alphabetic'

    particles.forEach((particle) => {
      const lifeRatio = particle.life / particle.maxLife
      const baseAlpha = Math.max(0, 1 - lifeRatio)
      const alpha = baseAlpha * (0.34 + particle.intensity * 0.62)
      if (alpha <= 0.01) {
        return
      }

      const style = resolveParticleStyle(particle, alpha)

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.shadowBlur = style.blur
      ctx.shadowColor = style.shadow
      ctx.fillStyle = style.fill
      ctx.font = `${style.weight} ${style.size.toFixed(0)}px 'Noto Sans JP', 'Hiragino Sans', sans-serif`
      ctx.fillText(particle.glyph, particle.x, particle.y)
      ctx.restore()
    })
  }

  private drawSubtitle(state: SceneState, width: number, height: number): void {
    if (!state.lastText) {
      return
    }

    const ctx = this.ctx
    const color =
      state.lastEmotion?.polarity === 'negative'
        ? 'rgba(220, 186, 255, 0.72)'
        : state.lastEmotion?.polarity === 'positive'
          ? 'rgba(242, 247, 255, 0.76)'
          : 'rgba(218, 209, 255, 0.68)'

    ctx.save()
    ctx.font = "500 18px 'Noto Sans JP', 'Hiragino Sans', sans-serif"
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(state.lastText, width / 2, height - 26)
    ctx.textAlign = 'left'
    ctx.restore()
  }
}

function drawFingerBloom(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
  glow.addColorStop(0, 'rgba(250, 252, 255, 0.42)')
  glow.addColorStop(1, 'rgba(176, 136, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

function resolveParticleStyle(
  particle: GlyphParticle,
  alpha: number,
): { fill: string; shadow: string; blur: number; size: number; weight: number } {
  const grabbedBoost = particle.grabbedBy ? 1.2 : 1
  const baseSize = particle.size * (0.96 + particle.intensity * 0.2) * grabbedBoost
  const blur = (9 + particle.glow * 11 + particle.intensity * 20) * grabbedBoost
  const weight = particle.grabbedBy ? 650 : 560

  if (particle.polarity === 'positive') {
    return {
      fill: `rgba(244, 248, 255, ${Math.min(1, alpha * 0.98)})`,
      shadow: `rgba(239, 246, 255, ${Math.min(1, alpha * 1.18)})`,
      blur,
      size: baseSize,
      weight,
    }
  }

  if (particle.polarity === 'negative') {
    return {
      fill: `rgba(212, 176, 255, ${Math.min(1, alpha * 0.95)})`,
      shadow: `rgba(185, 115, 255, ${Math.min(1, alpha * 1.22)})`,
      blur,
      size: baseSize,
      weight,
    }
  }

  return {
    fill: `rgba(226, 213, 255, ${Math.min(1, alpha * 0.85)})`,
    shadow: `rgba(204, 167, 255, ${Math.min(1, alpha * 1.08)})`,
    blur,
    size: baseSize,
    weight,
  }
}
