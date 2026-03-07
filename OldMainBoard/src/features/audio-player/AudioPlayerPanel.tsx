import { AudioPlayer } from './AudioPlayer'
import type { AudioOutputDevice } from './useAudioOutputDevices'
import { useAudioPlayer } from './useAudioPlayer'

export type AudioPlayerPanelProps = {
  outputDevices: AudioOutputDevice[]
  outputError: string
  isOutputLoading: boolean
  onRefreshOutputs: () => void
  onRemove?: () => void
}

export function AudioPlayerPanel({
  outputDevices,
  outputError,
  isOutputLoading,
  onRefreshOutputs,
  onRemove,
}: AudioPlayerPanelProps) {
  const player = useAudioPlayer()

  return (
    <>
      <AudioPlayer
        fileName={player.fileName}
        hasAudio={player.hasAudio}
        isPlaying={player.isPlaying}
        outputDevices={outputDevices}
        selectedOutputId={player.selectedOutputId}
        outputError={player.error || outputError}
        isOutputLoading={isOutputLoading}
        isReady={Boolean(player.playerId)}
        onUpload={player.triggerUpload}
        onTogglePlayback={player.togglePlayback}
        onStop={player.stop}
        onSelectOutput={player.selectOutput}
        onRefreshOutputs={onRefreshOutputs}
        onRemove={onRemove}
      />

      <input
        ref={player.fileInputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,.mp3"
        onChange={player.handleUpload}
        style={{ display: 'none' }}
      />
    </>
  )
}

