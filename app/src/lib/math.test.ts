import { describe, expect, it } from 'vitest'
import {
  MAX_PITCH,
  MAX_TEMPO,
  MIN_PITCH,
  MIN_TEMPO,
  MIN_LOOP_DURATION_SEC,
  normalizeLoop,
  normalizePitchSemitones,
  normalizeTempo,
} from './math'

describe('normalizeTempo', () => {
  it('clamps to allowed range', () => {
    expect(normalizeTempo(0.01)).toBe(MIN_TEMPO)
    expect(normalizeTempo(8)).toBe(MAX_TEMPO)
    expect(normalizeTempo(1.25)).toBe(1.25)
  })
})

describe('normalizePitchSemitones', () => {
  it('clamps semitone values', () => {
    expect(normalizePitchSemitones(-100)).toBe(MIN_PITCH)
    expect(normalizePitchSemitones(100)).toBe(MAX_PITCH)
    expect(normalizePitchSemitones(3.5)).toBe(3.5)
  })
})

describe('normalizeLoop', () => {
  it('keeps minimum duration and bounds', () => {
    const normalized = normalizeLoop(
      {
        enabled: true,
        startSec: 9.99,
        endSec: 10,
        mode: 'forever',
      },
      10,
    )

    expect(normalized.endSec - normalized.startSec).toBeGreaterThanOrEqual(MIN_LOOP_DURATION_SEC)
    expect(normalized.endSec).toBeLessThanOrEqual(10)
    expect(normalized.startSec).toBeGreaterThanOrEqual(0)
  })
})

