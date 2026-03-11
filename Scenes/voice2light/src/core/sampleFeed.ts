const DEFAULT_SAMPLE_TEXTS = [
  '先生が優しい',
  '進路が不安だ',
  '大学に合格して安心した',
  '論文が書けなくて困っている',
  '多くの人に感謝している',
  '嫌いな人がいる',
  '卒業するのが寂しい',
  '失敗したくない',
  'たくさん笑った',
  'ここからどうしたらいいのかわからない',
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
  private cycleIndex = 0
  private queuedTexts: string[] = []
  private loopTexts: string[] = []
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

  addLoopText(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    if (this.loopTexts.includes(trimmed)) {
      return
    }

    this.loopTexts.push(trimmed)
    if (this.loopTexts.length > 24) {
      this.loopTexts.shift()
    }
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

    const cyclePool = this.loopTexts.length > 0 ? [...this.sampleTexts, ...this.loopTexts] : this.sampleTexts
    const next = this.queuedTexts.shift() ?? cyclePool[this.cycleIndex % cyclePool.length]
    this.cycleIndex += 1
    this.onText(next)
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
