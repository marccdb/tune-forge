export type LoopMode = 'forever' | 'once'

export interface LoopRange {
  enabled: boolean
  startSec: number
  endSec: number
  mode: LoopMode
}

export interface Marker {
  id: string
  label: string
  timeSec: number
}

export interface EffectPreset {
  gain: number
  pan: number
}

export interface PracticeProject {
  id: string
  schemaVersion: number
  trackName: string
  fingerprint: string
  durationSec: number
  tempo: number
  pitchSemitones: number
  pitchCents: number
  volume: number
  loop: LoopRange
  markers: Marker[]
  effects: EffectPreset
  updatedAt: string
}

