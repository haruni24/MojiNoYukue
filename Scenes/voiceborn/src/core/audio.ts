import type { AudioMetrics, SpeechChunk } from '../types/scene'

type AudioEngineOptions = {
  threshold?: number
  minSpeechMs?: number
  maxSilenceMs?: number
}

type ChunkHandler = (chunk: SpeechChunk) => void

type MetricsHandler = (metrics: AudioMetrics) => void

export class AudioEngine {
  private readonly stream: MediaStream
  private readonly analyser: AnalyserNode
  private readonly context: AudioContext
  private readonly source: MediaStreamAudioSourceNode
  private readonly dataArray: Uint8Array
  private readonly threshold: number
  private readonly minSpeechMs: number
  private readonly maxSilenceMs: number
  private readonly speechWarmupMs: number

  private onChunk: ChunkHandler | null = null
  private onMetrics: MetricsHandler | null = null

  private rafId: number | null = null
  private speaking = false
  private speechStart = 0
  private speakingMs = 0
  private speechCandidateStart = 0
  private silenceStart = 0
  private smoothedRms = 0
  private noiseFloor = 0.008

  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private meterSamples: number[] = []

  private constructor(stream: MediaStream, options?: AudioEngineOptions) {
    this.stream = stream
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 2048
    this.source.connect(this.analyser)

    this.dataArray = new Uint8Array(this.analyser.fftSize)
    this.threshold = options?.threshold ?? 0.038
    this.minSpeechMs = options?.minSpeechMs ?? 1100
    this.maxSilenceMs = options?.maxSilenceMs ?? 950
    this.speechWarmupMs = 140
  }

  static async create(options?: AudioEngineOptions): Promise<AudioEngine> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })

    return new AudioEngine(stream, options)
  }

  get mediaStream(): MediaStream {
    return this.stream
  }

  setChunkHandler(handler: ChunkHandler): void {
    this.onChunk = handler
  }

  setMetricsHandler(handler: MetricsHandler): void {
    this.onMetrics = handler
  }

  start(): void {
    if (this.rafId !== null) {
      return
    }
    this.rafId = requestAnimationFrame(this.tick)
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }

    this.source.disconnect()
    this.analyser.disconnect()

    this.stream.getTracks().forEach((t) => t.stop())
    void this.context.close()
  }

  private tick = (now: number): void => {
    this.analyser.getByteTimeDomainData(this.dataArray as Uint8Array<ArrayBuffer>)

    let sumSquares = 0
    for (let i = 0; i < this.dataArray.length; i += 1) {
      const normalized = (this.dataArray[i] - 128) / 128
      sumSquares += normalized * normalized
    }
    const rms = Math.sqrt(sumSquares / this.dataArray.length)
    this.smoothedRms = this.smoothedRms * 0.84 + rms * 0.16

    if (!this.speaking || this.smoothedRms < this.threshold * 1.2) {
      this.noiseFloor = this.noiseFloor * 0.985 + this.smoothedRms * 0.015
    }

    const startThreshold = Math.max(this.threshold, this.noiseFloor * 2.4 + 0.012)
    const endThreshold = Math.max(this.threshold * 0.72, this.noiseFloor * 1.8 + 0.007)

    if (this.smoothedRms >= startThreshold) {
      if (!this.speaking) {
        if (this.speechCandidateStart === 0) {
          this.speechCandidateStart = now
        }
        if (now - this.speechCandidateStart >= this.speechWarmupMs) {
          this.speaking = true
          this.speechStart = this.speechCandidateStart
          this.silenceStart = 0
          this.startRecorder()
        }
      } else {
        this.silenceStart = 0
        this.speakingMs = now - this.speechStart
        this.meterSamples.push(this.smoothedRms)
      }
    } else {
      this.speechCandidateStart = 0
      if (this.speaking) {
        if (this.smoothedRms <= endThreshold) {
          if (this.silenceStart === 0) {
            this.silenceStart = now
          }
        } else {
          this.silenceStart = 0
          this.meterSamples.push(this.smoothedRms)
        }

        const silenceMs = this.silenceStart > 0 ? now - this.silenceStart : 0
        if (silenceMs >= this.maxSilenceMs) {
          const durationMs = now - this.speechStart
          this.speaking = false
          this.speakingMs = 0
          this.silenceStart = 0
          this.speechCandidateStart = 0
          if (durationMs >= this.minSpeechMs) {
            this.stopRecorder(durationMs)
          } else {
            this.abortRecorder()
          }
        } else {
          this.speakingMs = now - this.speechStart
        }
      }
    }

    this.onMetrics?.({
      rms: this.smoothedRms,
      speaking: this.speaking,
      speakingMs: this.speakingMs,
      timestamp: now,
    })

    this.rafId = requestAnimationFrame(this.tick)
  }

  private startRecorder(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      return
    }

    this.chunks = []
    this.meterSamples = []

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    this.recorder = new MediaRecorder(this.stream, { mimeType })
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data)
      }
    }
    this.recorder.start(200)
  }

  private stopRecorder(durationMs: number): void {
    if (!this.recorder || this.recorder.state === 'inactive') {
      return
    }

    const avgVolume =
      this.meterSamples.length > 0
        ? this.meterSamples.reduce((a, b) => a + b, 0) / this.meterSamples.length
        : 0

    const recorder = this.recorder
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: recorder.mimeType })
      const isLikelyNoise = avgVolume < Math.max(this.threshold * 0.7, this.noiseFloor * 1.35) && durationMs < 1800
      if (blob.size > 0 && !isLikelyNoise) {
        this.onChunk?.({
          id: crypto.randomUUID(),
          blob,
          avgVolume,
          durationMs,
          createdAt: Date.now(),
        })
      }
      this.chunks = []
      this.recorder = null
    }

    recorder.stop()
  }

  private abortRecorder(): void {
    if (!this.recorder || this.recorder.state === 'inactive') {
      return
    }

    const recorder = this.recorder
    recorder.onstop = () => {
      this.chunks = []
      this.recorder = null
    }
    recorder.stop()
  }
}
