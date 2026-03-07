export const drawTestPattern = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  const { width, height } = canvas
  ctx.save()
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(0, 0, width, height)

  const tile = 24
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const shouldFill = ((x / tile) | 0) % 2 === ((y / tile) | 0) % 2
      if (!shouldFill) continue
      ctx.fillStyle = 'rgba(17, 24, 39, 0.06)'
      ctx.fillRect(x, y, tile, tile)
    }
  }

  ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)'
  ctx.lineWidth = Math.max(2, Math.min(6, width / 240))
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(width, height)
  ctx.moveTo(width, 0)
  ctx.lineTo(0, height)
  ctx.stroke()

  ctx.fillStyle = '#111827'
  ctx.font = `${Math.max(14, Math.min(26, width / 32))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
  ctx.fillText('CANVAS TEST PATTERN', Math.max(16, width / 40), Math.max(38, height / 14))
  ctx.restore()
}
