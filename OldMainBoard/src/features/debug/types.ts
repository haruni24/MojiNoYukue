export type RenderMode = 'composite' | 'raw' | 'mask' | 'background' | 'test'

export type DebugSnapshot = {
  at: string
  renderMode: RenderMode
  video: {
    readyState: number
    paused: boolean
    ended: boolean
    currentTime: number
    videoWidth: number
    videoHeight: number
  }
  canvas: {
    width: number
    height: number
    cssWidth: number
    cssHeight: number
  }
  stream?: {
    active: boolean
    track: {
      readyState: MediaStreamTrack['readyState']
      enabled: boolean
      muted: boolean
      settings: MediaTrackSettings
    }
  }
  segmenter?: {
    loaded: boolean
    labels: string[]
    confidenceMaskCount?: number
    selectedMaskIndex?: number
    maskWidth?: number
    maskHeight?: number
    maskStats?: {
      min: number
      max: number
      mean: number
      nanCount: number
      sample: number[]
    }
  }
  errors: string[]
}
