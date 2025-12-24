import { type RefObject } from 'react'
import './AudioPlayer.css'

export type AudioPlayerProps = {
  audioRef: RefObject<HTMLAudioElement | null>
  url: string
  fileName: string
  isPlaying: boolean
  currentTime: number
  duration: number
  outputDevices: MediaDeviceInfo[]
  selectedOutputId: string
  supportsSetSinkId: boolean
  outputError: string
  formatTime: (seconds: number) => string
  onTogglePlayback: () => void
  onStop: () => void
  onSeek: (time: number) => void
  onSelectOutput: (deviceId: string) => void
  onRequestPermission: () => void
  onLoadedMetadata: (duration: number) => void
  onTimeUpdate: (currentTime: number) => void
  onPlayStateChange: (isPlaying: boolean) => void
}

export function AudioPlayer({
  audioRef,
  url,
  fileName,
  isPlaying,
  currentTime,
  duration,
  outputDevices,
  selectedOutputId,
  supportsSetSinkId,
  outputError,
  formatTime,
  onTogglePlayback,
  onStop,
  onSeek,
  onSelectOutput,
  onRequestPermission,
  onLoadedMetadata,
  onTimeUpdate,
  onPlayStateChange,
}: AudioPlayerProps) {
  return (
    <div className="audio-player" aria-label="音声プレイヤー">
      <audio
        ref={audioRef}
        src={url || undefined}
        preload="metadata"
        onLoadedMetadata={(e) => onLoadedMetadata(e.currentTarget.duration)}
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onPlay={() => onPlayStateChange(true)}
        onPause={() => onPlayStateChange(false)}
        onEnded={() => onPlayStateChange(false)}
      />

      <div className="audio-player__row">
        <div className="audio-player__meta" title={fileName || '未選択'}>
          {fileName ? `♪ ${fileName}` : 'MP3未選択'}
        </div>
        <div className="audio-player__outputs">
          <label className="audio-player__outputLabel">
            出力
            <select
              className="glass-select"
              value={selectedOutputId}
              onChange={(e) => onSelectOutput(e.target.value)}
              disabled={!supportsSetSinkId || outputDevices.length === 0}
              aria-label="音声出力デバイス"
            >
              {outputDevices.length === 0 ? (
                <option value="default">出力デバイスなし</option>
              ) : (
                outputDevices.map((device, index) => (
                  <option key={`${device.deviceId}-${index}`} value={device.deviceId}>
                    {device.label || `出力デバイス ${index + 1}`}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={onRequestPermission}
            className="glass-button glass-button--secondary glass-button--compact"
          >
            名前を表示
          </button>
        </div>
        <div className="controls audio-player__buttons">
          <button
            type="button"
            onClick={onTogglePlayback}
            className="glass-button glass-button--secondary"
            disabled={!url}
          >
            {isPlaying ? '一時停止' : '再生'}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="glass-button glass-button--secondary"
            disabled={!url}
          >
            停止
          </button>
        </div>
      </div>

      <div className="audio-player__row audio-player__timeline">
        <span className="audio-player__time">{formatTime(currentTime)}</span>
        <input
          className="audio-player__slider"
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={duration ? Math.min(currentTime, duration) : 0}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={!url || !duration}
          aria-label="再生位置"
        />
        <span className="audio-player__time">{formatTime(duration)}</span>
      </div>

      {!supportsSetSinkId && (
        <div className="audio-player__hint">
          この環境では音声出力先の切り替え（Bluetooth含む）が未対応です（`setSinkId`非対応）。
        </div>
      )}
      {outputError && <div className="audio-player__hint audio-player__hint--error">{outputError}</div>}
    </div>
  )
}
