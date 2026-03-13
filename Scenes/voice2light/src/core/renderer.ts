import type { GlyphParticle, HandTrack, SceneState } from '../types/scene'

/*  ──────────────────────────────────────────
    Voice2Light — Scene Renderer
    美学: 墨と光の間（あわい）

    背景は漆黒ではなく、わずかに温かみのある闇。
    文字は光として生まれ、余韻を残して溶け消える。
    ────────────────────────────────────────── */

// 統一カラーパレット
const PALETTE = {
  // 闇（背景グラデーション）
  voidA: '#08080a',
  voidB: '#0a0a0e',
  voidC: '#06060a',

  // 霧（呼吸する背景光）— 暖色系に統一
  fogWarm: (a: number) => `rgba(196, 169, 106, ${a})`,       // 金泥の霧
  fogCool: (a: number) => `rgba(180, 175, 165, ${a})`,       // 灰白の霧

  // パーティクル — 感情による色変化
  positive: {
    fill: (a: number) => `rgba(232, 224, 198, ${Math.min(1, a)})`,    // 暖かい光
    glow: (a: number) => `rgba(196, 169, 106, ${Math.min(1, a)})`,    // 金泥の残光
  },
  negative: {
    fill: (a: number) => `rgba(180, 160, 200, ${Math.min(1, a)})`,    // 薄紫の冷光
    glow: (a: number) => `rgba(140, 120, 180, ${Math.min(1, a)})`,    // 藤色の影
  },
  neutral: {
    fill: (a: number) => `rgba(210, 206, 198, ${Math.min(1, a)})`,    // 灰白
    glow: (a: number) => `rgba(180, 176, 168, ${Math.min(1, a)})`,    // 薄墨
  },

  // 手のトラッキング
  handTrail: 'rgba(196, 169, 106, 0.22)',
  handGlow: 'rgba(196, 169, 106, 0.4)',
  palmCenter: (a: number) => `rgba(232, 228, 223, ${a})`,
  palmEdge: 'rgba(196, 169, 106, 0)',
  fingerCenter: 'rgba(232, 228, 223, 0.32)',
  fingerEdge: 'rgba(196, 169, 106, 0)',
  pinchLine: 'rgba(232, 228, 223, 0.48)',
  pinchGlow: 'rgba(196, 169, 106, 0.6)',

  // 字幕
  subtitlePositive: 'rgba(232, 224, 198, 0.62)',
  subtitleNegative: 'rgba(180, 160, 200, 0.58)',
  subtitleNeutral: 'rgba(210, 206, 198, 0.52)',
} as const

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
    const t = timestamp * 0.00006 // さらにゆっくり呼吸する

    // ベースの闇 — 完全な黒ではなく、わずかに温かい
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, PALETTE.voidA)
    gradient.addColorStop(0.5, PALETTE.voidB)
    gradient.addColorStop(1, PALETTE.voidC)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // 呼吸する霧 — 金泥と灰白の光が空間を漂う
    const fogBase = 0.03 + silhouetteStrength * 0.12
    for (let i = 0; i < 5; i += 1) {
      const breathPhase = Math.sin(t * (0.8 + i * 0.3) + i * 1.7)
      const radius = 280 + i * 160 + breathPhase * 60
      const x = width * (0.12 + i * 0.19) + Math.sin(t * 0.9 + i * 2.1) * 70
      const y = height * (0.18 + (i % 2) * 0.38) + Math.cos(t * 0.7 + i * 1.6) * 55
      const fog = fogBase * (0.6 + breathPhase * 0.4)

      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      // 交互に暖色と寒色を配置して奥行きを出す
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

      // 軌跡 — 金泥色の墨跡
      if (hand.trail.length > 1) {
        ctx.beginPath()
        ctx.lineWidth = 2.2 + hand.pinchStrength * 2
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
        ctx.strokeStyle = PALETTE.handTrail
        ctx.shadowBlur = 12
        ctx.shadowColor = PALETTE.handGlow
        ctx.stroke()
      }

      // 掌のオーラ
      const palmRadius = 48 + hand.pinchStrength * 26
      const palm = ctx.createRadialGradient(wristX, wristY, 0, wristX, wristY, palmRadius)
      palm.addColorStop(0, PALETTE.palmCenter(0.18 + hand.pinchStrength * 0.18))
      palm.addColorStop(1, PALETTE.palmEdge)
      ctx.fillStyle = palm
      ctx.fillRect(wristX - palmRadius, wristY - palmRadius, palmRadius * 2, palmRadius * 2)

      // 指先の光点
      drawFingerBloom(ctx, indexX, indexY, 20 + hand.pinchStrength * 12)
      drawFingerBloom(ctx, middleX, middleY, 16 + hand.pinchStrength * 9)
      drawFingerBloom(ctx, thumbX, thumbY, 15 + hand.pinchStrength * 10)

      // ピンチ中の接続線
      if (hand.isPinching) {
        ctx.beginPath()
        ctx.moveTo(indexX, indexY)
        ctx.lineTo(thumbX, thumbY)
        ctx.lineWidth = 1.4
        ctx.strokeStyle = PALETTE.pinchLine
        ctx.shadowBlur = 10
        ctx.shadowColor = PALETTE.pinchGlow
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

      // 余韻のある消え方 — 最後の20%でゆっくりと溶ける
      const fadeAlpha = lifeRatio > 0.8
        ? baseAlpha * (1 - (lifeRatio - 0.8) / 0.2) * 1.5
        : baseAlpha

      const alpha = fadeAlpha * (0.34 + particle.intensity * 0.62)
      if (alpha <= 0.01) {
        return
      }

      const style = resolveParticleStyle(particle, alpha)

      if (alpha > 0.12) {
        ctx.shadowBlur = style.blur
        ctx.shadowColor = style.shadow
      } else {
        ctx.shadowBlur = 0
      }
      ctx.fillStyle = style.fill
      ctx.font = `${style.weight} ${style.size.toFixed(0)}px 'Noto Serif JP', 'Noto Sans JP', 'Hiragino Sans', sans-serif`
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
        ? PALETTE.subtitleNegative
        : state.lastEmotion?.polarity === 'positive'
          ? PALETTE.subtitlePositive
          : PALETTE.subtitleNeutral

    ctx.save()
    ctx.font = "400 16px 'Noto Serif JP', 'Noto Sans JP', 'Hiragino Sans', sans-serif"
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.letterSpacing = '0.08em'
    ctx.fillText(state.lastText, width / 2, height - 30)
    ctx.textAlign = 'left'
    ctx.restore()
  }
}

function drawFingerBloom(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
  glow.addColorStop(0, PALETTE.fingerCenter)
  glow.addColorStop(1, PALETTE.fingerEdge)
  ctx.fillStyle = glow
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

function resolveParticleStyle(
  particle: GlyphParticle,
  alpha: number,
): { fill: string; shadow: string; blur: number; size: number; weight: number } {
  const grabbedBoost = particle.grabbedBy ? 1.12 : 1
  const baseSize = particle.size * (0.92 + particle.intensity * 0.15) * grabbedBoost
  const blur = (5 + particle.glow * 7 + particle.intensity * 6) * grabbedBoost
  const weight = particle.grabbedBy ? 500 : 400

  if (particle.polarity === 'positive') {
    return {
      fill: PALETTE.positive.fill(alpha * 0.95),
      shadow: PALETTE.positive.glow(alpha * 1.1),
      blur,
      size: baseSize,
      weight,
    }
  }

  if (particle.polarity === 'negative') {
    return {
      fill: PALETTE.negative.fill(alpha * 0.9),
      shadow: PALETTE.negative.glow(alpha * 1.15),
      blur,
      size: baseSize,
      weight,
    }
  }

  return {
    fill: PALETTE.neutral.fill(alpha * 0.85),
    shadow: PALETTE.neutral.glow(alpha * 1.0),
    blur,
    size: baseSize,
    weight,
  }
}
