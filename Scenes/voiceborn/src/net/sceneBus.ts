export type BusScope = 'broadcast' | 'group' | 'direct'

export type EventEnvelope = {
  schemaVersion: '1.0'
  eventId: string
  traceId: string
  seq: number
  serverTs: number
  clientTs: number
  sourceNodeId: string
  sourceApp: string
  room: string
  kind: string
  scope: BusScope
  target: { nodeId?: string; groupId?: string } | null
  priority: 'realtime' | 'reliable'
  payload: unknown
  latencyMs?: number
}

type JoinMessage = {
  type: 'join'
  authToken?: string
  nodeId: string
  sourceApp: string
  room: string
  groups: string[]
  lastSeq: number
}

type PublishMessage = {
  type: 'publish'
  envelope: Omit<EventEnvelope, 'seq' | 'serverTs' | 'sourceNodeId' | 'sourceApp' | 'room'> & {
    sourceNodeId: string
    sourceApp: string
    room: string
  }
}

type BusMessage =
  | { type: 'event'; replay: boolean; envelope: EventEnvelope }
  | { type: 'joined'; latestSeq: number }
  | { type: 'server.error'; code: string; message: string }

type PublishOptions = {
  scope?: BusScope
  target?: { nodeId?: string; groupId?: string } | null
  priority?: 'realtime' | 'reliable'
  traceId?: string
  eventId?: string
}

type SceneBusClientOptions = {
  enabled: boolean
  wsUrl: string
  authToken?: string
  nodeId: string
  sourceApp: string
  room: string
  groups: string[]
  storageKey?: string
}

type EventHandler = (envelope: EventEnvelope, replay: boolean) => void

type ErrorHandler = (message: string) => void

export class SceneBusClient {
  private readonly options: SceneBusClientOptions
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private reconnectAttempt = 0
  private handlers = new Set<EventHandler>()
  private errorHandlers = new Set<ErrorHandler>()
  private stopped = true
  private lastSeq = 0

  constructor(options: SceneBusClientOptions) {
    this.options = options
    this.lastSeq = readLastSeq(options.storageKey ?? this.defaultStorageKey())
  }

  start(): void {
    if (!this.options.enabled || this.socket) {
      return
    }
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.socket) {
      this.socket.close(1000, 'client_stop')
      this.socket = null
    }
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler)
    return () => {
      this.errorHandlers.delete(handler)
    }
  }

  publish(kind: string, payload: unknown, options?: PublishOptions): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }

    const msg: PublishMessage = {
      type: 'publish',
      envelope: {
        schemaVersion: '1.0',
        eventId: options?.eventId ?? crypto.randomUUID(),
        traceId: options?.traceId ?? crypto.randomUUID(),
        clientTs: Date.now(),
        sourceNodeId: this.options.nodeId,
        sourceApp: this.options.sourceApp,
        room: this.options.room,
        kind,
        scope: options?.scope ?? 'broadcast',
        target: options?.target ?? null,
        priority: options?.priority ?? 'realtime',
        payload,
      },
    }

    this.socket.send(JSON.stringify(msg))
    return true
  }

  private connect(): void {
    if (this.stopped) {
      return
    }

    try {
      const socket = new WebSocket(this.options.wsUrl)
      this.socket = socket

      socket.addEventListener('open', () => {
        this.reconnectAttempt = 0
        const join: JoinMessage = {
          type: 'join',
          authToken: this.options.authToken,
          nodeId: this.options.nodeId,
          sourceApp: this.options.sourceApp,
          room: this.options.room,
          groups: this.options.groups,
          lastSeq: this.lastSeq,
        }
        socket.send(JSON.stringify(join))
        this.startHeartbeat()
      })

      socket.addEventListener('message', (event) => {
        this.handleMessage(event.data)
      })

      socket.addEventListener('close', () => {
        this.stopHeartbeat()
        this.socket = null
        this.emitError(`scene-bus disconnected: ${this.options.wsUrl}`)
        if (!this.stopped) {
          this.scheduleReconnect()
        }
      })

      socket.addEventListener('error', () => {
        this.emitError(`scene-bus connection error: ${this.options.wsUrl}`)
      })
    } catch (error) {
      this.emitError(error instanceof Error ? error.message : 'scene-bus connect failed')
      this.scheduleReconnect()
    }
  }

  private handleMessage(raw: unknown): void {
    let parsed: BusMessage
    try {
      parsed = JSON.parse(String(raw)) as BusMessage
    } catch {
      this.emitError('scene-bus message parse failed')
      return
    }

    if (parsed.type === 'server.error') {
      this.emitError(`[${parsed.code}] ${parsed.message}`)
      return
    }

    if (parsed.type === 'joined') {
      if (Number.isFinite(parsed.latestSeq) && parsed.latestSeq > this.lastSeq) {
        this.lastSeq = parsed.latestSeq
      }
      return
    }

    if (parsed.type !== 'event') {
      return
    }

    const { envelope } = parsed
    if (typeof envelope.seq === 'number' && envelope.seq > this.lastSeq) {
      this.lastSeq = envelope.seq
      writeLastSeq(this.options.storageKey ?? this.defaultStorageKey(), this.lastSeq)
    }

    for (const handler of this.handlers) {
      handler(envelope, parsed.replay)
    }

    if (isReliableEvent(envelope)) {
      this.sendAck(envelope.seq)
    }
  }

  private sendAck(seq: number): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    this.socket.send(JSON.stringify({ type: 'ack', seq }))
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.stopped) {
      return
    }

    const delay = Math.min(6000, 400 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return
      }
      this.socket.send(
        JSON.stringify({
          type: 'heartbeat',
          clientTs: Date.now(),
        }),
      )
    }, 5000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private emitError(message: string): void {
    for (const handler of this.errorHandlers) {
      handler(message)
    }
  }

  private defaultStorageKey(): string {
    return `scene-bus:last-seq:${this.options.sourceApp}:${this.options.nodeId}:${this.options.room}`
  }
}

function isReliableEvent(envelope: EventEnvelope): boolean {
  return envelope.kind === 'control.command' || (envelope.kind === 'scene.cue' && envelope.priority === 'reliable')
}

function readLastSeq(storageKey: string): number {
  try {
    const raw = window.localStorage.getItem(storageKey)
    const seq = Number(raw)
    return Number.isFinite(seq) && seq > 0 ? seq : 0
  } catch {
    return 0
  }
}

function writeLastSeq(storageKey: string, seq: number): void {
  try {
    window.localStorage.setItem(storageKey, String(seq))
  } catch {
    // ignore
  }
}
