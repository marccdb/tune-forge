declare module 'soundtouchjs' {
  export interface PitchShifterPlayDetail {
    timePlayed: number
    formattedTimePlayed: string
    percentagePlayed: number
  }

  export class PitchShifter {
    constructor(
      context: AudioContext,
      buffer: AudioBuffer,
      bufferSize?: number,
      onEnd?: () => void,
    )
    tempo: number
    rate: number
    duration: number
    sampleRate: number
    percentagePlayed: number
    pitch: number
    pitchSemitones: number
    connect(node: AudioNode): void
    disconnect(): void
    on(eventName: 'play', cb: (detail: PitchShifterPlayDetail) => void): void
    off(eventName?: string | null): void
  }
}

