type TakeuchiBackgroundConfig = {
  base: string
  glowA: string
  glowB: string
  vignette: number
}

const DEFAULT_CONFIG: TakeuchiBackgroundConfig = {
  base: '#03060b',
  glowA: 'rgba(80, 170, 255, 0.18)',
  glowB: 'rgba(255, 110, 210, 0.12)',
  vignette: 0.86,
}

const toTransparent = (rgba: string) => {
  const m = rgba.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/i)
  if (!m) return 'rgba(0, 0, 0, 0)'
  const r = Number(m[1])
  const g = Number(m[2])
  const b = Number(m[3])
  if (![r, g, b].every((n) => Number.isFinite(n))) return 'rgba(0, 0, 0, 0)'
  return `rgba(${r}, ${g}, ${b}, 0)`
}

const fillEllipticalGlow = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  fadeStop: number
) => {
  if (rx <= 0 || ry <= 0) return
  const safeFade = Math.max(0, Math.min(1, fadeStop))
  const transparent = toTransparent(color)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1, ry / rx)
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  gradient.addColorStop(0, color)
  gradient.addColorStop(safeFade, transparent)
  gradient.addColorStop(1, transparent)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(0, 0, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const drawTakeuchiBackground = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  config: TakeuchiBackgroundConfig = DEFAULT_CONFIG
) => {
  if (width <= 0 || height <= 0) return

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = config.base
  ctx.fillRect(0, 0, width, height)

  const s = Math.max(0.1, Math.min(width / 1920, height / 1080))
  fillEllipticalGlow(ctx, width * 0.22, height * 0.24, 1100 * s, 760 * s, config.glowA, 0.62)
  fillEllipticalGlow(ctx, width * 0.78, height * 0.78, 900 * s, 700 * s, config.glowB, 0.64)

  const vignette = Number.isFinite(config.vignette) ? Math.max(0, Math.min(1, config.vignette)) : 0.86
  const r = Math.min(width, height) / 2
  const vg = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, r)
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vg.addColorStop(0.52, 'rgba(0, 0, 0, 0)')
  vg.addColorStop(1, `rgba(0, 0, 0, ${vignette})`)
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, width, height)
}

let cached: { width: number; height: number; imageData: ImageData } | null = null

export const getTakeuchiBackgroundImageData = (width: number, height: number) => {
  if (cached && cached.width === width && cached.height === height) return cached.imageData

  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas === 'undefined'
      ? Object.assign(document.createElement('canvas'), { width, height })
      : new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) {
    const fallback = new ImageData(width, height)
    fallback.data.fill(255)
    cached = { width, height, imageData: fallback }
    return fallback
  }

  drawTakeuchiBackground(ctx, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  cached = { width, height, imageData }
  return imageData
}
