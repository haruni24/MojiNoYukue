import { useCallback, useEffect, useRef, useState } from 'react'
import type { RelayMessage } from './types'

export type RelayConnectionStatus = 'idle' | 'connecting' | 'open' | 'error'

export type UseRelayWebSocketOptions = {
  enabled?: boolean
  onMessage?: (msg: RelayMessage) => void
}

export type UseRelayWebSocketReturn = {
  status: RelayConnectionStatus
  error: string
  sendMessage: (msg: RelayMessage) => void
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000]

export function useRelayWebSocket(
  url: string,
  options: UseRelayWebSocketOptions = {},
): UseRelayWebSocketReturn {
  const { enabled = true, onMessage } = options
  const [status, setStatus] = useState<RelayConnectionStatus>('idle')
  const [error, setError] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const sendMessage = useCallback((msg: RelayMessage) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!enabled || !url) {
      setStatus('idle')
      setError('')
      return
    }

    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (disposed) return
      setStatus('connecting')
      setError('')

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (disposed) { ws.close(); return }
        setStatus('open')
        setError('')
        retriesRef.current = 0
      }

      ws.onmessage = (event) => {
        if (disposed) return
        try {
          const data = JSON.parse(event.data) as RelayMessage
          onMessageRef.current?.(data)
        } catch {
          // invalid JSON
        }
      }

      ws.onerror = () => {
        if (disposed) return
        setError('WebSocketリレーサーバに接続できません')
      }

      ws.onclose = () => {
        if (disposed) return
        wsRef.current = null
        setStatus('error')

        const delay = RECONNECT_DELAYS[Math.min(retriesRef.current, RECONNECT_DELAYS.length - 1)]
        retriesRef.current++
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      const ws = wsRef.current
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        ws.close()
        wsRef.current = null
      }
    }
  }, [enabled, url])

  return { status, error, sendMessage }
}
