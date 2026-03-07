export const drawStatusPlaceholder = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, lines: string[]) => {
  const { width, height } = canvas
  ctx.save()
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)'
  ctx.fillRect(0, 0, width, Math.max(52, height * 0.12))

  ctx.fillStyle = '#0f172a'
  ctx.font = `${Math.max(13, Math.min(18, width / 56))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
  const startX = Math.max(14, width / 40)
  let y = Math.max(30, height * 0.07)
  const lineHeight = Math.max(18, Math.min(26, width / 60))
  for (const line of lines.slice(0, 8)) {
    ctx.fillText(line, startX, y)
    y += lineHeight
  }
  ctx.restore()
}
