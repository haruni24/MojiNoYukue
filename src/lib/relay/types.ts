import type { TrackingTrack } from '../../features/tracking/useTrackingSse'

/** テキスト表示指示 (Main App → Takeuchi) */
export type TakeuchiTextMessage = {
  type: 'takeuchi-text'
  id: string
  text: string
  yN: number
  hue: number
  at: number
}

/** OpenAI処理結果 (Main App → Takeuchi) */
export type TakeuchiAiTextMessage = {
  type: 'takeuchi-ai-text'
  id: string
  originalText: string
  processedText: string
  fragments: string[]
  mood: string
  style: { hue: number; scale: number; speed: number }
  at: number
}

/** トラッキングデータ中継 (Main App → Takeuchi) */
export type TakeuchiTracksMessage = {
  type: 'takeuchi-tracks'
  cameraIndex: number
  tracks: TrackingTrack[]
  ts: number
}

/** 接続確認 (Relay Server → Client) */
export type RelayHelloMessage = {
  type: 'relay-hello'
  version: number
  ts: number
}

/** クライアント状態報告 (Takeuchi → Relay Server) */
export type TakeuchiStatusMessage = {
  type: 'takeuchi-status'
  connected: boolean
  viewport: { w: number; h: number }
}

/** すべてのリレーメッセージ型 */
export type RelayMessage =
  | TakeuchiTextMessage
  | TakeuchiAiTextMessage
  | TakeuchiTracksMessage
  | RelayHelloMessage
  | TakeuchiStatusMessage
