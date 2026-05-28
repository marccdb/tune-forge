import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePracticeStore } from './practice'
import type { LibrarySnapshot } from '../types/practice'

let mockLibrarySnapshot: LibrarySnapshot | undefined

vi.mock('../lib/audioEngine', () => {
  class MockAudioEngine {
    on() {
      return () => {}
    }
    async loadFile() {
      return 0
    }
    async loadArrayBuffer() {
      return 0
    }
    async play() {}
    pause() {}
    seek() {}
    setTempo(value: number) {
      return value
    }
    setPitch(value: number) {
      return value
    }
    setVolume(value: number) {
      return value
    }
    setLoop() {}
    getDuration() {
      return 0
    }
  }

  return { AudioEngine: MockAudioEngine }
})

vi.mock('../lib/projectRepository', () => {
  class MockProjectRepository {
    async get() {
      return undefined
    }
    async list() {
      return []
    }
    async save() {}
    async delete() {}
  }
  return { IndexedDbProjectRepository: MockProjectRepository }
})

vi.mock('../lib/folderLibraryRepository', () => {
  class MockFolderLibraryRepository {
    async getSnapshot() {
      return mockLibrarySnapshot
    }
    async saveSnapshot() {}
    async clearSnapshot() {}
  }
  return { IndexedDbFolderLibraryRepository: MockFolderLibraryRepository }
})

function makeDesktopTrack(id: string) {
  return {
    id,
    name: `${id}.mp3`,
    relativePath: `${id}.mp3`,
    fingerprint: `${id}.mp3:1:1`,
    lastModified: 1,
    size: 1,
  }
}

describe('practice store refreshFolderScan desktop flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockLibrarySnapshot = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete window.desktopApi
    mockLibrarySnapshot = undefined
  })

  it('refreshFolderScan without desktop folder returns early error', async () => {
    const store = usePracticeStore()

    await store.refreshFolderScan()

    expect(store.scanError).toBe('Folder refresh unavailable. Re-import folder.')
    expect(store.folderConnected).toBe(false)
    expect(store.isScanning).toBe(false)
  })

  it('desktop import + refresh uses desktopApi.refreshFolder(folderId)', async () => {
    const pickFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        folderId: 'folder-1',
        folderName: 'Practice',
        tracks: [makeDesktopTrack('a')],
      },
    }))
    const refreshFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        tracks: [makeDesktopTrack('b')],
      },
    }))
    const readTrack = vi.fn(async () => ({
      ok: true as const,
      data: { name: 'b.mp3', mimeType: 'audio/mpeg', arrayBuffer: new ArrayBuffer(0) },
    }))

    window.desktopApi = { pickFolder, refreshFolder, readTrack }

    const store = usePracticeStore()
    await store.importFolder()
    await store.refreshFolderScan()

    expect(pickFolder).toHaveBeenCalledTimes(1)
    expect(refreshFolder).toHaveBeenCalledWith('folder-1')
    expect(store.folderConnected).toBe(true)
    expect(store.scanError).toBe('')
    expect(store.tracks.length).toBe(1)
    expect(store.tracks[0].sourceType).toBe('desktop-directory')
  })

  it('cancelled folder picker keeps existing folder state intact', async () => {
    const pickFolder = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        data: {
          folderId: 'folder-1',
          folderName: 'Practice',
          tracks: [makeDesktopTrack('a')],
        },
      })
      .mockResolvedValueOnce({
        ok: false as const,
        code: 'PICKER_CANCELLED',
        message: 'Folder selection cancelled.',
      })
    const refreshFolder = vi.fn(async () => ({
      ok: true as const,
      data: { tracks: [makeDesktopTrack('a')] },
    }))
    const readTrack = vi.fn(async () => ({
      ok: true as const,
      data: { name: 'a.mp3', mimeType: 'audio/mpeg', arrayBuffer: new ArrayBuffer(0) },
    }))

    window.desktopApi = { pickFolder, refreshFolder, readTrack }

    const store = usePracticeStore()
    await store.importFolder()
    expect(store.folderConnected).toBe(true)
    expect(store.tracks.map((track) => track.id)).toEqual(['a'])

    await store.importFolder()

    expect(store.folderConnected).toBe(true)
    expect(store.scanError).toBe('')
    expect(store.tracks.map((track) => track.id)).toEqual(['a'])
  })

  it('refreshFolder failure maps error and disconnects folder', async () => {
    const pickFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        folderId: 'folder-1',
        folderName: 'Practice',
        tracks: [makeDesktopTrack('a')],
      },
    }))
    const refreshFolder = vi.fn(async () => ({
      ok: false as const,
      code: 'folder_unavailable',
      message: 'Folder moved or unavailable.',
    }))
    const readTrack = vi.fn(async () => ({
      ok: true as const,
      data: { name: 'a.mp3', mimeType: 'audio/mpeg', arrayBuffer: new ArrayBuffer(0) },
    }))

    window.desktopApi = { pickFolder, refreshFolder, readTrack }

    const store = usePracticeStore()
    await store.importFolder()
    await store.refreshFolderScan()

    expect(refreshFolder).toHaveBeenCalledWith('folder-1')
    expect(store.scanError).toBe('Folder moved or unavailable.')
    expect(store.folderConnected).toBe(false)
  })

  it('refreshFolder clears activeTrackId when current track no longer exists', async () => {
    const pickFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        folderId: 'folder-1',
        folderName: 'Practice',
        tracks: [makeDesktopTrack('a')],
      },
    }))
    const refreshFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        tracks: [makeDesktopTrack('b')],
      },
    }))
    const readTrack = vi.fn(async () => ({
      ok: true as const,
      data: { name: 'a.mp3', mimeType: 'audio/mpeg', arrayBuffer: new ArrayBuffer(0) },
    }))

    window.desktopApi = { pickFolder, refreshFolder, readTrack }

    const store = usePracticeStore()
    await store.importFolder()
    store.activeTrackId = 'a'

    await store.refreshFolderScan()

    expect(store.activeTrackId).toBeNull()
    expect(store.tracks.map((track) => track.id)).toEqual(['b'])
  })

  it('refreshFolder reports desktop api unavailable when bridge missing', async () => {
    const pickFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        folderId: 'folder-1',
        folderName: 'Practice',
        tracks: [makeDesktopTrack('a')],
      },
    }))
    const refreshFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        tracks: [makeDesktopTrack('b')],
      },
    }))
    const readTrack = vi.fn(async () => ({
      ok: true as const,
      data: { name: 'a.mp3', mimeType: 'audio/mpeg', arrayBuffer: new ArrayBuffer(0) },
    }))

    window.desktopApi = { pickFolder, refreshFolder, readTrack }

    const store = usePracticeStore()
    await store.importFolder()
    delete window.desktopApi

    await store.refreshFolderScan()

    expect(store.scanError).toBe('Desktop API unavailable. Restart app and retry.')
    expect(store.folderConnected).toBe(false)
    expect(store.isScanning).toBe(false)
  })

  it('restoreLastFolder with desktop source + empty tracks triggers refresh', async () => {
    const refreshFolder = vi.fn(async () => ({
      ok: true as const,
      data: {
        tracks: [makeDesktopTrack('song')],
      },
    }))

    mockLibrarySnapshot = {
      folderName: 'Practice',
      tracks: [],
      activeTrackId: null,
      sourceType: 'desktop-directory',
      folderId: 'folder-1',
      updatedAt: new Date(0).toISOString(),
    }

    window.desktopApi = {
      pickFolder: vi.fn(),
      refreshFolder,
      readTrack: vi.fn(),
    }

    const store = usePracticeStore()
    await store.restoreLastFolder()

    expect(refreshFolder).toHaveBeenCalledWith('folder-1')
    expect(store.folderConnected).toBe(true)
    expect(store.tracks.map((track) => track.id)).toEqual(['song'])
  })

  it('restoreLastFolder warns when desktopApi missing for desktop snapshot', async () => {
    mockLibrarySnapshot = {
      folderName: 'Practice',
      tracks: [
        {
          id: 'song.mp3:1:1',
          name: 'song.mp3',
          relativePath: 'song.mp3',
          fingerprint: 'song.mp3',
          lastModified: 1,
          size: 1,
          sourceType: 'desktop-directory',
        },
      ],
      activeTrackId: null,
      sourceType: 'desktop-directory',
      folderId: 'folder-1',
      updatedAt: new Date(0).toISOString(),
    }

    const store = usePracticeStore()
    await store.restoreLastFolder()

    expect(store.folderConnected).toBe(false)
    expect(store.scanError).toBe('Desktop API unavailable. Re-import folder.')
  })
})
