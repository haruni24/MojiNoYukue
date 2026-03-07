import {
  FilesetResolver,
  ImageSegmenter,
  PoseLandmarker,
  type ImageSegmenterResult,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import type { Landmark, ParticipantTrack, SegmentationFrame, VisionSnapshot } from '../types/scene'

type PoseTrack = {
  id: string
  centroid: { x: number; y: number }
  lastCentroid: { x: number; y: number }
  activeMs: number
  confidence: number
  score: number
  landmarks: Landmark[]
}

const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
const SEGMENT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'

export class VisionEngine {
  private poseLandmarker: PoseLandmarker
  private segmenter: ImageSegmenter
  private tracks = new Map<string, PoseTrack>()
  private nextTrackNumber = 1
  private lastTimestamp = 0

  private constructor(poseLandmarker: PoseLandmarker, segmenter: ImageSegmenter) {
    this.poseLandmarker = poseLandmarker
    this.segmenter = segmenter
  }

  static async create(): Promise<VisionEngine> {
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)

    const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: POSE_MODEL_URL,
      },
      runningMode: 'VIDEO',
      numPoses: 4,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    })

    const segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: SEGMENT_MODEL_URL,
      },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })

    return new VisionEngine(poseLandmarker, segmenter)
  }

  detect(video: HTMLVideoElement, timestamp: number): VisionSnapshot {
    const poseResult = this.poseLandmarker.detectForVideo(video, timestamp)
    const segmentationResult = this.segmenter.segmentForVideo(video, timestamp)

    this.updateTracksFromPose(poseResult, timestamp)

    const participants: ParticipantTrack[] = Array.from(this.tracks.values()).map((track) => {
      const velocity = {
        x: track.centroid.x - track.lastCentroid.x,
        y: track.centroid.y - track.lastCentroid.y,
      }
      return {
        id: track.id,
        centroid: track.centroid,
        velocity,
        confidence: track.confidence,
        activeMs: track.activeMs,
        score: track.score,
        isPrimary: false,
        landmarks: track.landmarks,
      }
    })

    const segmentation = this.createSegmentationFrame(segmentationResult)
    const silhouetteStrength = this.computeSilhouetteStrength(segmentation)

    this.lastTimestamp = timestamp

    return {
      participants,
      silhouetteStrength,
      segmentation,
      timestamp,
    }
  }

  dispose(): void {
    this.poseLandmarker.close()
    this.segmenter.close()
    this.tracks.clear()
  }

  private updateTracksFromPose(result: PoseLandmarkerResult, timestamp: number): void {
    const dt = Math.max(0, timestamp - this.lastTimestamp)
    const seenTrackIds = new Set<string>()

    result.landmarks.forEach((poseLandmarks) => {
      const centroid = this.computeCentroid(poseLandmarks)
      const confidence = this.computeConfidence(poseLandmarks)

      const matched = this.matchTrack(centroid)
      if (matched) {
        matched.lastCentroid = matched.centroid
        matched.centroid = centroid
        matched.confidence = confidence
        matched.landmarks = poseLandmarks.map((l) => ({
          x: l.x,
          y: l.y,
          z: l.z,
          visibility: l.visibility ?? 0,
        }))
        matched.activeMs += dt
        seenTrackIds.add(matched.id)
        return
      }

      const id = `p-${this.nextTrackNumber}`
      this.nextTrackNumber += 1
      this.tracks.set(id, {
        id,
        centroid,
        lastCentroid: centroid,
        confidence,
        activeMs: dt,
        score: 0,
        landmarks: poseLandmarks.map((l) => ({
          x: l.x,
          y: l.y,
          z: l.z,
          visibility: l.visibility ?? 0,
        })),
      })
      seenTrackIds.add(id)
    })

    for (const [trackId, track] of this.tracks.entries()) {
      if (!seenTrackIds.has(trackId)) {
        track.activeMs = Math.max(0, track.activeMs - dt * 2)
        track.score *= 0.92
        if (track.activeMs <= 0) {
          this.tracks.delete(trackId)
        }
      }
    }
  }

  private matchTrack(centroid: { x: number; y: number }): PoseTrack | null {
    let bestTrack: PoseTrack | null = null
    let bestDistance = 0.09

    for (const track of this.tracks.values()) {
      const dx = track.centroid.x - centroid.x
      const dy = track.centroid.y - centroid.y
      const distance = Math.hypot(dx, dy)
      if (distance < bestDistance) {
        bestDistance = distance
        bestTrack = track
      }
    }

    return bestTrack
  }

  private computeCentroid(landmarks: readonly { x: number; y: number }[]): { x: number; y: number } {
    if (landmarks.length === 0) {
      return { x: 0.5, y: 0.5 }
    }

    let x = 0
    let y = 0

    landmarks.forEach((l) => {
      x += l.x
      y += l.y
    })

    return {
      x: x / landmarks.length,
      y: y / landmarks.length,
    }
  }

  private computeConfidence(landmarks: readonly { visibility?: number }[]): number {
    if (landmarks.length === 0) {
      return 0
    }

    let sum = 0
    landmarks.forEach((l) => {
      sum += l.visibility ?? 0.5
    })

    return sum / landmarks.length
  }

  private createSegmentationFrame(result: ImageSegmenterResult): SegmentationFrame | null {
    const mask = result.confidenceMasks?.[0]
    if (!mask) {
      return null
    }

    const width = mask.width
    const height = mask.height
    const data = mask.getAsFloat32Array()
    if (data.length === 0) {
      return null
    }

    const alpha = new Uint8ClampedArray(width * height)
    for (let i = 0; i < data.length; i += 1) {
      const normalized = (data[i] - 0.08) / 0.9
      const value = Math.max(0, Math.min(1, normalized))
      alpha[i] = Math.round(value * 255)
    }

    return { alpha, width, height }
  }

  private computeSilhouetteStrength(segmentation: SegmentationFrame | null): number {
    if (!segmentation) {
      return 0
    }
    const data = segmentation.alpha

    const step = Math.max(1, Math.floor(data.length / 2000))
    let sum = 0
    let count = 0

    for (let i = 0; i < data.length; i += step) {
      sum += data[i] / 255
      count += 1
    }

    return count > 0 ? Math.min(1, sum / count) : 0
  }
}
