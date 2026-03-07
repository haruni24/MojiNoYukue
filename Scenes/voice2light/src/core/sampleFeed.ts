const DEFAULT_SAMPLE_TEXTS = [
  '今日は少しだけ未来が優しく見える',
  '胸の奥がざわついて落ち着かない',
  '静かな光に触れて安心した',
  'もうだめかもしれないと不安になる',
  'ありがとう、その声に救われた',
  '孤独が冷たく広がっていく',
  '小さな希望がまだ残っている',
  '失敗の記憶が離れず苦しい',
  '君の笑顔で空気が軽くなった',
  'このままでは壊れてしまいそう',
]

type SampleVoiceFeedOptions = {
  sampleTexts?: string[]
  minDelayMs?: number
  maxDelayMs?: number
}

export class SampleVoiceFeed {
  private readonly sampleTexts: string[]
  private readonly minDelayMs: number
  private readonly maxDelayMs: number

  private timerId: number | null = null
  private running = false
  private sampleIndex = 0
  private queuedTexts: string[] = []
  private onText: ((text: string) => void) | null = null

  constructor(options?: SampleVoiceFeedOptions) {
    this.sampleTexts = options?.sampleTexts?.length ? options.sampleTexts : DEFAULT_SAMPLE_TEXTS
    this.minDelayMs = Math.max(350, options?.minDelayMs ?? 1500)
    this.maxDelayMs = Math.max(this.minDelayMs, options?.maxDelayMs ?? 2200)
  }

  start(onText: (text: string) => void): void {
    this.onText = onText
    this.running = true
    this.scheduleNext(220)
  }

  stop(): void {
    this.running = false
    this.onText = null
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  enqueueText(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    this.queuedTexts.push(trimmed)
  }

  private scheduleNext(delayMs?: number): void {
    if (!this.running) {
      return
    }

    const wait = delayMs ?? randomBetween(this.minDelayMs, this.maxDelayMs)
    this.timerId = window.setTimeout(() => {
      this.dispatchOne()
      this.scheduleNext()
    }, wait)
  }

  private dispatchOne(): void {
    if (!this.onText || !this.running) {
      return
    }

    const next = this.queuedTexts.shift() ?? this.sampleTexts[this.sampleIndex % this.sampleTexts.length]
    this.sampleIndex += 1
    this.onText(next)
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
