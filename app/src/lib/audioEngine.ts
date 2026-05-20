import { PitchShifter, type PitchShifterPlayDetail } from 'soundtouchjs'
import type { LoopRange } from '../types/practice'
import { clamp, normalizeLoop, normalizeTempo, normalizePitchSemitones } from './math'

type EngineEventMap = {
  timeupdate: { currentTime: number; duration: number }
  statechange: { isPlaying: boolean }
  loaded: { duration: number }
  ended: void
  error: { message: string }
}

type Listener<K extends keyof EngineEventMap> = (payload: EngineEventMap[K]) => void

export class AudioEngine {
  private context: AudioContext | null = null
  private gainNode: GainNode | null = null
  private shifter: PitchShifter | null = null
  private duration = 0
  private isPlaying = false
  private loop: LoopRange = { enabled: false, startSec: 0, endSec: 1, mode: 'forever' }
  private listeners = new Map<keyof EngineEventMap, Set<Function>>()

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext()
      this.gainNode = this.context.createGain()
      this.gainNode.gain.value = 1
      this.gainNode.connect(this.context.destination)
    }

    return this.context
  }

  on<K extends keyof EngineEventMap>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener as Function)
    this.listeners.set(event, set)
    return () => set.delete(listener as Function)
  }

  private emit<K extends keyof EngineEventMap>(event: K, payload: EngineEventMap[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      ;(listener as Listener<K>)(payload)
    }
  }

  async loadFile(file: File): Promise<number> {
    try {
      this.pause()
      this.shifter?.off()
      const ctx = this.ensureContext()
      const arrayBuffer = await file.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))

      this.duration = audioBuffer.duration
      this.loop = normalizeLoop({ ...this.loop, endSec: this.duration }, this.duration)

      this.shifter = new PitchShifter(ctx, audioBuffer, 2048, () => {
        this.isPlaying = false
        this.emit('statechange', { isPlaying: false })
        this.emit('ended', undefined)
      })

      this.shifter.on('play', (detail: PitchShifterPlayDetail) => {
        const currentTime = detail.timePlayed
        this.emit('timeupdate', { currentTime, duration: this.duration })

        if (!this.loop.enabled) return
        if (currentTime >= this.loop.endSec) {
          if (this.loop.mode === 'once') {
            this.loop = { ...this.loop, enabled: false }
          } else {
            this.seek(this.loop.startSec)
          }
        }
      })

      this.emit('loaded', { duration: this.duration })
      return this.duration
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load audio'
      this.emit('error', { message })
      throw error
    }
  }

  async play(): Promise<void> {
    if (!this.shifter || !this.gainNode) return
    if (this.context?.state === 'suspended') {
      await this.context.resume()
    }
    if (!this.isPlaying) {
      this.shifter.connect(this.gainNode)
      this.isPlaying = true
      this.emit('statechange', { isPlaying: true })
    }
  }

  pause(): void {
    if (this.shifter && this.isPlaying) {
      this.shifter.disconnect()
      this.isPlaying = false
      this.emit('statechange', { isPlaying: false })
    }
  }

  seek(seconds: number): void {
    if (!this.shifter || this.duration <= 0) return
    const clamped = clamp(seconds, 0, this.duration)
    // soundtouchjs setter expects normalized ratio (0..1), not 0..100.
    this.shifter.percentagePlayed = clamped / this.duration
    this.emit('timeupdate', { currentTime: clamped, duration: this.duration })
  }

  setTempo(tempo: number): number {
    const normalized = normalizeTempo(tempo)
    if (this.shifter) {
      this.shifter.tempo = normalized
    }
    return normalized
  }

  setPitch(semitones: number): number {
    const normalized = normalizePitchSemitones(semitones)
    if (this.shifter) {
      this.shifter.pitchSemitones = normalized
    }
    return normalized
  }

  setVolume(value: number): number {
    const normalized = clamp(value, 0, 2)
    if (this.gainNode) {
      this.gainNode.gain.value = normalized
    }
    return normalized
  }

  setLoop(loop: LoopRange): void {
    this.loop = loop
  }

  getDuration(): number {
    return this.duration
  }
}
