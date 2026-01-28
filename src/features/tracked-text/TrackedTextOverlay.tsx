import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import './TrackedTextOverlay.css'
import { useTrackingSse, type TrackingTrack } from '../tracking/useTrackingSse'
import { GlassText } from '../../components/GlassText'
import { MAX_FLOATING_TEXTS, PERSON_SCALE } from '../../config/scene'

export type TrackedTextOverlayProps = {
  showStatusControls?: boolean
  showMarkers?: boolean
}

type LabelSlotIndex = 0 | 1

type LabelSlot = {
  slot: LabelSlotIndex
  text: string
  assignedTrackId: number | null
  hue: number
  updatedAt: number
  assignedAt: number
}

type FloatingText = {
  id: string
  text: string
  hue: number
  createdAt: number
  xN: number
  yN: number
  driftX: number
  driftY: number
  driftDuration: number
  driftDelay: number
}

type SpringState = {
  x: number
  y: number
  vx: number
  vy: number
  scale: number
  vScale: number
  opacity: number
  vOpacity: number
  assignedTrackId: number | null
  pulseStartMs: number
}

type MarkerSpringState = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  vSize: number
  opacity: number
  vOpacity: number
  hue: number
}

type FloatingSpringState = {
  x: number
  y: number
  vx: number
  vy: number
  opacity: number
  vOpacity: number
}

type Cam1FlowState = {
  tracks: Map<number, { xN: number; yN: number; lastSeenAt: number }>
  sentAt: Map<number, number>
  cooldownUntil: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const loadLocalStorageString = (key: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key)
  return value === null ? fallback : value
}

const loadLocalStorageNumber = (key: string, fallback: number) => {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key)
  const parsed = value === null ? NaN : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const loadLocalStorageBoolean = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key)
  if (value === null) return fallback
  return value === 'true'
}

const saveLocalStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storageが無効でも動作させる
  }
}

const defaultLabels = (): LabelSlot[] => [
  { slot: 0, text: '', assignedTrackId: null, hue: 210, updatedAt: 0, assignedAt: 0 },
  { slot: 1, text: '', assignedTrackId: null, hue: 35, updatedAt: 0, assignedAt: 0 },
]

const getLargestTracks = (tracks: TrackingTrack[], count: number) => {
  return [...tracks].sort((a, b) => (b.areaN ?? 0) - (a.areaN ?? 0)).slice(0, count)
}

const createFloatingText = (text: string, hue: number): FloatingText => {
  const seed = Math.random()
  return {
    id: `float-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    text,
    hue,
    createdAt: Date.now(),
    xN: 0.2 + seed * 0.6,
    yN: 0.12 + Math.random() * 0.76,
    driftX: (Math.random() * 2 - 1) * 18,
    driftY: (Math.random() * 2 - 1) * 12,
    driftDuration: 6 + Math.random() * 6,
    driftDelay: Math.random() * 2.4,
  }
}

let echoTimers: number[] = []

const speakText = (text: string) => {
  if (typeof window === 'undefined') return
  const synth = window.speechSynthesis
  if (!synth) return
  echoTimers.forEach((id) => window.clearTimeout(id))
  echoTimers = []
  synth.cancel()

  const echoes = [
    { delay: 0, volume: 1, rate: 1, pitch: 1 },
    { delay: 140, volume: 0.62, rate: 0.98, pitch: 0.98 },
    { delay: 260, volume: 0.4, rate: 0.97, pitch: 0.97 },
    { delay: 380, volume: 0.26, rate: 0.96, pitch: 0.96 },
  ]

  for (const echo of echoes) {
    const id = window.setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'ja-JP'
      utterance.rate = echo.rate
      utterance.pitch = echo.pitch
      utterance.volume = echo.volume
      synth.speak(utterance)
    }, echo.delay)
    echoTimers.push(id)
  }
}

export function TrackedTextOverlay({ showStatusControls = true, showMarkers }: TrackedTextOverlayProps) {
  const resolvedShowMarkers = showMarkers ?? showStatusControls
  const [sseUrl, setSseUrl] = useState(() => loadLocalStorageString('tracking.sseUrl', 'http://127.0.0.1:8765/stream'))
  const [cameraIndex, setCameraIndex] = useState(() => loadLocalStorageNumber('tracking.cameraIndex', 0))
  const [mirrorX, setMirrorX] = useState(() => loadLocalStorageBoolean('tracking.mirrorX', true))
  const [input, setInput] = useState('')
  const [labels, setLabels] = useState<LabelSlot[]>(() => defaultLabels())
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([])

  const tracking = useTrackingSse(sseUrl, { enabled: Boolean(sseUrl) })

  const takeuchiChannelRef = useRef<BroadcastChannel | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const labelElsRef = useRef<Record<number, HTMLDivElement | null>>({ 0: null, 1: null })
  const markerElsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const springsRef = useRef<Record<number, SpringState>>({})
  const markerSpringsRef = useRef<Map<number, MarkerSpringState>>(new Map())
  const labelsRef = useRef<LabelSlot[]>(labels)
  const floatingElsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const floatingSpringsRef = useRef<Map<string, FloatingSpringState>>(new Map())
  const floatingTextsRef = useRef<FloatingText[]>(floatingTexts)
  const lastAssignedRef = useRef<Map<number, { text: string; hue: number; assignedAt: number }>>(new Map())
  const markerTracksRef = useRef<Map<number, TrackingTrack>>(new Map())
  const labelTracksRef = useRef<Map<number, TrackingTrack>>(new Map())
  const markerSourceSizeRef = useRef<{ w: number; h: number } | null>(null)
  const labelSourceSizeRef = useRef<{ w: number; h: number } | null>(null)
  const mirrorXRef = useRef<boolean>(mirrorX)
  const showMarkersRef = useRef<boolean>(resolvedShowMarkers)
  const cam1FlowRef = useRef<Cam1FlowState>({
    tracks: new Map(),
    sentAt: new Map(),
    cooldownUntil: 0,
  })
  useEffect(() => {
    labelsRef.current = labels
    const now = Date.now()
    const map = lastAssignedRef.current
    for (const slot of labels) {
      if (slot.assignedTrackId === null || !slot.text.trim()) continue
      map.set(slot.assignedTrackId, { text: slot.text, hue: slot.hue, assignedAt: slot.assignedAt || now })
    }
    for (const [id, entry] of map) {
      if (now - entry.assignedAt > 8000) {
        map.delete(id)
      }
    }
  }, [labels])

  useEffect(() => {
    floatingTextsRef.current = floatingTexts
  }, [floatingTexts])

  useEffect(() => {
    mirrorXRef.current = mirrorX
  }, [mirrorX])

  useEffect(() => {
    showMarkersRef.current = resolvedShowMarkers
    if (!resolvedShowMarkers) {
      markerElsRef.current.clear()
      markerSpringsRef.current.clear()
    }
  }, [resolvedShowMarkers])

  const currentMessage = tracking.tracksByCameraIndex[cameraIndex]
  const labelMessage = currentMessage
  const currentTracks = currentMessage?.tracks ?? []
  const labelTracks = labelMessage?.tracks ?? []

  useEffect(() => {
    markerTracksRef.current = new Map(currentTracks.map((track) => [track.id, track]))
  }, [currentTracks])

  useEffect(() => {
    markerSourceSizeRef.current = currentMessage?.size ?? null
  }, [currentMessage?.size?.h, currentMessage?.size?.w])

  useEffect(() => {
    labelSourceSizeRef.current = labelMessage?.size ?? null
  }, [labelMessage?.size?.h, labelMessage?.size?.w])

  const cameraOptions = useMemo(() => {
    if (tracking.cameras.length > 0) {
      return tracking.cameras
        .map((cam) => ({ index: cam.index, label: `cam ${cam.index} (${cam.source})` }))
        .sort((a, b) => a.index - b.index)
    }
    return [
      { index: 0, label: 'cam 0' },
      { index: 1, label: 'cam 1' },
    ]
  }, [tracking.cameras])

  useEffect(() => {
    saveLocalStorage('tracking.sseUrl', sseUrl)
  }, [sseUrl])

  useEffect(() => {
    saveLocalStorage('tracking.cameraIndex', String(cameraIndex))
  }, [cameraIndex])

  useEffect(() => {
    saveLocalStorage('tracking.mirrorX', String(mirrorX))
  }, [mirrorX])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (event.key === 'tracking.sseUrl' && typeof event.newValue === 'string') {
        setSseUrl(event.newValue)
      }
      if (event.key === 'tracking.cameraIndex' && typeof event.newValue === 'string') {
        const value = Number(event.newValue)
        if (Number.isFinite(value)) setCameraIndex(value)
      }
      if (event.key === 'tracking.mirrorX' && typeof event.newValue === 'string') {
        setMirrorX(event.newValue === 'true')
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('mojinoyukue-takeuchi')
    takeuchiChannelRef.current = channel
    return () => {
      channel.close()
      if (takeuchiChannelRef.current === channel) {
        takeuchiChannelRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    labelTracksRef.current = new Map(labelTracks.map((track) => [track.id, track]))
  }, [labelTracks])

  // 追跡IDの割り当て（既存割り当てを優先しつつ、空きがあれば大きいbboxから埋める）
  useEffect(() => {
    setLabels((prev) => {
      const now = Date.now()
      const active = prev.filter((slot) => slot.text.trim().length > 0)
      if (active.length === 0) return prev

      const visibleIds = new Set(labelTracks.map((track) => track.id))
      let changed = false

      const next = prev.map((slot) => {
        if (!slot.text.trim()) return slot
        if (slot.assignedTrackId !== null && visibleIds.has(slot.assignedTrackId)) {
          return slot
        }
        if (slot.assignedTrackId !== null) changed = true
        return { ...slot, assignedTrackId: null, assignedAt: now }
      })

      if (labelTracks.length === 1) {
        const onlyTrack = labelTracks[0]
        const activeSlots = next.filter((slot) => slot.text.trim())
        if (activeSlots.length === 0) return changed ? next : prev
        const mostRecent = activeSlots.reduce((latest, slot) =>
          slot.updatedAt >= latest.updatedAt ? slot : latest
        , activeSlots[0])

        const final = next.map((slot) => {
          if (!slot.text.trim()) return slot
          const shouldAssign = slot.slot === mostRecent.slot
          if (shouldAssign) {
            if (slot.assignedTrackId === onlyTrack.id) return slot
            changed = true
            return { ...slot, assignedTrackId: onlyTrack.id, assignedAt: now }
          }
          if (slot.assignedTrackId !== null) {
            changed = true
            return { ...slot, assignedTrackId: null, assignedAt: now }
          }
          return slot
        })

        return changed ? final : prev
      }

      const used = new Set<number>(
        next.flatMap((slot) => (slot.text.trim() && slot.assignedTrackId !== null ? [slot.assignedTrackId] : []))
      )
      const candidates = labelTracks.filter((track) => !used.has(track.id))
      const sorted = getLargestTracks(candidates, 2)

      for (const slotIndex of [0, 1] as const) {
        const slot = next[slotIndex]
        if (!slot.text.trim()) continue
        if (slot.assignedTrackId !== null) continue
        const pick = sorted.shift()
        if (!pick) continue
        next[slotIndex] = { ...slot, assignedTrackId: pick.id, assignedAt: now }
        changed = true
      }

      return changed ? next : prev
    })
  }, [cameraIndex, labelTracks])

  // 割り当てが変わったときの「吸い付き」パルス用
  useEffect(() => {
    const now = performance.now()
    for (const slot of labels) {
      const spring = springsRef.current[slot.slot]
      if (!spring) continue
      if (spring.assignedTrackId === slot.assignedTrackId) continue
      spring.assignedTrackId = slot.assignedTrackId
      spring.pulseStartMs = now
    }
  }, [labels])

  useEffect(() => {
    let rafId = 0
    let lastT = performance.now()

    const tick = (t: number) => {
      const stage = stageRef.current
      const rect = stage?.getBoundingClientRect()
      const w = rect?.width ?? 0
      const h = rect?.height ?? 0
      const dt = clamp((t - lastT) / 1000, 0, 0.05)
      lastT = t

      if (w > 1 && h > 1) {
        const markerTracks = showMarkersRef.current ? markerTracksRef.current : null
        const labelTracks = labelTracksRef.current
        const slots = labelsRef.current

        const buildMapper = (source: { w: number; h: number } | null) => {
          const sourceW = source?.w ?? w
          const sourceH = source?.h ?? h
          const coverScale = Math.max(w / Math.max(1, sourceW), h / Math.max(1, sourceH))
          const displayW = sourceW * coverScale
          const displayH = sourceH * coverScale
          const offsetX = (w - displayW) / 2
          const offsetY = (h - displayH) / 2
          return {
            toStageX: (xN: number) => offsetX + xN * sourceW * coverScale,
            toStageY: (yN: number) => offsetY + yN * sourceH * coverScale,
          }
        }

        const markerMapper = buildMapper(markerSourceSizeRef.current)
        const labelMapper = buildMapper(labelSourceSizeRef.current)

        if (markerTracks) {
          const activeTrackIds = new Set<number>()
          for (const [id, track] of markerTracks) {
            activeTrackIds.add(id)
            const el = markerElsRef.current.get(id)
            if (!el) continue

            const xN = clamp(mirrorXRef.current ? 1 - track.centerN[0] : track.centerN[0], 0, 1)
            const yN = clamp(track.centerN[1], 0, 1)
            const targetX = markerMapper.toStageX(xN)
            const targetY = markerMapper.toStageY(yN)
            const depth = clamp(Math.sqrt(clamp(track.areaN ?? 0, 0, 1)), 0, 1)
            const targetSize = clamp(16 + depth * 26, 14, 44)
            const targetOpacity = clamp(0.35 + (track.conf ?? 0) * 0.75, 0.25, 1)

            let spring = markerSpringsRef.current.get(id)
            if (!spring) {
              spring = {
                x: targetX,
                y: targetY,
                vx: 0,
                vy: 0,
                size: targetSize,
                vSize: 0,
                opacity: targetOpacity,
                vOpacity: 0,
                hue: (id * 67) % 360,
              }
              markerSpringsRef.current.set(id, spring)
            }

            const stiffness = 220
            const damping = 30
            const ax = (targetX - spring.x) * stiffness - spring.vx * damping
            const ay = (targetY - spring.y) * stiffness - spring.vy * damping
            spring.vx += ax * dt
            spring.vy += ay * dt
            spring.x += spring.vx * dt
            spring.y += spring.vy * dt

            const asize = (targetSize - spring.size) * (stiffness * 0.85) - spring.vSize * (damping * 0.9)
            spring.vSize += asize * dt
            spring.size += spring.vSize * dt

            const aopacity =
              (targetOpacity - spring.opacity) * (stiffness * 0.85) - spring.vOpacity * (damping * 0.8)
            spring.vOpacity += aopacity * dt
            spring.opacity += spring.vOpacity * dt
            spring.opacity = clamp(spring.opacity, 0, 1)

            el.style.setProperty('--x', `${spring.x.toFixed(2)}px`)
            el.style.setProperty('--y', `${spring.y.toFixed(2)}px`)
            el.style.setProperty('--size', `${spring.size.toFixed(2)}px`)
            el.style.setProperty('--opacity', `${spring.opacity.toFixed(4)}`)
            el.style.setProperty('--hue', `${spring.hue}`)
            el.style.zIndex = String(Math.round(1200 + depth * 20))
          }

          for (const id of markerSpringsRef.current.keys()) {
            if (!activeTrackIds.has(id)) markerSpringsRef.current.delete(id)
          }
        }

        if (floatingTextsRef.current.length > 0) {
          const freeHeight = Math.max(1, h * (1 - PERSON_SCALE))
          const activeFloatIds = new Set<string>()
          for (const float of floatingTextsRef.current) {
            activeFloatIds.add(float.id)
            const el = floatingElsRef.current.get(float.id)
            if (!el) continue

            const xN = clamp(float.xN, 0.08, 0.92)
            const yN = clamp(float.yN, 0.08, 0.92)
            const targetX = xN * w
            const targetY = yN * freeHeight

            let spring = floatingSpringsRef.current.get(float.id)
            if (!spring) {
              spring = {
                x: targetX,
                y: targetY,
                vx: 0,
                vy: 0,
                opacity: 0,
                vOpacity: 0,
              }
              floatingSpringsRef.current.set(float.id, spring)
            }

            const stiffness = 140
            const damping = 24
            const ax = (targetX - spring.x) * stiffness - spring.vx * damping
            const ay = (targetY - spring.y) * stiffness - spring.vy * damping
            spring.vx += ax * dt
            spring.vy += ay * dt
            spring.x += spring.vx * dt
            spring.y += spring.vy * dt

            const aopacity = (1 - spring.opacity) * (stiffness * 0.5) - spring.vOpacity * (damping * 0.8)
            spring.vOpacity += aopacity * dt
            spring.opacity += spring.vOpacity * dt
            spring.opacity = clamp(spring.opacity, 0, 1)

            el.style.setProperty('--x', `${spring.x.toFixed(2)}px`)
            el.style.setProperty('--y', `${spring.y.toFixed(2)}px`)
            el.style.setProperty('--opacity', `${spring.opacity.toFixed(4)}`)
          }

          for (const id of floatingSpringsRef.current.keys()) {
            if (!activeFloatIds.has(id)) floatingSpringsRef.current.delete(id)
          }
        }

        for (const slot of slots) {
          const el = labelElsRef.current[slot.slot]
          if (!el) continue
          const visible = Boolean(slot.text.trim())
          if (!visible) {
            el.style.opacity = ''
            el.style.setProperty('--opacity', '0')
            continue
          }

          const spring =
            springsRef.current[slot.slot] ??
            (springsRef.current[slot.slot] = {
              x: w * (slot.slot === 0 ? 0.35 : 0.65),
              y: h * 0.75,
              vx: 0,
              vy: 0,
              scale: 1,
              vScale: 0,
              opacity: 0,
              vOpacity: 0,
              assignedTrackId: slot.assignedTrackId,
              pulseStartMs: t,
            })

          const track = slot.assignedTrackId === null ? undefined : labelTracks.get(slot.assignedTrackId)

          let targetX = w * (slot.slot === 0 ? 0.35 : 0.65)
          let targetY = h * 0.75
          let targetScale = 0.98
          let targetOpacity = 0

          if (track) {
            const yN = clamp(track.centerN[1], 0.02, 0.98)
            const xN = clamp(mirrorXRef.current ? 1 - track.centerN[0] : track.centerN[0], 0.02, 0.98)
            targetX = labelMapper.toStageX(xN)
            targetY = labelMapper.toStageY(yN)

            const depth = clamp(Math.sqrt(clamp(track.areaN ?? 0, 0, 1)), 0, 1)
            targetScale = clamp(0.92 + depth * 1.15, 0.85, 1.9)
            targetOpacity = 1
          }

          // critically-damped寄りのスプリング
          const stiffness = 180
          const damping = 26
          const ax = (targetX - spring.x) * stiffness - spring.vx * damping
          const ay = (targetY - spring.y) * stiffness - spring.vy * damping
          spring.vx += ax * dt
          spring.vy += ay * dt
          spring.x += spring.vx * dt
          spring.y += spring.vy * dt

          const ascale = (targetScale - spring.scale) * (stiffness * 0.9) - spring.vScale * (damping * 0.85)
          spring.vScale += ascale * dt
          spring.scale += spring.vScale * dt

          const aopacity = (targetOpacity - spring.opacity) * (stiffness * 0.85) - spring.vOpacity * (damping * 0.8)
          spring.vOpacity += aopacity * dt
          spring.opacity += spring.vOpacity * dt

          spring.opacity = clamp(spring.opacity, 0, 1)

          const speed = Math.hypot(spring.vx, spring.vy)
          const rotation = clamp(spring.vx * 0.06, -18, 18)
          const blur = clamp(speed * 0.02, 0, 7)

          const pulseAge = (t - spring.pulseStartMs) / 1000
          const pulse = pulseAge >= 0 && pulseAge < 1.2
            ? 1 + Math.exp(-pulseAge * 6.5) * Math.sin(pulseAge * 14) * 0.12
            : 1

          el.style.setProperty('--x', `${spring.x.toFixed(2)}px`)
          el.style.setProperty('--y', `${spring.y.toFixed(2)}px`)
          el.style.setProperty('--scale', `${(spring.scale * pulse).toFixed(4)}`)
          el.style.setProperty('--rotation', `${rotation.toFixed(3)}deg`)
          el.style.setProperty('--blur', `${blur.toFixed(2)}px`)
          el.style.setProperty('--opacity', `${spring.opacity.toFixed(4)}`)
          el.style.zIndex = String(Math.round(1100 + spring.scale * 100))
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    if (!currentMessage) return

    const rightEdgeThreshold = 0.82
    const staleTrackMs = 2200
    const recentGoneMs = 1400
    const perTrackCooldownMs = 1800

    const state = cam1FlowRef.current

    const now = Date.now()
    const currentIds = new Set<number>()

    for (const track of currentMessage.tracks) {
      const xN = clamp(mirrorXRef.current ? 1 - track.centerN[0] : track.centerN[0], 0, 1)
      const yN = clamp(track.centerN[1], 0, 1)
      currentIds.add(track.id)
      state.tracks.set(track.id, { xN, yN, lastSeenAt: now })
    }

    for (const [id, info] of state.tracks) {
      if (currentIds.has(id)) continue
      const age = now - info.lastSeenAt
      const sentAt = state.sentAt.get(id) ?? 0
      if (
        age < recentGoneMs &&
        info.xN >= rightEdgeThreshold &&
        now >= state.cooldownUntil &&
        now - sentAt > perTrackCooldownMs
      ) {
        const assigned = lastAssignedRef.current.get(id)
        const fallback = labelsRef.current.find((slot) => slot.assignedTrackId === id && slot.text.trim())
        const text = assigned?.text ?? fallback?.text
        const hue = assigned?.hue ?? fallback?.hue
        if (text && typeof hue === 'number') {
          const payload = {
            type: 'takeuchi-text',
            id: `${now}-${Math.round(Math.random() * 1e6)}`,
            text,
            hue,
            yN: info.yN,
            at: now,
          }
          try {
            takeuchiChannelRef.current?.postMessage(payload)
          } catch {
            // ignore
          }
          try {
            window.localStorage.setItem('takeuchi.trigger', JSON.stringify(payload))
          } catch {
            // ignore
          }
          state.sentAt.set(id, now)
          state.cooldownUntil = now + 600
        }
      }
      if (age > staleTrackMs) {
        state.tracks.delete(id)
      }
    }
  }, [currentMessage, mirrorX])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = input.trim().slice(0, 80)
    if (!normalized) return

    const updatedAt = Date.now()
    const snapshot = labelsRef.current
    const empty = snapshot.filter((slot) => slot.text.trim().length === 0)
    let slotIndex: LabelSlotIndex = empty.length > 0 ? empty[0].slot : 0
    let pushedSlot: LabelSlot | null = null
    if (empty.length === 0) {
      const oldest = snapshot.reduce((min, slot) => (slot.updatedAt < min.updatedAt ? slot : min), snapshot[0])
      slotIndex = oldest.slot
      pushedSlot = oldest
    }

    if (pushedSlot && pushedSlot.text.trim()) {
      const floatItem = createFloatingText(pushedSlot.text, pushedSlot.hue)
      setFloatingTexts((prev) => [...prev, floatItem].slice(-MAX_FLOATING_TEXTS))
    }

    setLabels((prev) =>
      prev.map((slot) => (slot.slot === slotIndex ? { ...slot, text: normalized, updatedAt } : slot))
    )

    setInput('')
    speakText(normalized)
  }

  return (
    <div className="trackedTextOverlay">
      <svg className="glass-defs" aria-hidden="true" focusable="false">
        <filter id="glass-text-filter" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="a" />
          <feSpecularLighting
            in="a"
            surfaceScale="2.6"
            specularConstant="0.9"
            specularExponent="26"
            lightingColor="#ffffff"
            result="spec"
          >
            <feDistantLight azimuth="225" elevation="58" />
          </feSpecularLighting>
          <feComposite in="spec" in2="SourceAlpha" operator="in" result="specMask" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="specMask" />
          </feMerge>
        </filter>
      </svg>
      <div ref={stageRef} className="trackedTextOverlay__stage" aria-hidden="true">
        {resolvedShowMarkers &&
          currentTracks.map((track) => (
            <div
              key={`marker-${track.id}`}
              ref={(el) => {
                if (el) markerElsRef.current.set(track.id, el)
                else markerElsRef.current.delete(track.id)
              }}
              className="trackedTextOverlay__marker"
            >
              <span className="trackedTextOverlay__markerId">{track.id}</span>
            </div>
          ))}

        {floatingTexts.map((float) => (
          <div
            key={float.id}
            ref={(el) => {
              if (el) floatingElsRef.current.set(float.id, el)
              else floatingElsRef.current.delete(float.id)
            }}
            className="trackedTextOverlay__float"
            style={
              {
                ['--drift-x' as unknown as string]: `${float.driftX.toFixed(2)}px`,
                ['--drift-y' as unknown as string]: `${float.driftY.toFixed(2)}px`,
                ['--drift-duration' as unknown as string]: `${float.driftDuration.toFixed(2)}s`,
                ['--drift-delay' as unknown as string]: `${float.driftDelay.toFixed(2)}s`,
              } as CSSProperties
            }
          >
            <div className="trackedTextOverlay__floatInner">
              <GlassText className="trackedTextOverlay__floatText" text={float.text} hue={float.hue} />
            </div>
          </div>
        ))}

        {labels.map((slot) => (
          <div
            key={slot.slot}
            ref={(el) => {
              labelElsRef.current[slot.slot] = el
            }}
            className="trackedTextOverlay__label"
          >
            <GlassText className="trackedTextOverlay__labelText" text={slot.text} hue={slot.hue} />
            {showStatusControls && (
              <span className="trackedTextOverlay__labelMeta">
                cam={cameraIndex} id={slot.assignedTrackId ?? '-'}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="trackedTextOverlay__hud">
        {showStatusControls && (
          <>
            <div className="trackedTextOverlay__statusRow">
              <span className="trackedTextOverlay__badge">
                <span
                  className={[
                    'trackedTextOverlay__badgeDot',
                    tracking.status === 'open'
                      ? 'trackedTextOverlay__badgeDot--open'
                      : tracking.status === 'connecting'
                        ? 'trackedTextOverlay__badgeDot--connecting'
                        : tracking.status === 'error'
                          ? 'trackedTextOverlay__badgeDot--error'
                          : '',
                  ].join(' ')}
                />
                TRACKING
              </span>

              <label className="trackedTextOverlay__control">
                cam
                <select
                  className="trackedTextOverlay__select"
                  value={cameraIndex}
                  onChange={(e) => setCameraIndex(Number(e.target.value))}
                >
                  {cameraOptions.map((option) => (
                    <option key={option.index} value={option.index}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="trackedTextOverlay__control">
                mirrorX
                <input
                  type="checkbox"
                  checked={mirrorX}
                  onChange={(e) => setMirrorX(e.target.checked)}
                />
              </label>

              <input
                className="trackedTextOverlay__urlInput"
                value={sseUrl}
                onChange={(e) => setSseUrl(e.target.value)}
                placeholder="http://127.0.0.1:8765/stream"
                spellCheck={false}
              />
            </div>

            {tracking.error && <div className="trackedTextOverlay__error">{tracking.error}</div>}
          </>
        )}

        <form className="trackedTextOverlay__composer" onSubmit={handleSubmit}>
          <div
            className="trackedTextOverlay__inputShell"
            data-empty={input.length === 0 ? 'true' : 'false'}
          >
            <input
              className="trackedTextOverlay__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="文字を入力…（2つまで追従）"
              autoComplete="off"
              enterKeyHint="send"
              aria-label="追従文字"
            />
            <span className="trackedTextOverlay__inputGhost" aria-hidden="true">
              <GlassText
                className="trackedTextOverlay__inputGhostText"
                text={input.length === 0 ? '文字を入力…（2つまで追従）' : input}
                quality={input.length === 0 ? 'low' : 'high'}
              />
            </span>
          </div>
          <button type="submit" className="glass-button trackedTextOverlay__submit" disabled={!input.trim()}>
            ↑
          </button>
        </form>
      </div>
    </div>
  )
}
