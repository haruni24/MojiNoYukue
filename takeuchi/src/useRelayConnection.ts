import { useCallback, useEffect, useRef, useState } from 'react'

export type RelayConnectionStatus = 'idle' | 'connecting' | 'open' | 'error'

export type UseRelayConnectionOptions = {
  enabled?: boolean
  onMessage?: (data: unknown) => void
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000]

/**
 * Takeuchi App 用 WebSocket 受信 Hook
 * URLパラメータ ?relay=ws://... またはデフォルトURL で接続
 */
export function useRelayConnection(options: UseRelayConnectionOptions = {}) {
  const { enabled = true, onMessage } = options
  const [status, setStatus] = useState<RelayConnectionStatus>('idle')
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const retriesRef = useRef(0)

  const url = getRelayUrl()

  useEffect(() => {
    if (!enabled || !url) {
      setStatus('idle')
      return
    }

    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (disposed) return
      setStatus('connecting')

      const ws = new WebSocket(url)

      ws.onopen = () => {
        if (disposed) { ws.close(); return }
        setStatus('open')
        retriesRef.current = 0
      }

      ws.onmessage = (event) => {
        if (disposed) return
        try {
          const data = JSON.parse(event.data) as unknown
          onMessageRef.current?.(data)
        } catch {
          // invalid JSON
        }
      }

      ws.onclose = () => {
        if (disposed) return
        setStatus('error')
        const delay = RECONNECT_DELAYS[Math.min(retriesRef.current, RECONNECT_DELAYS.length - 1)]
        retriesRef.current++
        reconnectTimer = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        // onclose will fire after this
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [enabled, url])

  return { status, url }
}

function getRelayUrl(): string {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('relay') ?? ''
}
