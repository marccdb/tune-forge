import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { AudioEngine } from '../lib/audioEngine'
import {
  MIN_LOOP_DURATION_SEC,
  clamp,
  normalizeLoop,
  normalizePitchSemitones,
  normalizeTempo,
  makeFingerprint,
} from '../lib/math'
import { IndexedDbProjectRepository } from '../lib/projectRepository'
import {
  createFolderTrack,
  createTrackIndexId,
  getRelativePathFromInputFile,
  isSupportedMediaFile,
  normalizeRelativePath,
  sortTracksByPath,
} from '../lib/folderLibrary'
import { IndexedDbFolderLibraryRepository } from '../lib/folderLibraryRepository'
import type {
  FolderTrack,
  LibrarySnapshot,
  LoopMode,
  LoopRange,
  LoopSection,
  Marker,
  PracticeProject,
} from '../types/practice'

const SCHEMA_VERSION = 2
const repository = new IndexedDbProjectRepository()
const libraryRepository = new IndexedDbFolderLibraryRepository()

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

function normalizeLoopSection(section: LoopSection, durationSec: number): LoopSection {
  const normalized = normalizeLoop(
    {
      enabled: true,
      startSec: section.startSec,
      endSec: section.endSec,
      mode: 'forever',
    },
    durationSec,
  )

  return {
    ...section,
    startSec: normalized.startSec,
    endSec: normalized.endSec,
  }
}

function makeLoopSection(durationSec: number, startSec: number, endSec: number, name?: string): LoopSection {
  const section = normalizeLoopSection(
    {
      id: nextId(),
      name: name?.trim() || '',
      startSec,
      endSec,
      enabled: true,
    },
    durationSec,
  )
  return {
    ...section,
    name: section.name || `Section`,
  }
}

export const usePracticeStore = defineStore('practice', () => {
  const engine = new AudioEngine()
  const autosaveSuspended = ref(false)
  const isImporting = ref(false)
  const tracks = ref<FolderTrack[]>([])
  const activeTrackId = ref<string | null>(null)
  const loadingTrackId = ref<string | null>(null)
  const folderName = ref('')
  const isScanning = ref(false)
  const scanError = ref('')
  const folderConnected = ref(false)

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
  const loopSections = ref<LoopSection[]>([])
  const activeLoopSectionId = ref<string | null>(null)
  const markers = ref<Marker[]>([])
  const activeMarkerId = ref<string | null>(null)
  const error = ref('')
  const loadedFile = ref<File | null>(null)
  const folderHandle = ref<FileSystemDirectoryHandle | null>(null)
  const transientFiles = new Map<string, File>()

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
      loopSections: loopSections.value.map((section) => ({
        id: section.id,
        name: section.name,
        startSec: section.startSec,
        endSec: section.endSec,
        enabled: section.enabled,
      })),
      activeLoopSectionId: activeLoopSectionId.value,
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
      loopSections.value = []
      activeLoopSectionId.value = null
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

  function makeLibrarySnapshot(sourceType: 'directory-handle' | 'webkitdirectory'): LibrarySnapshot {
    return {
      folderName: folderName.value,
      tracks: tracks.value,
      activeTrackId: activeTrackId.value,
      sourceType,
      directoryHandle: sourceType === 'directory-handle' ? folderHandle.value : null,
      updatedAt: new Date().toISOString(),
    }
  }

  function clearTransientFiles() {
    transientFiles.clear()
  }

  async function saveLibrarySnapshot(sourceType: 'directory-handle' | 'webkitdirectory') {
    await libraryRepository.saveSnapshot(makeLibrarySnapshot(sourceType))
  }

  async function scanDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<FolderTrack[]> {
    const discoveredTracks: FolderTrack[] = []
    const seenTrackIds = new Set<string>()
    clearTransientFiles()

    async function walkDirectory(current: FileSystemDirectoryHandle, prefix: string) {
      for await (const entry of current.values()) {
        if (entry.kind === 'directory') {
          const childPath = prefix ? `${prefix}/${entry.name}` : entry.name
          await walkDirectory(entry, childPath)
          continue
        }

        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        if (!isSupportedMediaFile(file)) {
          continue
        }

        const relativePath = normalizeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name)
        const baseTrack = createFolderTrack(file, relativePath, 'directory-handle')
        const trackId = seenTrackIds.has(baseTrack.id)
          ? createTrackIndexId(relativePath, file.lastModified, file.size)
          : baseTrack.id
        const track = { ...baseTrack, id: trackId }
        seenTrackIds.add(track.id)
        discoveredTracks.push(track)
        transientFiles.set(track.id, file)
      }
    }

    await walkDirectory(handle, '')
    return sortTracksByPath(discoveredTracks)
  }

  function buildTracksFromInputFiles(files: Iterable<File>): FolderTrack[] {
    const discoveredTracks: FolderTrack[] = []
    const seenTrackIds = new Set<string>()
    clearTransientFiles()
    for (const file of files) {
      if (!isSupportedMediaFile(file)) continue
      const relativePath = getRelativePathFromInputFile(file)
      const baseTrack = createFolderTrack(file, relativePath, 'webkitdirectory')
      const trackId = seenTrackIds.has(baseTrack.id)
        ? createTrackIndexId(relativePath, file.lastModified, file.size)
        : baseTrack.id
      const track = { ...baseTrack, id: trackId }
      seenTrackIds.add(track.id)
      discoveredTracks.push(track)
      transientFiles.set(track.id, file)
    }
    return sortTracksByPath(discoveredTracks)
  }

  async function loadTrackFile(track: FolderTrack): Promise<File> {
    const directFile = transientFiles.get(track.id)
    if (directFile) return directFile

    if (track.sourceType === 'directory-handle' && folderHandle.value) {
      const pathParts = normalizeRelativePath(track.relativePath).split('/').filter(Boolean)
      if (pathParts.length === 0) {
        throw new Error('Track path is empty.')
      }

      let current = folderHandle.value
      for (const segment of pathParts.slice(0, -1)) {
        current = await current.getDirectoryHandle(segment)
      }

      const fileHandle = await current.getFileHandle(pathParts[pathParts.length - 1])
      const file = await fileHandle.getFile()
      transientFiles.set(track.id, file)
      return file
    }

    throw new Error('Track file unavailable. Re-import folder to reconnect files.')
  }

  async function selectTrack(trackId: string): Promise<void> {
    const track = tracks.value.find((item) => item.id === trackId)
    if (!track) return

    error.value = ''
    scanError.value = ''
    loadingTrackId.value = trackId
    try {
      const file = await loadTrackFile(track)
      await importFile(file)
      activeTrackId.value = trackId
      folderConnected.value = true
      await saveLibrarySnapshot(track.sourceType)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load selected track.'
      scanError.value = message
      folderConnected.value = false
    } finally {
      loadingTrackId.value = null
    }
  }

  async function importFolder(): Promise<void> {
    const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
    if (!pickerWindow.showDirectoryPicker) {
      scanError.value = 'Folder picker unavailable in this browser. Use fallback folder input.'
      return
    }

    isScanning.value = true
    scanError.value = ''
    try {
      const handle = await pickerWindow.showDirectoryPicker()
      folderHandle.value = handle
      folderName.value = handle.name
      tracks.value = await scanDirectoryHandle(handle)
      activeTrackId.value = null
      folderConnected.value = true

      if (tracks.value.length === 0) {
        scanError.value = 'No songs found.'
      }

      await saveLibrarySnapshot('directory-handle')
    } catch (scanIssue) {
      if (scanIssue instanceof DOMException && scanIssue.name === 'AbortError') {
        return
      }
      const message = scanIssue instanceof Error ? scanIssue.message : 'Unable to import folder.'
      scanError.value = message
      folderConnected.value = false
    } finally {
      isScanning.value = false
    }
  }

  async function importFolderFromFiles(fileList: FileList | File[]): Promise<void> {
    isScanning.value = true
    scanError.value = ''
    try {
      const files = Array.from(fileList)
      tracks.value = buildTracksFromInputFiles(files)
      activeTrackId.value = null
      folderHandle.value = null
      folderConnected.value = true

      const firstRelativePath = tracks.value[0]?.relativePath || (files[0] ? getRelativePathFromInputFile(files[0]) : '')
      const rootDir = firstRelativePath.split('/')[0]
      folderName.value = rootDir || 'Imported Folder'

      if (tracks.value.length === 0) {
        scanError.value = files.length > 0 ? 'Unsupported file type.' : 'No songs found.'
      }

      await saveLibrarySnapshot('webkitdirectory')
    } finally {
      isScanning.value = false
    }
  }

  async function refreshFolderScan(): Promise<void> {
    scanError.value = ''
    if (!folderHandle.value) {
      scanError.value = 'No connected folder handle. Re-import folder.'
      return
    }

    isScanning.value = true
    try {
      tracks.value = await scanDirectoryHandle(folderHandle.value)
      folderConnected.value = true
      if (tracks.value.length === 0) {
        scanError.value = 'No songs found.'
      }

      if (activeTrackId.value && !tracks.value.some((track) => track.id === activeTrackId.value)) {
        activeTrackId.value = null
      }

      await saveLibrarySnapshot('directory-handle')
    } catch (refreshIssue) {
      const message = refreshIssue instanceof Error ? refreshIssue.message : 'Failed to refresh folder.'
      scanError.value = message
      folderConnected.value = false
    } finally {
      isScanning.value = false
    }
  }

  async function restoreLastFolder(): Promise<void> {
    const snapshot = await libraryRepository.getSnapshot()
    if (!snapshot) return

    folderName.value = snapshot.folderName
    tracks.value = sortTracksByPath(snapshot.tracks)
    activeTrackId.value = snapshot.activeTrackId
    scanError.value = ''
    clearTransientFiles()

    if (snapshot.sourceType === 'directory-handle' && snapshot.directoryHandle) {
      folderHandle.value = snapshot.directoryHandle
      const permissionHandle = snapshot.directoryHandle as FileSystemDirectoryHandle & {
        queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
      }
      const permission = permissionHandle.queryPermission
        ? await permissionHandle.queryPermission({ mode: 'read' })
        : 'granted'
      folderConnected.value = permission === 'granted'

      if (!folderConnected.value) {
        scanError.value = 'Folder permission missing. Reconnect with Import Folder.'
        return
      }

      if (tracks.value.length === 0) {
        await refreshFolderScan()
      }

      if (activeTrackId.value) {
        await selectTrack(activeTrackId.value)
      }
      return
    }

    folderHandle.value = null
    folderConnected.value = false
    if (tracks.value.length > 0) {
      scanError.value = 'Folder needs re-import after reload in this browser.'
    }
  }

  function applyProject(project: PracticeProject) {
    tempo.value = normalizeTempo(project.tempo)
    pitchSemitones.value = normalizePitchSemitones(project.pitchSemitones)
    pitchCents.value = project.pitchCents
    volume.value = engine.setVolume(project.volume)
    const sourceDuration = durationSec.value || project.durationSec || MIN_LOOP_DURATION_SEC
    const migratedSections = (project.loopSections ?? [])
      .map((section, index) =>
        normalizeLoopSection(
          {
            id: section.id || nextId(),
            name: section.name?.trim() || `Section ${index + 1}`,
            startSec: section.startSec,
            endSec: section.endSec,
            enabled: (section as LoopSection & { enabled?: boolean }).enabled ?? project.loop.enabled ?? true,
          },
          sourceDuration,
        ),
      )
      .sort((a, b) => a.startSec - b.startSec)

    if (migratedSections.length === 0 && project.loop?.enabled) {
      const legacySection = normalizeLoopSection(
        {
          id: nextId(),
          name: 'Section 1',
          startSec: project.loop.startSec,
          endSec: project.loop.endSec,
          enabled: true,
        },
        sourceDuration,
      )
      migratedSections.push(legacySection)
    }

    loopSections.value = migratedSections.map((section, index) => ({
      ...section,
      name: section.name?.trim() || `Section ${index + 1}`,
    }))

    const requestedActiveId = project.activeLoopSectionId ?? null
    const activeSection =
      loopSections.value.find((section) => section.id === requestedActiveId) ?? loopSections.value[0] ?? null

    activeLoopSectionId.value = activeSection?.id ?? null
    loop.value = activeSection
      ? {
          enabled: activeSection.enabled,
          startSec: activeSection.startSec,
          endSec: activeSection.endSec,
          mode: project.loop.mode,
        }
      : createDefaultLoop(sourceDuration)

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
    if (!activeLoopSectionId.value) return
    setLoopSectionEnabled(activeLoopSectionId.value, enabled)
  }

  function updateLoop(nextLoop: LoopRange) {
    loop.value = normalizeLoop(nextLoop, durationSec.value || MIN_LOOP_DURATION_SEC)
    if (activeLoopSectionId.value) {
      loopSections.value = loopSections.value.map((section) =>
        section.id === activeLoopSectionId.value
          ? {
              ...section,
              startSec: loop.value.startSec,
              endSec: loop.value.endSec,
            }
          : section,
      )
    }
    engine.setLoop(loop.value)
  }

  function syncActiveLoopSectionToEngine() {
    const activeSection = loopSections.value.find((section) => section.id === activeLoopSectionId.value) ?? null
    if (!activeSection) {
      loop.value = { ...loop.value, enabled: false }
      engine.setLoop(loop.value)
      return
    }

    loop.value = normalizeLoop(
      {
        ...loop.value,
        enabled: activeSection.enabled,
        startSec: activeSection.startSec,
        endSec: activeSection.endSec,
      },
      durationSec.value || MIN_LOOP_DURATION_SEC,
    )
    engine.setLoop(loop.value)
  }

  function setLoopStartFromPlayhead() {
    if (!activeLoopSectionId.value) {
      const endSec = clamp(currentTimeSec.value + 4, 0, durationSec.value || currentTimeSec.value + 4)
      const created = makeLoopSection(durationSec.value || MIN_LOOP_DURATION_SEC, currentTimeSec.value, endSec)
      created.name = `Section ${loopSections.value.length + 1}`
      loopSections.value = [...loopSections.value, created].sort((a, b) => a.startSec - b.startSec)
      activeLoopSectionId.value = created.id
    }

    const nextSections = loopSections.value.map((section) =>
      section.id === activeLoopSectionId.value ? { ...section, startSec: currentTimeSec.value } : section,
    )
    loopSections.value = nextSections
      .map((section) => normalizeLoopSection(section, durationSec.value || MIN_LOOP_DURATION_SEC))
      .sort((a, b) => a.startSec - b.startSec)
    syncActiveLoopSectionToEngine()
  }

  function setLoopEndFromPlayhead() {
    if (!activeLoopSectionId.value) {
      const startSec = clamp(currentTimeSec.value - 4, 0, Math.max(0, (durationSec.value || currentTimeSec.value) - 4))
      const created = makeLoopSection(durationSec.value || MIN_LOOP_DURATION_SEC, startSec, currentTimeSec.value)
      created.name = `Section ${loopSections.value.length + 1}`
      loopSections.value = [...loopSections.value, created].sort((a, b) => a.startSec - b.startSec)
      activeLoopSectionId.value = created.id
    }

    const nextSections = loopSections.value.map((section) =>
      section.id === activeLoopSectionId.value ? { ...section, endSec: currentTimeSec.value } : section,
    )
    loopSections.value = nextSections
      .map((section) => normalizeLoopSection(section, durationSec.value || MIN_LOOP_DURATION_SEC))
      .sort((a, b) => a.startSec - b.startSec)
    syncActiveLoopSectionToEngine()
  }

  function resetLoop() {
    loop.value = createDefaultLoop(durationSec.value || 1)
    engine.setLoop(loop.value)
  }

  function addLoopSection() {
    const duration = durationSec.value || MIN_LOOP_DURATION_SEC
    const startSec = clamp(currentTimeSec.value, 0, Math.max(0, duration - MIN_LOOP_DURATION_SEC))
    const endSec = clamp(startSec + 4, MIN_LOOP_DURATION_SEC, duration)
    const section = makeLoopSection(duration, startSec, endSec, `Section ${loopSections.value.length + 1}`)
    loopSections.value = [...loopSections.value, section].sort((a, b) => a.startSec - b.startSec)
    activeLoopSectionId.value = section.id
    syncActiveLoopSectionToEngine()
  }

  function selectLoopSection(sectionId: string, jumpToStart = true) {
    const section = loopSections.value.find((value) => value.id === sectionId)
    if (!section) return
    activeLoopSectionId.value = section.id
    loop.value = {
      ...loop.value,
      enabled: section.enabled,
      startSec: section.startSec,
      endSec: section.endSec,
    }
    engine.setLoop(loop.value)
    if (jumpToStart) {
      seek(section.startSec)
    }
  }

  function clearActiveLoopSection() {
    activeLoopSectionId.value = null
    loop.value = { ...loop.value, enabled: false }
    engine.setLoop(loop.value)
  }

  function setLoopSectionEnabled(sectionId: string, enabled: boolean) {
    loopSections.value = loopSections.value.map((section) => (section.id === sectionId ? { ...section, enabled } : section))
    if (activeLoopSectionId.value === sectionId) {
      syncActiveLoopSectionToEngine()
    }
  }

  function setAllLoopSectionsEnabled(enabled: boolean) {
    if (loopSections.value.length === 0) return
    loopSections.value = loopSections.value.map((section) => ({ ...section, enabled }))
    syncActiveLoopSectionToEngine()
  }

  function removeLoopSection(sectionId: string) {
    loopSections.value = loopSections.value.filter((section) => section.id !== sectionId)
    if (activeLoopSectionId.value !== sectionId) return

    const nextSection = loopSections.value[0] ?? null
    if (!nextSection) {
      clearActiveLoopSection()
      return
    }

    selectLoopSection(nextSection.id, false)
  }

  function renameLoopSection(sectionId: string, name: string) {
    const trimmed = name.trim()
    loopSections.value = loopSections.value.map((section) =>
      section.id === sectionId
        ? {
            ...section,
            name: trimmed || section.name,
          }
        : section,
    )
  }

  function updateLoopSectionRange(sectionId: string, startSec: number, endSec: number) {
    const duration = durationSec.value || MIN_LOOP_DURATION_SEC
    loopSections.value = loopSections.value
      .map((section) =>
        section.id === sectionId
          ? normalizeLoopSection(
              {
                ...section,
                startSec,
                endSec,
              },
              duration,
            )
          : section,
      )
      .sort((a, b) => a.startSec - b.startSec)

    if (activeLoopSectionId.value === sectionId) {
      syncActiveLoopSectionToEngine()
    }
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
    () => [
      tempo.value,
      pitchSemitones.value,
      pitchCents.value,
      volume.value,
      loop.value,
      loopSections.value,
      activeLoopSectionId.value,
      markers.value,
    ],
    () => {
      if (autosaveSuspended.value) return
      void saveProject()
    },
    { deep: true },
  )

  return {
    tracks,
    activeTrackId,
    loadingTrackId,
    folderName,
    isScanning,
    scanError,
    folderConnected,
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
    loopSections,
    activeLoopSectionId,
    markers,
    activeMarkerId,
    error,
    loadedFile,
    isImporting,
    importFolder,
    importFolderFromFiles,
    restoreLastFolder,
    selectTrack,
    refreshFolderScan,
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
    addLoopSection,
    selectLoopSection,
    clearActiveLoopSection,
    removeLoopSection,
    renameLoopSection,
    updateLoopSectionRange,
    setLoopSectionEnabled,
    setAllLoopSectionsEnabled,
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
