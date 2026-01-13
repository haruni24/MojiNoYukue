import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import './TrackedTextOverlay.css'
import { useTrackingSse, type TrackingTrack } from '../tracking/useTrackingSse'

type LabelSlotIndex = 0 | 1

type LabelSlot = {
  slot: LabelSlotIndex
  text: string
  assignedTrackId: number | null
  hue: number
  updatedAt: number
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
  { slot: 0, text: '', assignedTrackId: null, hue: 210, updatedAt: 0 },
  { slot: 1, text: '', assignedTrackId: null, hue: 35, updatedAt: 0 },
]

const getLargestTracks = (tracks: TrackingTrack[], count: number) => {
  return [...tracks].sort((a, b) => (b.areaN ?? 0) - (a.areaN ?? 0)).slice(0, count)
}

export function TrackedTextOverlay() {
  const [sseUrl, setSseUrl] = useState(() => loadLocalStorageString('tracking.sseUrl', 'http://127.0.0.1:8765/stream'))
  const [cameraIndex, setCameraIndex] = useState(() => loadLocalStorageNumber('tracking.cameraIndex', 0))
  const [mirrorX, setMirrorX] = useState(() => loadLocalStorageBoolean('tracking.mirrorX', true))
  const [input, setInput] = useState('')
  const [labels, setLabels] = useState<LabelSlot[]>(() => defaultLabels())

  const tracking = useTrackingSse(sseUrl, { enabled: Boolean(sseUrl) })

  const stageRef = useRef<HTMLDivElement>(null)
  const labelElsRef = useRef<Record<number, HTMLDivElement | null>>({ 0: null, 1: null })
  const markerElsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const springsRef = useRef<Record<number, SpringState>>({})
  const markerSpringsRef = useRef<Map<number, MarkerSpringState>>(new Map())
  const labelsRef = useRef<LabelSlot[]>(labels)
  const tracksRef = useRef<Map<number, TrackingTrack>>(new Map())
  const sourceSizeRef = useRef<{ w: number; h: number } | null>(null)
  const mirrorXRef = useRef<boolean>(mirrorX)

  labelsRef.current = labels
  mirrorXRef.current = mirrorX

  const currentMessage = tracking.tracksByCameraIndex[cameraIndex]
  const currentTracks = currentMessage?.tracks ?? []

  useEffect(() => {
    tracksRef.current = new Map(currentTracks.map((track) => [track.id, track]))
  }, [currentTracks])

  useEffect(() => {
    sourceSizeRef.current = currentMessage?.size ?? null
  }, [currentMessage?.size?.h, currentMessage?.size?.w])

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

  // 追跡IDの割り当て（既存割り当てを優先しつつ、空きがあれば大きいbboxから埋める）
  useEffect(() => {
    setLabels((prev) => {
      const active = prev.filter((slot) => slot.text.trim().length > 0)
      if (active.length === 0) return prev

      const visibleIds = new Set(currentTracks.map((track) => track.id))
      let changed = false

      const next = prev.map((slot) => {
        if (!slot.text.trim()) return slot
        if (slot.assignedTrackId !== null && visibleIds.has(slot.assignedTrackId)) {
          return slot
        }
        if (slot.assignedTrackId !== null) changed = true
        return { ...slot, assignedTrackId: null }
      })

      const used = new Set<number>(
        next.flatMap((slot) => (slot.text.trim() && slot.assignedTrackId !== null ? [slot.assignedTrackId] : []))
      )
      const candidates = currentTracks.filter((track) => !used.has(track.id))
      const sorted = getLargestTracks(candidates, 2)

      for (const slotIndex of [0, 1] as const) {
        const slot = next[slotIndex]
        if (!slot.text.trim()) continue
        if (slot.assignedTrackId !== null) continue
        const pick = sorted.shift()
        if (!pick) continue
        next[slotIndex] = { ...slot, assignedTrackId: pick.id }
        changed = true
      }

      return changed ? next : prev
    })
  }, [cameraIndex, currentTracks])

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
        const tracks = tracksRef.current
        const slots = labelsRef.current

        const source = sourceSizeRef.current
        const sourceW = source?.w ?? w
        const sourceH = source?.h ?? h
        const coverScale = Math.max(w / Math.max(1, sourceW), h / Math.max(1, sourceH))
        const displayW = sourceW * coverScale
        const displayH = sourceH * coverScale
        const offsetX = (w - displayW) / 2
        const offsetY = (h - displayH) / 2
        const toStageX = (xN: number) => offsetX + xN * sourceW * coverScale
        const toStageY = (yN: number) => offsetY + yN * sourceH * coverScale

        const activeTrackIds = new Set<number>()
        for (const [id, track] of tracks) {
          activeTrackIds.add(id)
          const el = markerElsRef.current.get(id)
          if (!el) continue

          const xN = clamp(mirrorXRef.current ? 1 - track.centerN[0] : track.centerN[0], 0, 1)
          const yN = clamp(track.centerN[1], 0, 1)
          const targetX = toStageX(xN)
          const targetY = toStageY(yN)
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

          const aopacity = (targetOpacity - spring.opacity) * (stiffness * 0.85) - spring.vOpacity * (damping * 0.8)
          spring.vOpacity += aopacity * dt
          spring.opacity += spring.vOpacity * dt
          spring.opacity = clamp(spring.opacity, 0, 1)

          el.style.setProperty('--x', `${spring.x.toFixed(2)}px`)
          el.style.setProperty('--y', `${spring.y.toFixed(2)}px`)
          el.style.setProperty('--size', `${spring.size.toFixed(2)}px`)
          el.style.setProperty('--opacity', `${spring.opacity.toFixed(4)}`)
          el.style.setProperty('--hue', `${spring.hue}`)
          el.style.zIndex = String(Math.round(12 + depth * 20))
        }

        for (const id of markerSpringsRef.current.keys()) {
          if (!activeTrackIds.has(id)) markerSpringsRef.current.delete(id)
        }

        for (const slot of slots) {
          const el = labelElsRef.current[slot.slot]
          if (!el) continue
          const visible = Boolean(slot.text.trim())
          if (!visible) {
            el.style.opacity = '0'
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

          const track = slot.assignedTrackId === null ? undefined : tracks.get(slot.assignedTrackId)

          let targetX = w * (slot.slot === 0 ? 0.35 : 0.65)
          let targetY = h * 0.75
          let targetScale = 0.98
          let targetOpacity = 0.22

          if (track) {
            const bboxH = clamp(track.bboxN[3] - track.bboxN[1], 0, 1)
            const yN = clamp(track.centerN[1] - bboxH * 0.42, 0.02, 0.98)
            const xN = clamp(mirrorXRef.current ? 1 - track.centerN[0] : track.centerN[0], 0.02, 0.98)
            targetX = toStageX(xN)
            targetY = toStageY(yN)

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
          el.style.zIndex = String(Math.round(10 + spring.scale * 100))
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = input.trim().slice(0, 80)
    if (!normalized) return

    setLabels((prev) => {
      const updatedAt = Date.now()
      const candidates = prev.filter((slot) => slot.text.trim().length === 0)
      let slotIndex: LabelSlotIndex = candidates.length > 0 ? candidates[0].slot : 0
      if (candidates.length === 0) {
        const oldest = prev.reduce((min, slot) => (slot.updatedAt < min.updatedAt ? slot : min), prev[0])
        slotIndex = oldest.slot
      }

      const next = prev.map((slot) => {
        if (slot.slot !== slotIndex) return slot
        return { ...slot, text: normalized, updatedAt }
      })
      return next
    })

    setInput('')
  }

  const clearSlot = (slotIndex: LabelSlotIndex) => {
    setLabels((prev) =>
      prev.map((slot) =>
        slot.slot === slotIndex ? { ...slot, text: '', assignedTrackId: null, updatedAt: Date.now() } : slot
      )
    )
  }

  return (
    <div className="trackedTextOverlay">
      <div ref={stageRef} className="trackedTextOverlay__stage" aria-hidden="true">
        {currentTracks.map((track) => (
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

        {labels.map((slot) => (
          <div
            key={slot.slot}
            ref={(el) => {
              labelElsRef.current[slot.slot] = el
            }}
            className="trackedTextOverlay__label"
            style={{ ['--hue' as unknown as string]: String(slot.hue) } as CSSProperties}
          >
            {slot.text}
            <span className="trackedTextOverlay__labelMeta">
              cam={cameraIndex} id={slot.assignedTrackId ?? '-'}
            </span>
          </div>
        ))}
      </div>

      <div className="trackedTextOverlay__hud">
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

        <form className="trackedTextOverlay__composer" onSubmit={handleSubmit}>
          <input
            className="trackedTextOverlay__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="文字を入力…（2つまで追従）"
            autoComplete="off"
            enterKeyHint="send"
            aria-label="追従文字"
          />
          <button type="submit" className="glass-button trackedTextOverlay__submit" disabled={!input.trim()}>
            送信
          </button>
        </form>

        <div className="trackedTextOverlay__slots">
          {labels
            .filter((slot) => slot.text.trim().length > 0)
            .map((slot) => (
              <div key={slot.slot} className="trackedTextOverlay__slotChip">
                <span className="trackedTextOverlay__slotChipText">
                  {slot.slot + 1}: {slot.text}
                </span>
                <button
                  type="button"
                  className="trackedTextOverlay__slotClear"
                  onClick={() => clearSlot(slot.slot)}
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
