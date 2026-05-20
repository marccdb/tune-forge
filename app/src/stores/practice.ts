import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { AudioEngine } from '../lib/audioEngine'
import {
  MIN_LOOP_DURATION_SEC,
  normalizeLoop,
  normalizePitchSemitones,
  normalizeTempo,
  makeFingerprint,
} from '../lib/math'
import { IndexedDbProjectRepository } from '../lib/projectRepository'
import type { LoopMode, LoopRange, Marker, PracticeProject } from '../types/practice'

const SCHEMA_VERSION = 1
const repository = new IndexedDbProjectRepository()

function nextId() {
  return Math.random().toString(36).slice(2, 10)
}

function createDefaultLoop(durationSec: number): LoopRange {
  return {
    enabled: false,
    startSec: 0,
    endSec: Math.max(durationSec, MIN_LOOP_DURATION_SEC),
    mode: 'forever',
  }
}

export const usePracticeStore = defineStore('practice', () => {
  const engine = new AudioEngine()
  const autosaveSuspended = ref(false)
  const isImporting = ref(false)

  const projectId = ref('')
  const trackName = ref('')
  const fingerprint = ref('')
  const fileObjectUrl = ref('')

  const tempo = ref(1)
  const pitchSemitones = ref(0)
  const pitchCents = ref(0)
  const volume = ref(1)
  const durationSec = ref(0)
  const currentTimeSec = ref(0)
  const isPlaying = ref(false)
  const loop = ref<LoopRange>(createDefaultLoop(1))
  const markers = ref<Marker[]>([])
  const activeMarkerId = ref<string | null>(null)
  const error = ref('')
  const loadedFile = ref<File | null>(null)

  const currentProject = computed<PracticeProject | null>(() => {
    if (!projectId.value) return null
    const projectLoop = loop.value
    const projectMarkers = markers.value
    return {
      id: projectId.value,
      schemaVersion: SCHEMA_VERSION,
      trackName: trackName.value,
      fingerprint: fingerprint.value,
      durationSec: durationSec.value,
      tempo: tempo.value,
      pitchSemitones: pitchSemitones.value,
      pitchCents: pitchCents.value,
      volume: volume.value,
      loop: {
        enabled: projectLoop.enabled,
        startSec: projectLoop.startSec,
        endSec: projectLoop.endSec,
        mode: projectLoop.mode,
      },
      markers: projectMarkers.map((marker) => ({
        id: marker.id,
        label: marker.label,
        timeSec: marker.timeSec,
      })),
      effects: {
        gain: volume.value,
        pan: 0,
      },
      updatedAt: new Date().toISOString(),
    }
  })

  const unsubscribeTime = engine.on('timeupdate', ({ currentTime, duration }) => {
    currentTimeSec.value = currentTime
    durationSec.value = duration
  })

  const unsubscribeState = engine.on('statechange', ({ isPlaying: playing }) => {
    isPlaying.value = playing
  })

  const unsubscribeError = engine.on('error', ({ message }) => {
    error.value = message
  })

  const unsubscribeLoaded = engine.on('loaded', ({ duration }) => {
    durationSec.value = duration
    loop.value = normalizeLoop(loop.value, duration)
  })

  function teardown() {
    unsubscribeTime()
    unsubscribeState()
    unsubscribeError()
    unsubscribeLoaded()
  }

  async function importFile(file: File): Promise<void> {
    autosaveSuspended.value = true
    isImporting.value = true

    try {
      error.value = ''
      loadedFile.value = file
      trackName.value = file.name
      fingerprint.value = makeFingerprint(file)
      projectId.value = fingerprint.value

      if (fileObjectUrl.value) {
        URL.revokeObjectURL(fileObjectUrl.value)
      }
      fileObjectUrl.value = URL.createObjectURL(file)

      await engine.loadFile(file)
      tempo.value = engine.setTempo(1)
      pitchSemitones.value = engine.setPitch(0)
      pitchCents.value = 0
      volume.value = engine.setVolume(1)
      currentTimeSec.value = 0
      loop.value = createDefaultLoop(durationSec.value)
      markers.value = []
      activeMarkerId.value = null
      engine.setLoop(loop.value)

      const existing = await repository.get(projectId.value)
      if (existing) {
        applyProject(existing)
      }
    } finally {
      isImporting.value = false
      autosaveSuspended.value = false
    }
  }

  function applyProject(project: PracticeProject) {
    tempo.value = normalizeTempo(project.tempo)
    pitchSemitones.value = normalizePitchSemitones(project.pitchSemitones)
    pitchCents.value = project.pitchCents
    volume.value = engine.setVolume(project.volume)
    loop.value = normalizeLoop(project.loop, durationSec.value || project.durationSec)
    markers.value = project.markers.slice().sort((a, b) => a.timeSec - b.timeSec)
    activeMarkerId.value = markers.value[0]?.id ?? null

    tempo.value = engine.setTempo(tempo.value)
    pitchSemitones.value = engine.setPitch(pitchSemitones.value)
    engine.setLoop(loop.value)
  }

  async function saveProject() {
    const project = currentProject.value
    if (!project) return
    await repository.save(project)
  }

  function setTempo(value: number) {
    tempo.value = engine.setTempo(value)
  }

  function setPitchSemitones(value: number) {
    pitchSemitones.value = engine.setPitch(value)
  }

  function setVolume(value: number) {
    volume.value = engine.setVolume(value)
  }

  function setLoopMode(mode: LoopMode) {
    loop.value = { ...loop.value, mode }
    engine.setLoop(loop.value)
  }

  function setLoopEnabled(enabled: boolean) {
    loop.value = { ...loop.value, enabled }
    engine.setLoop(loop.value)
  }

  function updateLoop(nextLoop: LoopRange) {
    loop.value = normalizeLoop(nextLoop, durationSec.value || MIN_LOOP_DURATION_SEC)
    engine.setLoop(loop.value)
  }

  function setLoopStartFromPlayhead() {
    updateLoop({ ...loop.value, startSec: currentTimeSec.value, enabled: true })
  }

  function setLoopEndFromPlayhead() {
    updateLoop({ ...loop.value, endSec: currentTimeSec.value, enabled: true })
  }

  function resetLoop() {
    updateLoop(createDefaultLoop(durationSec.value || 1))
  }

  function addMarker(label = '') {
    const marker: Marker = {
      id: nextId(),
      label: label || `M${markers.value.length + 1}`,
      timeSec: currentTimeSec.value,
    }
    markers.value = [...markers.value, marker].sort((a, b) => a.timeSec - b.timeSec)
    activeMarkerId.value = marker.id
  }

  function removeMarker(markerId: string) {
    markers.value = markers.value.filter((marker) => marker.id !== markerId)
    if (activeMarkerId.value === markerId) {
      activeMarkerId.value = markers.value[0]?.id ?? null
    }
  }

  function renameMarker(markerId: string, label: string) {
    markers.value = markers.value.map((marker) =>
      marker.id === markerId ? { ...marker, label: label.trim() || marker.label } : marker,
    )
  }

  function seek(seconds: number) {
    const clamped = Math.max(0, Math.min(durationSec.value || 0, seconds))
    engine.seek(clamped)
    currentTimeSec.value = clamped
  }

  function jumpToMarker(markerId: string) {
    const marker = markers.value.find((value) => value.id === markerId)
    if (!marker) return
    activeMarkerId.value = marker.id
    seek(marker.timeSec)
  }

  function jumpMarker(step: 1 | -1) {
    if (markers.value.length === 0) return
    const sorted = [...markers.value].sort((a, b) => a.timeSec - b.timeSec)
    const currentIdx = activeMarkerId.value
      ? sorted.findIndex((marker) => marker.id === activeMarkerId.value)
      : -1
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + step + sorted.length) % sorted.length
    jumpToMarker(sorted[nextIdx].id)
  }

  async function playPause() {
    if (isPlaying.value) {
      engine.pause()
    } else {
      await engine.play()
    }
  }

  function seekBy(deltaSec: number) {
    seek(Math.max(0, Math.min(durationSec.value, currentTimeSec.value + deltaSec)))
  }

  watch(
    () => [tempo.value, pitchSemitones.value, pitchCents.value, volume.value, loop.value, markers.value],
    () => {
      if (autosaveSuspended.value) return
      void saveProject()
    },
    { deep: true },
  )

  return {
    projectId,
    trackName,
    fingerprint,
    fileObjectUrl,
    tempo,
    pitchSemitones,
    pitchCents,
    volume,
    durationSec,
    currentTimeSec,
    isPlaying,
    loop,
    markers,
    activeMarkerId,
    error,
    loadedFile,
    isImporting,
    importFile,
    setTempo,
    setPitchSemitones,
    setVolume,
    setLoopMode,
    setLoopEnabled,
    updateLoop,
    setLoopStartFromPlayhead,
    setLoopEndFromPlayhead,
    resetLoop,
    addMarker,
    removeMarker,
    renameMarker,
    jumpToMarker,
    jumpMarker,
    seek,
    seekBy,
    playPause,
    saveProject,
    teardown,
  }
})
