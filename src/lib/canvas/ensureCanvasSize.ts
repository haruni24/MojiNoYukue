export const ensureCanvasSize = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (width <= 0 || height <= 0) return
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}
