import { useCallback, useEffect, useRef, useState } from 'react'

export type FloatingCommentStyle = {
  x: number          // 0-100 (%)
  y: number          // 0-100 (%)
  scale: number      // 0.8-2.0
  rotation: number   // -15 to 15 (deg)
  animation: number  // 0-4 (animation variant)
}

export type FloatingComment = {
  id: string
  text: string
  createdAt: number
  style: FloatingCommentStyle
}

export type UseFloatingCommentsOptions = {
  lifetimeMs?: number
  idFactory?: () => string
}

const defaultIdFactory = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const generateRandomStyle = (): FloatingCommentStyle => ({
  x: 10 + Math.random() * 80,           // 10-90%
  y: 10 + Math.random() * 60,           // 10-70%
  scale: 0.9 + Math.random() * 1.2,     // 0.9-2.1
  rotation: -12 + Math.random() * 24,   // -12 to 12 deg
  animation: Math.floor(Math.random() * 5), // 0-4
})

export function useFloatingComments(options: UseFloatingCommentsOptions = {}) {
  const lifetimeMs = options.lifetimeMs ?? 5200
  const idFactory = options.idFactory ?? defaultIdFactory

  const [comments, setComments] = useState<FloatingComment[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())

  const removeComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((comment) => comment.id !== id))
    const timerId = timersRef.current.get(id)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      timersRef.current.delete(id)
    }
  }, [])

  const clearComments = useCallback(() => {
    timersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId)
    })
    timersRef.current.clear()
    setComments([])
  }, [])

  const addComment = useCallback(
    (text: string) => {
      const normalized = text.trim()
      if (!normalized) return

      const id = idFactory()
      const createdAt = Date.now()
      const style = generateRandomStyle()
      setComments((prev) => [...prev, { id, text: normalized, createdAt, style }])

      const timerId = window.setTimeout(() => {
        removeComment(id)
      }, lifetimeMs)
      timersRef.current.set(id, timerId)
    },
    [idFactory, lifetimeMs, removeComment]
  )

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      timersRef.current.clear()
    }
  }, [])

  return {
    comments,
    lifetimeMs,
    addComment,
    removeComment,
    clearComments,
  }
}

