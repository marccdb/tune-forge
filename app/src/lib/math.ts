import type { LoopRange } from '../types/practice'

export const MIN_TEMPO = 0.3
export const MAX_TEMPO = 2.5
export const MIN_PITCH = -12
export const MAX_PITCH = 12
export const MIN_LOOP_DURATION_SEC = 0.05

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeTempo(tempo: number): number {
  return clamp(tempo, MIN_TEMPO, MAX_TEMPO)
}

export function normalizePitchSemitones(value: number): number {
  return clamp(value, MIN_PITCH, MAX_PITCH)
}

export function normalizeLoop(loop: LoopRange, durationSec: number): LoopRange {
  const maxEnd = Math.max(durationSec, MIN_LOOP_DURATION_SEC)
  let startSec = clamp(loop.startSec, 0, Math.max(0, maxEnd - MIN_LOOP_DURATION_SEC))
  let endSec = clamp(loop.endSec, MIN_LOOP_DURATION_SEC, maxEnd)

  if (endSec - startSec < MIN_LOOP_DURATION_SEC) {
    endSec = clamp(startSec + MIN_LOOP_DURATION_SEC, MIN_LOOP_DURATION_SEC, maxEnd)
    startSec = clamp(endSec - MIN_LOOP_DURATION_SEC, 0, Math.max(0, maxEnd - MIN_LOOP_DURATION_SEC))
  }

  return {
    ...loop,
    startSec,
    endSec,
  }
}

export function makeFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

