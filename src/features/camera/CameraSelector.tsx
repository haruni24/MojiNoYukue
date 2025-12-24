export type CameraSelectorProps = {
  devices: MediaDeviceInfo[]
  selectedDeviceId: string
  onSelect: (deviceId: string) => void
}

export function CameraSelector({ devices, selectedDeviceId, onSelect }: CameraSelectorProps) {
  return (
    <div className="camera-selector">
      {devices.map((device, index) => (
        <button
          key={device.deviceId}
          onClick={() => onSelect(device.deviceId)}
          className={`glass-button camera-selector__button ${selectedDeviceId === device.deviceId ? 'camera-selector__button--active' : ''}`}
        >
          {device.label || `カメラ ${index + 1}`}
        </button>
      ))}
    </div>
  )
}
