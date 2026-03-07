import type { GlyphParticle, ParticipantTrack, SceneState } from '../types/scene'

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
    this.drawParticles(state.particles)
    this.drawAmbientHUD(width, height, state)

    ctx.globalCompositeOperation = 'source-over'
  }

  private drawBackground(width: number, height: number, silhouetteStrength: number, timestamp: number): void {
    const ctx = this.ctx
    const t = timestamp * 0.00012

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#060911')
    gradient.addColorStop(0.5, '#070b1a')
    gradient.addColorStop(1, '#030407')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    const fogPower = 0.18 + silhouetteStrength * 0.35
    for (let i = 0; i < 4; i += 1) {
      const radius = 220 + i * 140 + (Math.sin(t + i) + 1) * 40
      const x = width * (0.15 + i * 0.22) + Math.sin(t * 1.8 + i * 2) * 60
      const y = height * (0.3 + (i % 2) * 0.25) + Math.cos(t * 1.4 + i) * 35
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      glow.addColorStop(0, `rgba(30, 210, 255, ${fogPower})`)
      glow.addColorStop(1, 'rgba(7, 11, 20, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, width, height)
    }
  }

  private drawParticipants(participants: ParticipantTrack[], width: number, height: number): void {
    const ctx = this.ctx

    participants.forEach((participant) => {
      const px = participant.centroid.x * width
      const py = participant.centroid.y * height
      const baseRadius = participant.isPrimary ? 110 : 80
      const intensity = Math.min(1, 0.25 + participant.confidence * 0.75)

      const aura = ctx.createRadialGradient(px, py, 0, px, py, baseRadius)
      aura.addColorStop(0, participant.isPrimary ? 'rgba(185, 255, 120, 0.32)' : 'rgba(80, 220, 255, 0.18)')
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = aura
      ctx.fillRect(px - baseRadius, py - baseRadius, baseRadius * 2, baseRadius * 2)

      ctx.strokeStyle = participant.isPrimary
        ? `rgba(180, 255, 130, ${0.65 * intensity})`
        : `rgba(130, 210, 255, ${0.4 * intensity})`
      ctx.lineWidth = participant.isPrimary ? 2.2 : 1.2

      POSE_CONNECTIONS.forEach(([from, to]) => {
        const a = participant.landmarks[from]
        const b = participant.landmarks[to]
        if (!a || !b || a.visibility < 0.3 || b.visibility < 0.3) {
          return
        }

        ctx.beginPath()
        ctx.moveTo(a.x * width, a.y * height)
        ctx.lineTo(b.x * width, b.y * height)
        ctx.stroke()
      })
    })
  }

  private drawParticles(particles: GlyphParticle[]): void {
    const ctx = this.ctx

    particles.forEach((particle) => {
      const lifeRatio = particle.life / particle.maxLife
      const alpha = Math.max(0, (1 - lifeRatio) * 0.9)
      const blur = 8 + particle.glow * 11

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.shadowBlur = blur
      ctx.shadowColor = `hsla(${particle.hue}, 95%, 72%, ${alpha})`
      ctx.fillStyle = `hsla(${particle.hue}, 90%, 74%, ${alpha})`
      ctx.font = `${particle.size.toFixed(0)}px 'Noto Sans JP', 'Hiragino Sans', sans-serif`
      ctx.fillText(particle.glyph, particle.x, particle.y)
      ctx.restore()
    })
  }

  private drawAmbientHUD(width: number, height: number, state: SceneState): void {
    const ctx = this.ctx
    const primary = state.participants.find((p) => p.isPrimary)

    ctx.save()
    ctx.fillStyle = 'rgba(175, 240, 255, 0.75)'
    ctx.font = "500 14px 'Noto Sans JP', 'Hiragino Sans', sans-serif"
    ctx.fillText(`PARTICIPANTS ${state.participants.length}`, 24, 32)
    ctx.fillText(`AUDIO ${(state.audioMetrics.rms * 100).toFixed(1)}%`, 24, 54)
    if (primary) {
      ctx.fillStyle = 'rgba(191, 255, 141, 0.86)'
      ctx.fillText(`PRIMARY ${primary.id}`, 24, 76)
    }

    if (state.lastTranscript) {
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(195, 225, 255, 0.88)'
      ctx.font = "500 18px 'Noto Sans JP', 'Hiragino Sans', sans-serif"
      ctx.fillText(state.lastTranscript, width / 2, height - 28)
      ctx.textAlign = 'left'
    }
    ctx.restore()
  }
}
