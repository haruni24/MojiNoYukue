import './AudioPlayer.css'

export type AudioPlayerProps = {
  fileName: string
  hasAudio: boolean
  isPlaying: boolean
  outputDevices: Array<{ id: string; name: string }>
  selectedOutputId: string
  outputError: string
  isOutputLoading?: boolean
  isReady: boolean
  onUpload: () => void
  onTogglePlayback: () => void
  onStop: () => void
  onSelectOutput: (deviceId: string) => void
  onRefreshOutputs: () => void
  onRemove?: () => void
}

export function AudioPlayer({
  fileName,
  hasAudio,
  isPlaying,
  outputDevices,
  selectedOutputId,
  outputError,
  isOutputLoading,
  isReady,
  onUpload,
  onTogglePlayback,
  onStop,
  onSelectOutput,
  onRefreshOutputs,
  onRemove,
}: AudioPlayerProps) {
  return (
    <div className="audio-player" aria-label="音声プレイヤー">
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
              disabled={!isReady || outputDevices.length === 0}
              aria-label="音声出力デバイス"
            >
              {outputDevices.length === 0 ? (
                <option value="default">出力デバイスなし</option>
              ) : (
                outputDevices.map((device, index) => (
                  <option key={`${device.id}-${index}`} value={device.id}>
                    {device.name || `出力デバイス ${index + 1}`}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={onRefreshOutputs}
            className="glass-button glass-button--secondary glass-button--compact"
            disabled={isOutputLoading}
          >
            更新
          </button>
        </div>
        <div className="controls audio-player__buttons">
          <button type="button" onClick={onUpload} className="glass-button glass-button--secondary">
            MP3選択
          </button>
          <button
            type="button"
            onClick={onTogglePlayback}
            className="glass-button glass-button--secondary"
            disabled={!isReady || !hasAudio}
          >
            {isPlaying ? '一時停止' : '再生'}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="glass-button glass-button--secondary"
            disabled={!isReady}
          >
            停止
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} className="glass-button glass-button--danger">
              削除
            </button>
          )}
        </div>
      </div>
      {outputError && <div className="audio-player__hint audio-player__hint--error">{outputError}</div>}
    </div>
  )
}
