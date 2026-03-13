import type { GlyphParticle, ParticipantTrack, SceneState, SpeechTrace } from '../types/scene'

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
} as const

export class SceneRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly personLayer: HTMLCanvasElement
  private readonly personCtx: CanvasRenderingContext2D
  private readonly glassLayer: HTMLCanvasElement
  private readonly glassCtx: CanvasRenderingContext2D
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
    const glassLayer = document.createElement('canvas')
    const glassCtx = glassLayer.getContext('2d')
    const maskLayer = document.createElement('canvas')
    const maskCtx = maskLayer.getContext('2d')

    if (!personCtx || !glassCtx || !maskCtx) {
      throw new Error('Offscreen canvas context not available')
    }

    this.canvas = canvas
    this.ctx = context
    this.personLayer = personLayer
    this.personCtx = personCtx
    this.glassLayer = glassLayer
    this.glassCtx = glassCtx
    this.maskLayer = maskLayer
    this.maskCtx = maskCtx
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.personLayer.width = width
      this.personLayer.height = height
      this.glassLayer.width = width
      this.glassLayer.height = height
    }
  }

  render(state: SceneState, timestamp: number): void {
    const { width, height } = this.canvas
    const ctx = this.ctx

    this.drawBackground(width, height, state.silhouetteStrength, timestamp)
    this.drawSegmentedPeople(state)
    this.drawParticipantAuras(state, width, height)
    this.captureGlassLayer(width, height)
    this.drawSpeechTraces(state.traces, state.participants, width, height, timestamp)
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

  private captureGlassLayer(width: number, height: number): void {
    this.glassCtx.clearRect(0, 0, width, height)
    this.glassCtx.drawImage(this.canvas, 0, 0, width, height)
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

  private drawSpeechTraces(
    traces: SpeechTrace[],
    participants: ParticipantTrack[],
    width: number,
    height: number,
    timestamp: number,
  ): void {
    const ctx = this.ctx
    const exclusionRects = this.buildParticipantExclusionRects(participants, width, height)
    const occupiedRects: Array<{ x: number; y: number; width: number; height: number }> = []
    const placements: Array<{
      trace: SpeechTrace
      alpha: number
      boxX: number
      boxY: number
      boxWidth: number
      boxHeight: number
      lines: string[]
      lineHeight: number
      tailPoint: { x: number; y: number }
    }> = []

    const sortedTraces = [...traces].sort((a, b) => a.life - b.life)

    sortedTraces.forEach((trace) => {
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
      const layout = this.layoutTraceText(trace.text, Math.min(width * 0.42, trace.width - 42))
      const boxWidth = Math.max(240, Math.min(width * 0.46, layout.maxLineWidth + 52))
      const boxHeight = Math.max(trace.height, layout.lines.length * layout.lineHeight + 34)
      const placement = this.resolveBubblePlacement(
        anchorX,
        anchorY,
        boxWidth,
        boxHeight,
        width,
        height,
        exclusionRects,
        occupiedRects,
        trace.speakerId,
      )
      const slideX = (placement.slideX + floatX) * (1 - enter)
      const slideY = (placement.slideY + floatY) * (1 - enter)
      const boxX = placement.x + slideX
      const boxY = placement.y + slideY

      const tailPoint = this.computeBubbleTailPoint(boxX, boxY, boxWidth, boxHeight, anchorX, anchorY)
      placements.push({
        trace,
        alpha,
        boxX,
        boxY,
        boxWidth,
        boxHeight,
        lines: layout.lines,
        lineHeight: layout.lineHeight,
        tailPoint,
      })
      occupiedRects.push({ x: boxX, y: boxY, width: boxWidth, height: boxHeight })
    })

    placements
      .sort((a, b) => b.trace.life - a.trace.life)
      .forEach((placement) => {
        const contentHeight = placement.lines.length * placement.lineHeight
        const textStartY = placement.boxY + placement.boxHeight * 0.5 - contentHeight * 0.5 + placement.lineHeight * 0.5
        const anchorX = placement.trace.anchor.x * width
        const anchorY = placement.trace.anchor.y * height

        ctx.save()
        ctx.globalAlpha = placement.alpha
        this.traceBubblePath(
          placement.boxX,
          placement.boxY,
          placement.boxWidth,
          placement.boxHeight,
          placement.tailPoint.x,
          placement.tailPoint.y,
          anchorX,
          anchorY,
        )
        ctx.clip()
        ctx.filter = 'blur(12px) saturate(1.15) brightness(1.05)'
        ctx.drawImage(this.glassLayer, 0, 0, width, height)
        ctx.filter = 'none'
        ctx.fillStyle = 'rgba(244, 249, 255, 0.12)'
        ctx.fillRect(placement.boxX - 2, placement.boxY - 2, placement.boxWidth + 4, placement.boxHeight + 4)

        const shell = ctx.createLinearGradient(
          placement.boxX,
          placement.boxY,
          placement.boxX,
          placement.boxY + placement.boxHeight,
        )
        shell.addColorStop(0, 'rgba(255, 255, 255, 0.22)')
        shell.addColorStop(0.35, 'rgba(232, 240, 250, 0.12)')
        shell.addColorStop(1, 'rgba(185, 198, 216, 0.14)')
        ctx.fillStyle = shell
        ctx.fillRect(placement.boxX, placement.boxY, placement.boxWidth, placement.boxHeight)
        ctx.restore()

        ctx.save()
        ctx.globalAlpha = placement.alpha
        ctx.shadowBlur = 8
        ctx.shadowColor = 'rgba(0, 0, 0, 0.18)'
        this.traceBubblePath(
          placement.boxX,
          placement.boxY,
          placement.boxWidth,
          placement.boxHeight,
          placement.tailPoint.x,
          placement.tailPoint.y,
          anchorX,
          anchorY,
        )
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
        ctx.fill()
        ctx.shadowBlur = 0
        this.traceBubblePath(
          placement.boxX,
          placement.boxY,
          placement.boxWidth,
          placement.boxHeight,
          placement.tailPoint.x,
          placement.tailPoint.y,
          anchorX,
          anchorY,
        )
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.lineWidth = 1
        ctx.stroke()
        this.traceBubblePath(
          placement.boxX + 1.5,
          placement.boxY + 1.5,
          placement.boxWidth - 3,
          placement.boxHeight - 3,
          placement.tailPoint.x,
          placement.tailPoint.y,
          anchorX,
          anchorY,
        )
        ctx.strokeStyle = 'rgba(144, 170, 205, 0.18)'
        ctx.lineWidth = 1
        ctx.stroke()

        const highlight = ctx.createLinearGradient(
          placement.boxX,
          placement.boxY,
          placement.boxX + placement.boxWidth * 0.65,
          placement.boxY + placement.boxHeight * 0.45,
        )
        highlight.addColorStop(0, 'rgba(255, 255, 255, 0.26)')
        highlight.addColorStop(0.52, 'rgba(255, 255, 255, 0.08)')
        highlight.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.save()
        this.traceBubblePath(
          placement.boxX + 3,
          placement.boxY + 3,
          placement.boxWidth - 6,
          placement.boxHeight - 6,
          placement.tailPoint.x,
          placement.tailPoint.y,
          anchorX,
          anchorY,
        )
        ctx.clip()
        ctx.fillStyle = highlight
        ctx.fillRect(placement.boxX, placement.boxY, placement.boxWidth, placement.boxHeight * 0.5)
        ctx.restore()

        ctx.font = "400 20px 'Noto Sans JP', 'Hiragino Sans', sans-serif"
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(18, 22, 28, 0.96)'
        placement.lines.forEach((line, lineIndex) => {
          const lineY = textStartY + lineIndex * placement.lineHeight
          ctx.fillText(line, placement.boxX + placement.boxWidth * 0.5, lineY)
        })

        ctx.restore()
      })
  }

  private layoutTraceText(text: string, maxWidth: number): { lines: string[]; maxLineWidth: number; lineHeight: number } {
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

    const maxLineWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)

    return {
      lines,
      maxLineWidth,
      lineHeight: 24,
    }
  }

  private buildParticipantExclusionRects(
    participants: ParticipantTrack[],
    width: number,
    height: number,
  ): Array<{ id: string; x: number; y: number; width: number; height: number }> {
    return participants.map((participant) => {
      if (participant.landmarks.length === 0) {
        const x = participant.centroid.x * width
        const y = participant.centroid.y * height
        return {
          id: participant.id,
          x: x - 90,
          y: y - 130,
          width: 180,
          height: 260,
        }
      }

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      participant.landmarks.forEach((landmark) => {
        if (landmark.visibility < 0.2) {
          return
        }
        const px = landmark.x * width
        const py = landmark.y * height
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px)
        maxY = Math.max(maxY, py)
      })

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        const x = participant.centroid.x * width
        const y = participant.centroid.y * height
        return {
          id: participant.id,
          x: x - 90,
          y: y - 130,
          width: 180,
          height: 260,
        }
      }

      return {
        id: participant.id,
        x: minX - 28,
        y: minY - 28,
        width: maxX - minX + 56,
        height: maxY - minY + 56,
      }
    })
  }

  private resolveBubblePlacement(
    anchorX: number,
    anchorY: number,
    bubbleWidth: number,
    bubbleHeight: number,
    width: number,
    height: number,
    exclusionRects: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    occupiedRects: Array<{ x: number; y: number; width: number; height: number }>,
    speakerId: string | null,
  ): { x: number; y: number; slideX: number; slideY: number } {
    const margin = 24
    const gap = 20
    const candidates = [
      { x: anchorX - bubbleWidth * 0.5, y: anchorY - bubbleHeight - gap, slideX: 0, slideY: 14 },
      { x: anchorX - bubbleWidth * 0.5, y: anchorY + gap, slideX: 0, slideY: -14 },
      { x: anchorX + gap, y: anchorY - bubbleHeight * 0.5, slideX: -18, slideY: 0 },
      { x: anchorX - bubbleWidth - gap, y: anchorY - bubbleHeight * 0.5, slideX: 18, slideY: 0 },
      { x: anchorX + gap, y: anchorY - bubbleHeight - 10, slideX: -16, slideY: 12 },
      { x: anchorX - bubbleWidth - gap, y: anchorY - bubbleHeight - 10, slideX: 16, slideY: 12 },
      { x: anchorX + gap, y: anchorY + 8, slideX: -16, slideY: -12 },
      { x: anchorX - bubbleWidth - gap, y: anchorY + 8, slideX: 16, slideY: -12 },
    ]

    const scored = candidates.map((candidate, index) => {
      const x = Math.min(width - bubbleWidth - margin, Math.max(margin, candidate.x))
      const y = Math.min(height - bubbleHeight - margin, Math.max(margin, candidate.y))
      const rect = { x, y, width: bubbleWidth, height: bubbleHeight }
      let score = Math.hypot(x + bubbleWidth * 0.5 - anchorX, y + bubbleHeight * 0.5 - anchorY) * 0.08 + index * 3

      exclusionRects.forEach((zone) => {
        const overlap = this.computeRectOverlap(rect, zone)
        if (overlap <= 0) {
          return
        }
        score += overlap * (zone.id === speakerId ? 9 : 5)
      })

      occupiedRects.forEach((occupied) => {
        const overlap = this.computeRectOverlap(rect, occupied)
        if (overlap <= 0) {
          return
        }
        score += overlap * 14
      })

      return {
        x,
        y,
        slideX: candidate.slideX,
        slideY: candidate.slideY,
        score,
      }
    })

    scored.sort((a, b) => a.score - b.score)
    return scored[0]
  }

  private computeRectOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): number {
    const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    return overlapX * overlapY
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

  private traceBubblePath(
    boxX: number,
    boxY: number,
    boxWidth: number,
    boxHeight: number,
    tailStartX: number,
    tailStartY: number,
    anchorX: number,
    anchorY: number,
  ): void {
    const ctx = this.ctx
    const radius = 22
    const dx = anchorX - tailStartX
    const dy = anchorY - tailStartY
    const length = Math.max(1, Math.hypot(dx, dy))
    const nx = dx / length
    const ny = dy / length
    const px = -ny
    const py = nx
    const base = 6
    const tipX = anchorX - nx * 8
    const tipY = anchorY - ny * 8

    ctx.beginPath()
    ctx.moveTo(boxX + radius, boxY)
    ctx.arcTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + boxHeight, radius)
    ctx.arcTo(boxX + boxWidth, boxY + boxHeight, boxX, boxY + boxHeight, radius)
    ctx.arcTo(boxX, boxY + boxHeight, boxX, boxY, radius)
    ctx.arcTo(boxX, boxY, boxX + boxWidth, boxY, radius)
    ctx.closePath()

    ctx.moveTo(tailStartX + px * base, tailStartY + py * base)
    ctx.quadraticCurveTo(tailStartX + dx * 0.34, tailStartY + dy * 0.34, tipX, tipY)
    ctx.quadraticCurveTo(
      tailStartX + dx * 0.18,
      tailStartY + dy * 0.18,
      tailStartX - px * base,
      tailStartY - py * base,
    )
    ctx.closePath()
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
