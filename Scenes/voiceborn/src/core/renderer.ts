import type { GlyphParticle, SceneState } from '../types/scene'

export class SceneRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly personLayer: HTMLCanvasElement
  private readonly personCtx: CanvasRenderingContext2D
  private readonly maskLayer: HTMLCanvasElement
  private readonly maskCtx: CanvasRenderingContext2D
  private maskImageData: ImageData | null = null

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('2D canvas context not available')
    }

    const personLayer = document.createElement('canvas')
    const personCtx = personLayer.getContext('2d')
    const maskLayer = document.createElement('canvas')
    const maskCtx = maskLayer.getContext('2d')

    if (!personCtx || !maskCtx) {
      throw new Error('Offscreen canvas context not available')
    }

    this.canvas = canvas
    this.ctx = context
    this.personLayer = personLayer
    this.personCtx = personCtx
    this.maskLayer = maskLayer
    this.maskCtx = maskCtx
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.personLayer.width = width
      this.personLayer.height = height
    }
  }

  render(state: SceneState, timestamp: number): void {
    const { width, height } = this.canvas
    const ctx = this.ctx

    this.drawBackground(width, height, state.silhouetteStrength, timestamp)
    this.drawSegmentedPeople(state)
    this.drawParticipantAuras(state, width, height)
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

    const fogPower = 0.16 + silhouetteStrength * 0.36
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

  private drawSegmentedPeople(state: SceneState): void {
    if (!state.segmentation || !state.videoFrame) {
      return
    }

    const width = this.canvas.width
    const height = this.canvas.height
    const video = state.videoFrame
    const segmentation = state.segmentation

    this.personCtx.clearRect(0, 0, width, height)
    this.personCtx.drawImage(video, 0, 0, width, height)

    this.prepareMask(segmentation.alpha, segmentation.width, segmentation.height)

    this.personCtx.globalCompositeOperation = 'destination-in'
    this.personCtx.drawImage(this.maskLayer, 0, 0, width, height)
    this.personCtx.globalCompositeOperation = 'source-over'

    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.drawImage(this.personLayer, 0, 0)

    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = 'rgba(70, 220, 255, 0.2)'
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
  }

  private prepareMask(alpha: Uint8ClampedArray, width: number, height: number): void {
    if (this.maskLayer.width !== width || this.maskLayer.height !== height) {
      this.maskLayer.width = width
      this.maskLayer.height = height
      this.maskImageData = null
    }

    if (!this.maskImageData) {
      this.maskImageData = this.maskCtx.createImageData(width, height)
    }

    const rgba = this.maskImageData.data
    for (let i = 0; i < alpha.length; i += 1) {
      const px = i * 4
      rgba[px] = 255
      rgba[px + 1] = 255
      rgba[px + 2] = 255
      rgba[px + 3] = alpha[i]
    }

    this.maskCtx.putImageData(this.maskImageData, 0, 0)
  }

  private drawParticipantAuras(state: SceneState, width: number, height: number): void {
    const ctx = this.ctx

    state.participants.forEach((participant) => {
      const px = participant.centroid.x * width
      const py = participant.centroid.y * height
      const baseRadius = participant.isPrimary ? 130 : 92

      const aura = ctx.createRadialGradient(px, py, 0, px, py, baseRadius)
      aura.addColorStop(0, participant.isPrimary ? 'rgba(185, 255, 120, 0.28)' : 'rgba(80, 220, 255, 0.16)')
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = aura
      ctx.fillRect(px - baseRadius, py - baseRadius, baseRadius * 2, baseRadius * 2)
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
