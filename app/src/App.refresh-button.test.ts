import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'

let mockStore: ReturnType<typeof createMockStore>

vi.mock('./components/WaveformPane.vue', () => ({
  default: {
    name: 'WaveformPaneStub',
    template: '<div data-testid="waveform-pane-stub"></div>',
  },
}))

vi.mock('./stores/practice', () => ({
  usePracticeStore: () => mockStore,
}))

function createMockStore(overrides: Record<string, unknown> = {}) {
  const refreshFolderScan = vi.fn(async () => {})

  return reactive({
    tracks: [],
    activeTrackId: null,
    loadingTrackId: null,
    folderName: '',
    isScanning: false,
    scanError: '',
    folderConnected: true,
    hasDirectoryHandle: true,
    projectId: '',
    trackName: '',
    fingerprint: '',
    fileObjectUrl: '',
    tempo: 1,
    pitchSemitones: 0,
    pitchCents: 0,
    volume: 1,
    durationSec: 120,
    currentTimeSec: 0,
    isPlaying: false,
    loop: {
      enabled: false,
      startSec: 0,
      endSec: 4,
      mode: 'forever',
    },
    loopSections: [],
    activeLoopSectionId: null,
    pendingLoopStartSec: null,
    loopInteractionHint: '',
    markers: [],
    activeMarkerId: null,
    error: '',
    loadedFile: null,
    isImporting: false,
    importFolder: vi.fn(async () => {}),
    importFolderFromFiles: vi.fn(async () => {}),
    restoreLastFolder: vi.fn(async () => {}),
    selectTrack: vi.fn(async () => {}),
    refreshFolderScan,
    importFile: vi.fn(async () => {}),
    setTempo: vi.fn(),
    setPitchSemitones: vi.fn(),
    setVolume: vi.fn(),
    setLoopMode: vi.fn(),
    setLoopEnabled: vi.fn(),
    updateLoop: vi.fn(),
    setLoopStartFromPlayhead: vi.fn(),
    setLoopEndFromPlayhead: vi.fn(),
    resetLoop: vi.fn(),
    resetLoopDefinition: vi.fn(),
    addLoopSection: vi.fn(),
    selectLoopSection: vi.fn(),
    clearActiveLoopSection: vi.fn(),
    removeLoopSection: vi.fn(),
    renameLoopSection: vi.fn(),
    updateLoopSectionRange: vi.fn(),
    setLoopStartAtTime: vi.fn(),
    setLoopEndAtTime: vi.fn(),
    setLoopSectionEnabled: vi.fn(),
    setAllLoopSectionsEnabled: vi.fn(),
    clearAllLoopSections: vi.fn(),
    addMarker: vi.fn(),
    addMarkerAtTime: vi.fn(),
    upsertNamedMarkerAtTime: vi.fn(),
    removeMarker: vi.fn(),
    renameMarker: vi.fn(),
    playPause: vi.fn(async () => {}),
    seekBy: vi.fn(),
    jumpMarker: vi.fn(),
    seek: vi.fn(),
    teardown: vi.fn(),
    ...overrides,
  })
}

describe('App refresh button permission UI', () => {
  beforeEach(() => {
    mockStore = createMockStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('enables refresh only when hasDirectoryHandle=true and isScanning=false', async () => {
    render(App)
    const refreshButton = screen.getByRole('button', { name: 'Refresh' })

    expect(refreshButton.hasAttribute('disabled')).toBe(false)

    mockStore.isScanning = true
    await nextTick()
    expect(refreshButton.hasAttribute('disabled')).toBe(true)

    mockStore.isScanning = false
    mockStore.hasDirectoryHandle = false
    await nextTick()
    expect(refreshButton.hasAttribute('disabled')).toBe(true)
  })

  it('shows reconnect + permission error text after denied refresh path', async () => {
    const deniedMessage = 'Folder permission missing. Reconnect with Import Folder.'
    mockStore = createMockStore({
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
      folderConnected: true,
      scanError: '',
      refreshFolderScan: vi.fn(async () => {
        mockStore.scanError = deniedMessage
        mockStore.folderConnected = false
      }),
    })

    render(App)
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(mockStore.refreshFolderScan).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText(deniedMessage)).toBeTruthy()
    expect(screen.getByText('Reconnect folder to load tracks.')).toBeTruthy()
  })

  it('does not call refresh when refresh button is disabled', async () => {
    mockStore = createMockStore({ hasDirectoryHandle: false })

    render(App)
    const refreshButton = screen.getByRole('button', { name: 'Refresh' })

    expect(refreshButton.hasAttribute('disabled')).toBe(true)
    refreshButton.click()
    expect(mockStore.refreshFolderScan).toHaveBeenCalledTimes(0)
  })
})
