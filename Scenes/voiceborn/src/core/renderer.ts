import type { GlyphParticle, SceneState, SpeechTrace } from '../types/scene'

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
  hudTranscript: 'rgba(232, 228, 223, 0.38)',

  // 参加者オーラ — 暖色系に統一
  auraPrimary: 'rgba(196, 169, 106, 0.18)',
  auraSecondary: 'rgba(180, 175, 165, 0.1)',
  traceCore: 'rgba(232, 228, 223, 0.92)',
  traceWarm: 'rgba(214, 188, 130, 0.7)',
  traceLine: 'rgba(214, 188, 130, 0.18)',
  traceMist: 'rgba(232, 228, 223, 0.08)',
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
    this.drawSpeechTraces(state.traces, width, height, timestamp)
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

  private drawSpeechTraces(traces: SpeechTrace[], width: number, height: number, timestamp: number): void {
    const ctx = this.ctx

    traces.forEach((trace) => {
      if (!trace.text) {
        return
      }

      const lifeRatio = trace.life / trace.maxLife
      const enter = this.easeOutBack(Math.min(1, trace.life / 380))
      const fadeOut = Math.min(1, (1 - lifeRatio) / 0.2)
      const alpha = Math.max(0, Math.min(1, enter) * fadeOut * trace.intensity)
      if (alpha <= 0.01) {
        return
      }

      const anchorX = trace.anchor.x * width
      const anchorY = trace.anchor.y * height
      const floatX = trace.offset.x + Math.sin(timestamp * 0.0008 + trace.seed) * 2
      const floatY = trace.offset.y + Math.cos(timestamp * 0.001 + trace.seed) * 2
      const gap = 18
      const margin = 24
      const preferHorizontal = anchorX < width * 0.24 || anchorX > width * 0.76
      const placeRight = anchorX < width * 0.5
      const hasTopRoom = anchorY - trace.height - gap > margin
      const placeBelow = !hasTopRoom && anchorY < height * 0.58
      let boxX = anchorX - trace.width * 0.5
      let boxY = placeBelow ? anchorY + gap : anchorY - trace.height - gap

      if (preferHorizontal) {
        boxX = placeRight ? anchorX + gap : anchorX - trace.width - gap
        boxY = anchorY - trace.height * 0.5
      }

      boxX = Math.min(width - trace.width - margin, Math.max(margin, boxX + floatX))
      boxY = Math.min(height - trace.height - margin, Math.max(margin, boxY + floatY))

      const slideX = preferHorizontal ? (1 - enter) * (placeRight ? 20 : -20) : 0
      const slideY = preferHorizontal ? 0 : (1 - enter) * (placeBelow ? -16 : 16)
      boxX += slideX
      boxY += slideY

      const radius = 22
      const lines = this.wrapTraceText(trace.text, trace.width - 44)
      const contentHeight = lines.length * 22
      const textStartY = boxY + trace.height * 0.5 - contentHeight * 0.5 + 2
      const tailPoint = this.computeBubbleTailPoint(boxX, boxY, trace.width, trace.height, anchorX, anchorY)

      ctx.save()
      ctx.globalAlpha = alpha

      ctx.shadowBlur = 24
      ctx.shadowColor = `rgba(0, 0, 0, ${0.18 * alpha})`
      ctx.fillStyle = `rgba(252, 252, 248, ${0.9 * alpha})`
      this.fillRoundedRect(boxX, boxY, trace.width, trace.height, radius)
      this.fillBubbleTail(tailPoint.x, tailPoint.y, anchorX, anchorY)

      ctx.shadowBlur = 0
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.08 * alpha})`
      ctx.lineWidth = 1
      this.strokeRoundedRect(boxX + 0.5, boxY + 0.5, trace.width - 1, trace.height - 1, radius - 0.5)
      this.strokeBubbleTail(tailPoint.x, tailPoint.y, anchorX, anchorY)

      ctx.font = "400 20px 'Noto Sans JP', 'Hiragino Sans', sans-serif"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = `rgba(24, 24, 28, ${0.92 * alpha})`
      lines.forEach((line, lineIndex) => {
        const lineY = textStartY + lineIndex * 22
        ctx.fillText(line, boxX + trace.width * 0.5, lineY)
      })

      ctx.restore()
    })
  }

  private wrapTraceText(text: string, maxWidth: number): string[] {
    const ctx = this.ctx
    ctx.font = "400 20px 'Noto Sans JP', 'Hiragino Sans', sans-serif"
    const chars = Array.from(text)
    const lines: string[] = []
    let current = ''

    chars.forEach((char) => {
      const next = `${current}${char}`
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current)
        current = char
        return
      }
      current = next
    })

    if (current) {
      lines.push(current)
    }

    return lines.slice(0, 3)
  }

  private fillRoundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + width, y, x + width, y + height, radius)
    ctx.arcTo(x + width, y + height, x, y + height, radius)
    ctx.arcTo(x, y + height, x, y, radius)
    ctx.arcTo(x, y, x + width, y, radius)
    ctx.closePath()
    ctx.fill()
  }

  private strokeRoundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + width, y, x + width, y + height, radius)
    ctx.arcTo(x + width, y + height, x, y + height, radius)
    ctx.arcTo(x, y + height, x, y, radius)
    ctx.arcTo(x, y, x + width, y, radius)
    ctx.closePath()
    ctx.stroke()
  }

  private computeBubbleTailPoint(
    boxX: number,
    boxY: number,
    boxWidth: number,
    boxHeight: number,
    anchorX: number,
    anchorY: number,
  ): { x: number; y: number } {
    const nearestX = Math.max(boxX + 18, Math.min(anchorX, boxX + boxWidth - 18))
    const nearestY = Math.max(boxY + 18, Math.min(anchorY, boxY + boxHeight - 18))

    const leftDistance = Math.abs(anchorX - boxX)
    const rightDistance = Math.abs(anchorX - (boxX + boxWidth))
    const topDistance = Math.abs(anchorY - boxY)
    const bottomDistance = Math.abs(anchorY - (boxY + boxHeight))
    const minDistance = Math.min(leftDistance, rightDistance, topDistance, bottomDistance)

    if (minDistance === leftDistance) {
      return { x: boxX, y: nearestY }
    }
    if (minDistance === rightDistance) {
      return { x: boxX + boxWidth, y: nearestY }
    }
    if (minDistance === topDistance) {
      return { x: nearestX, y: boxY }
    }
    return { x: nearestX, y: boxY + boxHeight }
  }

  private fillBubbleTail(startX: number, startY: number, anchorX: number, anchorY: number): void {
    const ctx = this.ctx
    const dx = anchorX - startX
    const dy = anchorY - startY
    const length = Math.max(1, Math.hypot(dx, dy))
    const nx = dx / length
    const ny = dy / length
    const px = -ny
    const py = nx
    const base = 7
    const tipX = anchorX - nx * 8
    const tipY = anchorY - ny * 8

    ctx.beginPath()
    ctx.moveTo(startX + px * base, startY + py * base)
    ctx.quadraticCurveTo(startX + dx * 0.35, startY + dy * 0.35, tipX, tipY)
    ctx.quadraticCurveTo(startX + dx * 0.22, startY + dy * 0.22, startX - px * base, startY - py * base)
    ctx.closePath()
    ctx.fill()
  }

  private strokeBubbleTail(startX: number, startY: number, anchorX: number, anchorY: number): void {
    const ctx = this.ctx
    const dx = anchorX - startX
    const dy = anchorY - startY
    const length = Math.max(1, Math.hypot(dx, dy))
    const nx = dx / length
    const ny = dy / length
    const px = -ny
    const py = nx
    const base = 7
    const tipX = anchorX - nx * 8
    const tipY = anchorY - ny * 8

    ctx.beginPath()
    ctx.moveTo(startX + px * base, startY + py * base)
    ctx.quadraticCurveTo(startX + dx * 0.35, startY + dy * 0.35, tipX, tipY)
    ctx.quadraticCurveTo(startX + dx * 0.22, startY + dy * 0.22, startX - px * base, startY - py * base)
    ctx.closePath()
    ctx.stroke()
  }

  private easeOutBack(x: number): number {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
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
      ctx.font = "400 12px 'IBM Plex Mono', 'Noto Sans JP', sans-serif"
      ctx.fillText(state.lastTranscript, width / 2, height - 24)
      ctx.textAlign = 'left'
    }
    ctx.restore()
  }
}
