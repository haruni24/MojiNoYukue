import type { GlyphParticle, HandTrack, SceneState } from '../types/scene'

export class SceneRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly showHands: boolean

  constructor(canvas: HTMLCanvasElement, options?: { showHands?: boolean }) {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('2D canvas context not available')
    }

    this.canvas = canvas
    this.ctx = context
    this.showHands = options?.showHands ?? false
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
    if (this.showHands) {
      this.drawHands(state.hands, width, height)
    }
    this.drawParticles(state.particles, width, height)
    this.drawSubtitle(state, width, height)

    ctx.globalCompositeOperation = 'source-over'
  }

  private drawBackground(width: number, height: number, silhouetteStrength: number, timestamp: number): void {
    const ctx = this.ctx
    const t = timestamp * 0.00009

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#000000')
    gradient.addColorStop(0.5, '#030303')
    gradient.addColorStop(1, '#000000')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    const fog = 0.06 + silhouetteStrength * 0.2
    for (let i = 0; i < 4; i += 1) {
      const radius = 240 + i * 190 + (Math.sin(t * 1.4 + i) + 1) * 48
      const x = width * (0.16 + i * 0.21) + Math.sin(t * 1.2 + i * 1.7) * 54
      const y = height * (0.22 + (i % 2) * 0.33) + Math.cos(t * 1.1 + i * 1.4) * 42
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      glow.addColorStop(0, `rgba(255, 255, 255, ${fog})`)
      glow.addColorStop(0.5, `rgba(220, 220, 220, ${fog * 0.22})`)
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, width, height)
    }
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

  private drawParticles(particles: GlyphParticle[], width: number, height: number): void {
    const ctx = this.ctx
    ctx.textBaseline = 'alphabetic'
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    particles.forEach((particle) => {
      if (particle.x < -300 || particle.x > width + 300 || particle.y < -220 || particle.y > height + 220) {
        return
      }

      const lifeRatio = particle.life / particle.maxLife
      const baseAlpha = Math.max(0, 1 - lifeRatio)
      const alpha = baseAlpha * (0.34 + particle.intensity * 0.62)
      if (alpha <= 0.01) {
        return
      }

      const style = resolveParticleStyle(particle, alpha)

      if (alpha > 0.16) {
        ctx.shadowBlur = style.blur
        ctx.shadowColor = style.shadow
      } else {
        ctx.shadowBlur = 0
      }
      ctx.fillStyle = style.fill
      ctx.font = `${style.weight} ${style.size.toFixed(0)}px 'Noto Sans JP', 'Hiragino Sans', sans-serif`
      ctx.fillText(particle.glyph, particle.x, particle.y)
    })
    ctx.restore()
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
  const grabbedBoost = particle.grabbedBy ? 1.14 : 1
  const baseSize = particle.size * (0.92 + particle.intensity * 0.15) * grabbedBoost
  const blur = (4.5 + particle.glow * 6 + particle.intensity * 8) * grabbedBoost
  const weight = particle.grabbedBy ? 620 : 520

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
