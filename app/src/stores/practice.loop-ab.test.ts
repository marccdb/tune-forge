import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePracticeStore } from './practice'

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
      return undefined
    }
    async saveSnapshot() {}
    async clearSnapshot() {}
  }

  return { IndexedDbFolderLibraryRepository: MockFolderLibraryRepository }
})

describe('practice store A/B loop interaction', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('A sets pending start only', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopStartAtTime(12)

    expect(store.pendingLoopStartSec).toBe(12)
    expect(store.loopSections).toHaveLength(0)
    expect(store.markers).toHaveLength(0)
  })

  it('B before A does not create section and shows hint', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopEndAtTime(18)

    expect(store.pendingLoopStartSec).toBeNull()
    expect(store.loopSections).toHaveLength(0)
    expect(store.loopInteractionHint).toContain('Set A first')
    expect(store.markers).toHaveLength(0)
  })

  it('B before pending A time normalizes by swapping boundaries', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopStartAtTime(30)
    store.setLoopEndAtTime(10)

    expect(store.pendingLoopStartSec).toBeNull()
    expect(store.loopSections).toHaveLength(1)
    expect(store.loopSections[0].startSec).toBe(10)
    expect(store.loopSections[0].endSec).toBe(30)
    expect(store.loopInteractionHint).toContain('swapped')
  })

  it('A while pending resets pending start without creating marker', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopStartAtTime(10)
    store.setLoopStartAtTime(16)

    expect(store.pendingLoopStartSec).toBe(16)
    expect(store.markers).toHaveLength(0)
  })

  it('A/B updates active section without creating extra section', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopStartAtTime(5)
    store.setLoopEndAtTime(9)
    const activeId = store.activeLoopSectionId

    store.setLoopStartAtTime(20)
    store.setLoopEndAtTime(24)

    expect(store.loopSections).toHaveLength(1)
    expect(store.activeLoopSectionId).toBe(activeId)
    expect(store.loopSections[0].startSec).toBe(20)
    expect(store.loopSections[0].endSec).toBe(24)
  })

  it('Add Section follows two-step and creates a new section on B', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopStartAtTime(5)
    store.setLoopEndAtTime(8)
    const firstSection = store.loopSections[0]

    store.currentTimeSec = 40
    store.addLoopSection()

    expect(store.pendingLoopStartSec).toBe(40)
    expect(store.loopSections).toHaveLength(1)

    store.setLoopEndAtTime(44)

    expect(store.loopSections).toHaveLength(2)
    expect(store.loopSections.some((section) => section.startSec === 40 && section.endSec === 44)).toBe(true)
    expect(store.loopSections.some((section) => section.id === firstSection.id && section.startSec === 5 && section.endSec === 8)).toBe(true)
  })

  it('removing a loop section preserves explicit markers', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopStartAtTime(12)
    store.setLoopEndAtTime(20)
    store.addMarkerAtTime(30, 'Verse')
    const sectionId = store.loopSections[0].id

    store.removeLoopSection(sectionId)

    expect(store.markers.some((marker) => marker.label === 'Verse')).toBe(true)
  })

  it('clear all removes loop sections and keeps markers', () => {
    const store = usePracticeStore()
    store.durationSec = 120

    store.setLoopStartAtTime(12)
    store.setLoopEndAtTime(20)
    store.currentTimeSec = 30
    store.addLoopSection()
    store.setLoopEndAtTime(40)
    store.addMarkerAtTime(50, 'Chorus')

    expect(store.loopSections).toHaveLength(2)
    expect(store.activeLoopSectionId).not.toBeNull()

    store.clearAllLoopSections()

    expect(store.loopSections).toHaveLength(0)
    expect(store.activeLoopSectionId).toBeNull()
    expect(store.pendingLoopStartSec).toBeNull()
    expect(store.loop.enabled).toBe(false)
    expect(store.markers.some((marker) => marker.label === 'Chorus')).toBe(true)
  })
})
