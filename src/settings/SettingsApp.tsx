import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import '../App.css'
import './SettingsApp.css'

import { isTauri } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

import { CameraSelector, useVideoInputDevices } from '../features/camera'
import { useAudioOutputDevices, AudioPlayerPanel } from '../features/audio-player'
import type { RenderMode } from '../features/debug'

const CAMERA_DEVICE_KEY = 'camera.selectedDeviceId'
const BACKGROUND_DATA_URL_KEY = 'background.dataUrl'
const TRACKING_SSE_URL_KEY = 'tracking.sseUrl'
const TRACKING_CAMERA_INDEX_KEY = 'tracking.cameraIndex'
const TRACKING_MIRROR_X_KEY = 'tracking.mirrorX'
const DEBUG_ENABLED_KEY = 'debug.enabled'
const DEBUG_RENDER_MODE_KEY = 'debug.renderMode'
const DEBUG_MASK_INDEX_KEY = 'debug.selectedMaskIndex'

const readLocalStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeLocalStorage = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

const readNumber = (key: string, fallback: number) => {
  const value = readLocalStorage(key)
  if (value === null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const readBoolean = (key: string, fallback: boolean) => {
  const value = readLocalStorage(key)
  if (value === null) return fallback
  return value === 'true'
}

export function SettingsApp() {
  const current = useMemo(() => (isTauri() ? WebviewWindow.getCurrent() : null), [])

  const videoDevices = useVideoInputDevices()
  const [selectedCameraId, setSelectedCameraId] = useState(() => readLocalStorage(CAMERA_DEVICE_KEY) ?? '')

  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const [hasBackground, setHasBackground] = useState(() => Boolean(readLocalStorage(BACKGROUND_DATA_URL_KEY)))
  const [backgroundError, setBackgroundError] = useState('')

  const audioOutput = useAudioOutputDevices()
  const [audioPanels, setAudioPanels] = useState<number[]>(() => [1])
  const [nextAudioPanelId, setNextAudioPanelId] = useState(2)

  const [trackingSseUrl, setTrackingSseUrl] = useState(() => readLocalStorage(TRACKING_SSE_URL_KEY) ?? 'http://127.0.0.1:8765/stream')
  const [trackingCameraIndex, setTrackingCameraIndex] = useState(() => readNumber(TRACKING_CAMERA_INDEX_KEY, 0))
  const [trackingMirrorX, setTrackingMirrorX] = useState(() => readBoolean(TRACKING_MIRROR_X_KEY, true))

  const [debugEnabled, setDebugEnabled] = useState(() => readBoolean(DEBUG_ENABLED_KEY, false))
  const [debugRenderMode, setDebugRenderMode] = useState<RenderMode>(() => (readLocalStorage(DEBUG_RENDER_MODE_KEY) as RenderMode) ?? 'composite')
  const [debugMaskIndex, setDebugMaskIndex] = useState<string>(() => readLocalStorage(DEBUG_MASK_INDEX_KEY) ?? 'auto')

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (event.key === CAMERA_DEVICE_KEY) setSelectedCameraId(event.newValue ?? '')
      if (event.key === BACKGROUND_DATA_URL_KEY) setHasBackground(Boolean(event.newValue))
      if (event.key === TRACKING_SSE_URL_KEY) setTrackingSseUrl(event.newValue ?? '')
      if (event.key === TRACKING_CAMERA_INDEX_KEY) setTrackingCameraIndex(Number(event.newValue ?? 0))
      if (event.key === TRACKING_MIRROR_X_KEY) setTrackingMirrorX(event.newValue === 'true')
      if (event.key === DEBUG_ENABLED_KEY) setDebugEnabled(event.newValue === 'true')
      if (event.key === DEBUG_RENDER_MODE_KEY) setDebugRenderMode((event.newValue as RenderMode) ?? 'composite')
      if (event.key === DEBUG_MASK_INDEX_KEY) setDebugMaskIndex(event.newValue ?? 'auto')
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const addAudioPanel = () => {
    setAudioPanels((prev) => [...prev, nextAudioPanelId])
    setNextAudioPanelId((prev) => prev + 1)
  }

  const removeAudioPanel = (panelId: number) => {
    setAudioPanels((prev) => prev.filter((id) => id !== panelId))
  }

  const triggerBackgroundUpload = () => {
    setBackgroundError('')
    backgroundInputRef.current?.click()
  }

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    setBackgroundError('')
    try {
      const file = event.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
        reader.readAsDataURL(file)
      })
      writeLocalStorage(BACKGROUND_DATA_URL_KEY, dataUrl)
      setHasBackground(true)
    } catch (e) {
      setBackgroundError(e instanceof Error ? e.message : String(e))
    } finally {
      event.target.value = ''
    }
  }

  const removeBackground = () => {
    writeLocalStorage(BACKGROUND_DATA_URL_KEY, null)
    setHasBackground(false)
  }

  return (
    <div className="settingsApp">
      <div className="settingsApp__inner">
        <div className="settingsApp__header">
          <div className="settingsApp__title">調整ウインドウ</div>
          <button
            type="button"
            className="glass-button glass-button--secondary"
            onClick={() => {
              if (!current) return
              void current.close()
            }}
          >
            閉じる
          </button>
        </div>

        <section className="settingsApp__section">
          <h2 className="settingsApp__sectionTitle">カメラ</h2>
          {videoDevices.devices.length > 0 ? (
            <CameraSelector
              devices={videoDevices.devices}
              selectedDeviceId={selectedCameraId}
              onSelect={(deviceId) => {
                setSelectedCameraId(deviceId)
                writeLocalStorage(CAMERA_DEVICE_KEY, deviceId)
              }}
            />
          ) : (
            <div className="settingsApp__note">カメラが見つかりません（権限未許可の場合はメイン側で許可してください）</div>
          )}
        </section>

        <section className="settingsApp__section">
          <h2 className="settingsApp__sectionTitle">背景</h2>
          <div className="settingsApp__row">
            <button type="button" onClick={triggerBackgroundUpload} className="glass-button">
              背景画像をアップロード
            </button>
            {hasBackground && (
              <button type="button" onClick={removeBackground} className="glass-button glass-button--danger">
                背景を削除
              </button>
            )}
          </div>
          {backgroundError && <div className="settingsApp__note">背景設定エラー: {backgroundError}</div>}
          <input
            ref={backgroundInputRef}
            type="file"
            accept="image/*"
            onChange={handleBackgroundUpload}
            style={{ display: 'none' }}
          />
        </section>

        <section className="settingsApp__section">
          <h2 className="settingsApp__sectionTitle">音声（スピーカー選択）</h2>
          <div className="settingsApp__row">
            <button type="button" onClick={addAudioPanel} className="glass-button">
              音声プレイヤー追加
            </button>
          </div>
          <div className="audio-player-stack">
            {audioPanels.map((panelId) => (
              <AudioPlayerPanel
                key={panelId}
                outputDevices={audioOutput.devices}
                outputError={audioOutput.error}
                isOutputLoading={audioOutput.isLoading}
                onRefreshOutputs={audioOutput.refreshDevices}
                onRemove={audioPanels.length > 1 ? () => removeAudioPanel(panelId) : undefined}
              />
            ))}
          </div>
        </section>

        <section className="settingsApp__section">
          <h2 className="settingsApp__sectionTitle">追跡（コメント追従）</h2>
          <div className="settingsApp__row">
            <label className="settingsApp__field">
              SSE URL
              <input
                className="settingsApp__input"
                value={trackingSseUrl}
                onChange={(e) => {
                  const value = e.target.value
                  setTrackingSseUrl(value)
                  writeLocalStorage(TRACKING_SSE_URL_KEY, value)
                }}
                spellCheck={false}
              />
            </label>
          </div>
          <div className="settingsApp__row" style={{ marginTop: 10 }}>
            <label className="settingsApp__field">
              cam index
              <select
                className="settingsApp__select"
                value={String(trackingCameraIndex)}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  setTrackingCameraIndex(value)
                  writeLocalStorage(TRACKING_CAMERA_INDEX_KEY, String(value))
                }}
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i} value={String(i)}>
                    {i}
                  </option>
                ))}
              </select>
            </label>

            <label className="settingsApp__field">
              mirrorX
              <input
                type="checkbox"
                checked={trackingMirrorX}
                onChange={(e) => {
                  const value = e.target.checked
                  setTrackingMirrorX(value)
                  writeLocalStorage(TRACKING_MIRROR_X_KEY, String(value))
                }}
              />
            </label>
          </div>
        </section>

        <section className="settingsApp__section">
          <h2 className="settingsApp__sectionTitle">デバッグ</h2>
          <div className="settingsApp__row">
            <label className="settingsApp__field">
              debug
              <input
                type="checkbox"
                checked={debugEnabled}
                onChange={(e) => {
                  const value = e.target.checked
                  setDebugEnabled(value)
                  writeLocalStorage(DEBUG_ENABLED_KEY, String(value))
                }}
              />
            </label>

            <label className="settingsApp__field">
              renderMode
              <select
                className="settingsApp__select"
                value={debugRenderMode}
                onChange={(e) => {
                  const value = e.target.value as RenderMode
                  setDebugRenderMode(value)
                  writeLocalStorage(DEBUG_RENDER_MODE_KEY, value)
                }}
              >
                <option value="composite">合成（通常）</option>
                <option value="raw">元映像のみ</option>
                <option value="mask">マスクのみ</option>
                <option value="background">背景のみ</option>
                <option value="test">テストパターン</option>
              </select>
            </label>

            <label className="settingsApp__field">
              mask
              <select
                className="settingsApp__select"
                value={debugMaskIndex}
                onChange={(e) => {
                  const value = e.target.value
                  setDebugMaskIndex(value)
                  writeLocalStorage(DEBUG_MASK_INDEX_KEY, value)
                }}
              >
                <option value="auto">auto</option>
                {Array.from({ length: 6 }, (_, i) => (
                  <option key={i} value={String(i)}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="settingsApp__note">
            メイン画面は表示専用にしているため、デバッグログ表示は省略しています（必要なら別途イベント連携で表示できます）。
          </div>
        </section>
      </div>
    </div>
  )
}
