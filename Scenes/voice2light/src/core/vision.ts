import {
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter,
  PoseLandmarker,
  type HandLandmarkerResult,
  type ImageSegmenterResult,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import type { HandTrack, Landmark, ParticipantTrack, Vec2, VisionSnapshot } from '../types/scene'

type PoseTrack = {
  id: string
  centroid: Vec2
  lastCentroid: Vec2
  activeMs: number
  confidence: number
  score: number
  landmarks: Landmark[]
}

type HandTrackState = {
  id: string
  wrist: Vec2
  lastWrist: Vec2
  handedness: 'Left' | 'Right' | 'Unknown'
  confidence: number
  trail: Vec2[]
}

type VisionCreateOptions = {
  enableHands?: boolean
  enableSilhouette?: boolean
}

const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
const SEGMENT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'
const WASM_ROOT = '/wasm'

export class VisionEngine {
  private poseLandmarker: PoseLandmarker
  private segmenter: ImageSegmenter | null
  private handLandmarker: HandLandmarker | null

  private poseTracks = new Map<string, PoseTrack>()
  private handTracks = new Map<string, HandTrackState>()

  private nextPoseTrackNumber = 1
  private nextHandTrackNumber = 1
  private lastTimestamp = 0

  private constructor(
    poseLandmarker: PoseLandmarker,
    segmenter: ImageSegmenter | null,
    handLandmarker: HandLandmarker | null,
  ) {
    this.poseLandmarker = poseLandmarker
    this.segmenter = segmenter
    this.handLandmarker = handLandmarker
  }

  static async create(options?: VisionCreateOptions): Promise<VisionEngine> {
    const enableHands = options?.enableHands ?? false
    const enableSilhouette = options?.enableSilhouette ?? false
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)

    const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL,
      },
      runningMode: 'VIDEO',
      numPoses: 2,
      minPoseDetectionConfidence: 0.52,
      minPosePresenceConfidence: 0.52,
      minTrackingConfidence: 0.48,
      outputSegmentationMasks: false,
    })

    let segmenter: ImageSegmenter | null = null
    if (enableSilhouette) {
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: SEGMENT_MODEL_URL,
        },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
    }

    let handLandmarker: HandLandmarker | null = null
    if (enableHands) {
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      })
    }

    return new VisionEngine(poseLandmarker, segmenter, handLandmarker)
  }

  detect(video: HTMLVideoElement, timestamp: number): VisionSnapshot {
    const poseResult = this.poseLandmarker.detectForVideo(video, timestamp)
    const segmentationResult = this.segmenter ? this.segmenter.segmentForVideo(video, timestamp) : null
    const handResult = this.handLandmarker ? this.handLandmarker.detectForVideo(video, timestamp) : null

    this.updatePoseTracksFromResult(poseResult, timestamp)
    const hands = handResult ? this.updateHandTracksFromResult(handResult) : []

    const participants: ParticipantTrack[] = Array.from(this.poseTracks.values()).map((track) => ({
      id: track.id,
      centroid: track.centroid,
      velocity: {
        x: track.centroid.x - track.lastCentroid.x,
        y: track.centroid.y - track.lastCentroid.y,
      },
      confidence: track.confidence,
      activeMs: track.activeMs,
      score: track.score,
      isPrimary: false,
      landmarks: track.landmarks,
    }))

    const silhouetteStrength = this.computeSilhouetteStrength(segmentationResult)
    this.lastTimestamp = timestamp

    return {
      participants,
      hands,
      silhouetteStrength,
      timestamp,
    }
  }

  dispose(): void {
    this.poseLandmarker.close()
    this.segmenter?.close()
    this.handLandmarker?.close()
    this.poseTracks.clear()
    this.handTracks.clear()
  }

  private updatePoseTracksFromResult(result: PoseLandmarkerResult, timestamp: number): void {
    const dt = Math.max(0, timestamp - this.lastTimestamp)
    const seenTrackIds = new Set<string>()

    result.landmarks.forEach((poseLandmarks) => {
      const centroid = computeCentroid(poseLandmarks)
      const confidence = computePoseConfidence(poseLandmarks)

      const matched = matchPoseTrack(this.poseTracks, centroid)
      if (matched) {
        matched.lastCentroid = matched.centroid
        matched.centroid = centroid
        matched.confidence = confidence
        matched.landmarks = poseLandmarks.map((landmark) => ({
          x: landmark.x,
          y: landmark.y,
          z: landmark.z,
          visibility: landmark.visibility ?? 0,
        }))
        matched.activeMs += dt
        seenTrackIds.add(matched.id)
        return
      }

      const id = `p-${this.nextPoseTrackNumber}`
      this.nextPoseTrackNumber += 1
      this.poseTracks.set(id, {
        id,
        centroid,
        lastCentroid: centroid,
        confidence,
        activeMs: dt,
        score: 0,
        landmarks: poseLandmarks.map((landmark) => ({
          x: landmark.x,
          y: landmark.y,
          z: landmark.z,
          visibility: landmark.visibility ?? 0,
        })),
      })
      seenTrackIds.add(id)
    })

    for (const [trackId, track] of this.poseTracks.entries()) {
      if (!seenTrackIds.has(trackId)) {
        track.activeMs = Math.max(0, track.activeMs - dt * 2)
        track.score *= 0.9
        if (track.activeMs <= 0) {
          this.poseTracks.delete(trackId)
        }
      }
    }
  }

  private updateHandTracksFromResult(result: HandLandmarkerResult): HandTrack[] {
    const seenTrackIds = new Set<string>()
    const hands: HandTrack[] = []

    result.landmarks.forEach((landmarks, handIndex) => {
      const wrist = toVec2(landmarks[0])
      const thumbTip = toVec2(landmarks[4])
      const indexTip = toVec2(landmarks[8])
      const middleTip = toVec2(landmarks[12])

      const classification = result.handednesses?.[handIndex]?.[0]
      const handedness = normalizeHandedness(classification?.categoryName)
      const confidence = classification?.score ?? 0.6

      const matched = matchHandTrack(this.handTracks, wrist, handedness)
      const track = matched ?? createHandTrack(this.handTracks, wrist, handedness, this.nextHandTrackNumber++)

      track.lastWrist = track.wrist
      track.wrist = wrist
      track.handedness = handedness
      track.confidence = confidence
      track.trail.push(wrist)
      if (track.trail.length > 14) {
        track.trail.shift()
      }
      seenTrackIds.add(track.id)

      const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y)
      const pinchStrength = clamp01(1 - pinchDistance / 0.075)
      const velocity = {
        x: wrist.x - track.lastWrist.x,
        y: wrist.y - track.lastWrist.y,
      }

      hands.push({
        id: track.id,
        handedness: track.handedness,
        confidence: track.confidence,
        wrist,
        thumbTip,
        indexTip,
        middleTip,
        velocity,
        pinchStrength,
        isPinching: pinchStrength > 0.57,
        trail: [...track.trail],
      })
    })

    for (const [trackId] of this.handTracks.entries()) {
      if (!seenTrackIds.has(trackId)) {
        this.handTracks.delete(trackId)
      }
    }

    return hands
  }

  private computeSilhouetteStrength(result: ImageSegmenterResult | null): number {
    if (!result) {
      return 0
    }

    const mask = result.confidenceMasks?.[0]
    if (!mask) {
      return 0
    }

    const data = mask.getAsFloat32Array()
    if (data.length === 0) {
      return 0
    }

    const step = Math.max(1, Math.floor(data.length / 2000))
    let sum = 0
    let count = 0

    for (let i = 0; i < data.length; i += step) {
      sum += data[i]
      count += 1
    }

    return count > 0 ? Math.min(1, sum / count) : 0
  }
}

function computeCentroid(landmarks: readonly { x: number; y: number }[]): Vec2 {
  if (landmarks.length === 0) {
    return { x: 0.5, y: 0.5 }
  }

  let x = 0
  let y = 0
  landmarks.forEach((landmark) => {
    x += landmark.x
    y += landmark.y
  })

  return {
    x: x / landmarks.length,
    y: y / landmarks.length,
  }
}

function computePoseConfidence(landmarks: readonly { visibility?: number }[]): number {
  if (landmarks.length === 0) {
    return 0
  }

  let sum = 0
  landmarks.forEach((landmark) => {
    sum += landmark.visibility ?? 0.5
  })
  return sum / landmarks.length
}

function matchPoseTrack(tracks: Map<string, PoseTrack>, centroid: Vec2): PoseTrack | null {
  let bestTrack: PoseTrack | null = null
  let bestDistance = 0.09

  for (const track of tracks.values()) {
    const distance = Math.hypot(track.centroid.x - centroid.x, track.centroid.y - centroid.y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestTrack = track
    }
  }

  return bestTrack
}

function toVec2(landmark: { x: number; y: number }): Vec2 {
  return { x: landmark.x, y: landmark.y }
}

function normalizeHandedness(input: string | undefined): 'Left' | 'Right' | 'Unknown' {
  if (input === 'Left' || input === 'Right') {
    return input
  }
  return 'Unknown'
}

function matchHandTrack(
  tracks: Map<string, HandTrackState>,
  wrist: Vec2,
  handedness: 'Left' | 'Right' | 'Unknown',
): HandTrackState | null {
  let best: HandTrackState | null = null
  let bestDistance = 0.16

  for (const track of tracks.values()) {
    const handednessMismatch = handedness !== 'Unknown' && track.handedness !== 'Unknown' && track.handedness !== handedness
    if (handednessMismatch) {
      continue
    }

    const distance = Math.hypot(track.wrist.x - wrist.x, track.wrist.y - wrist.y)
    if (distance < bestDistance) {
      best = track
      bestDistance = distance
    }
  }

  return best
}

function createHandTrack(
  tracks: Map<string, HandTrackState>,
  wrist: Vec2,
  handedness: 'Left' | 'Right' | 'Unknown',
  serial: number,
): HandTrackState {
  const id = `h-${serial}`
  const state: HandTrackState = {
    id,
    wrist,
    lastWrist: wrist,
    handedness,
    confidence: 0,
    trail: [wrist],
  }
  tracks.set(id, state)
  return state
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}
