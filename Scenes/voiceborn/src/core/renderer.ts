import type { GlyphParticle, SceneState } from '../types/scene'

/*  ──────────────────────────────────────────
    Voiceborn — Scene Renderer
    美学: 墨と光の間（あわい）

    voice2lightと同じカラーパレットを共有し、
    統一された世界観の中で声が文字として誕生する。
    ────────────────────────────────────────── */

const PALETTE = {
  voidA: '#08080a',
  voidB: '#0a0a0e',
  voidC: '#06060a',

  fogWarm: (a: number) => `rgba(196, 169, 106, ${a})`,
  fogCool: (a: number) => `rgba(180, 175, 165, ${a})`,

  // HUD — 控えめに、作品の邪魔をしない
  hudDim: 'rgba(138, 135, 128, 0.4)',
  hudSoft: 'rgba(210, 206, 198, 0.5)',
  hudAccent: 'rgba(196, 169, 106, 0.55)',
  hudTranscript: 'rgba(232, 228, 223, 0.6)',

  // 参加者オーラ — 暖色系に統一
  auraPrimary: 'rgba(196, 169, 106, 0.18)',
  auraSecondary: 'rgba(180, 175, 165, 0.1)',
} as const

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
    const t = timestamp * 0.00006

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, PALETTE.voidA)
    gradient.addColorStop(0.5, PALETTE.voidB)
    gradient.addColorStop(1, PALETTE.voidC)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    const fogBase = 0.03 + silhouetteStrength * 0.14
    for (let i = 0; i < 5; i += 1) {
      const breathPhase = Math.sin(t * (0.8 + i * 0.3) + i * 1.7)
      const radius = 260 + i * 150 + breathPhase * 50
      const x = width * (0.12 + i * 0.19) + Math.sin(t * 0.9 + i * 2.1) * 65
      const y = height * (0.2 + (i % 2) * 0.35) + Math.cos(t * 0.7 + i * 1.6) * 50
      const fog = fogBase * (0.6 + breathPhase * 0.4)

      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      if (i % 2 === 0) {
        glow.addColorStop(0, PALETTE.fogWarm(fog))
        glow.addColorStop(0.6, PALETTE.fogWarm(fog * 0.15))
      } else {
        glow.addColorStop(0, PALETTE.fogCool(fog * 0.7))
        glow.addColorStop(0.6, PALETTE.fogCool(fog * 0.1))
      }
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
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
    ctx.globalAlpha = 1
    ctx.drawImage(this.personLayer, 0, 0)
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
      const baseRadius = participant.isPrimary ? 120 : 80

      const aura = ctx.createRadialGradient(px, py, 0, px, py, baseRadius)
      aura.addColorStop(0, participant.isPrimary ? PALETTE.auraPrimary : PALETTE.auraSecondary)
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = aura
      ctx.fillRect(px - baseRadius, py - baseRadius, baseRadius * 2, baseRadius * 2)
    })
  }

  private drawParticles(particles: GlyphParticle[]): void {
    const ctx = this.ctx

    particles.forEach((particle) => {
      const lifeRatio = particle.life / particle.maxLife
      const baseAlpha = Math.max(0, (1 - lifeRatio) * 0.9)

      // 余韻フェード
      const fadeAlpha = lifeRatio > 0.75
        ? baseAlpha * (1 - (lifeRatio - 0.75) / 0.25) * 1.4
        : baseAlpha

      const blur = 6 + particle.glow * 8

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.shadowBlur = blur

      // hueを統一パレットにマッピング
      // 170-220 (シアン寄り) → 灰白系, 220-290 (紫寄り) → 金泥系
      const warmth = (particle.hue - 170) / 120 // 0..1
      if (warmth < 0.42) {
        // 灰白系の光
        ctx.shadowColor = `rgba(210, 206, 198, ${fadeAlpha})`
        ctx.fillStyle = `rgba(232, 228, 223, ${fadeAlpha * 0.9})`
      } else {
        // 金泥系の光
        ctx.shadowColor = `rgba(196, 169, 106, ${fadeAlpha * 0.9})`
        ctx.fillStyle = `rgba(220, 206, 170, ${fadeAlpha * 0.85})`
      }

      ctx.font = `${particle.size.toFixed(0)}px 'Noto Serif JP', 'Noto Sans JP', 'Hiragino Sans', sans-serif`
      ctx.fillText(particle.glyph, particle.x, particle.y)
      ctx.restore()
    })
  }

  private drawAmbientHUD(width: number, height: number, state: SceneState): void {
    const ctx = this.ctx

    ctx.save()
    // 控えめなHUD — 作品の邪魔をしない
    ctx.fillStyle = PALETTE.hudDim
    ctx.font = "300 11px 'IBM Plex Mono', monospace"
    ctx.fillText(`PARTICIPANTS ${state.participants.length}`, 24, 30)
    ctx.fillText(`AUDIO ${(state.audioMetrics.rms * 100).toFixed(1)}%`, 24, 46)

    const primary = state.participants.find((p) => p.isPrimary)
    if (primary) {
      ctx.fillStyle = PALETTE.hudAccent
      ctx.fillText(`PRIMARY ${primary.id}`, 24, 62)
    }

    if (state.lastTranscript) {
      ctx.textAlign = 'center'
      ctx.fillStyle = PALETTE.hudTranscript
      ctx.font = "400 15px 'Noto Serif JP', 'Noto Sans JP', 'Hiragino Sans', sans-serif"
      ctx.fillText(state.lastTranscript, width / 2, height - 30)
      ctx.textAlign = 'left'
    }
    ctx.restore()
  }
}
