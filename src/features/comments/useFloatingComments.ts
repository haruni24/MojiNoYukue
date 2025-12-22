import { useCallback, useEffect, useRef, useState } from 'react'

export type FloatingComment = {
  id: string
  text: string
  createdAt: number
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
      setComments((prev) => [...prev, { id, text: normalized, createdAt }])

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

