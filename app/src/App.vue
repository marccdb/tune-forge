<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WaveformPane from './components/WaveformPane.vue'
import { usePracticeStore } from './stores/practice'
import { MIN_PITCH, MAX_PITCH, MIN_TEMPO, MAX_TEMPO } from './lib/math'

const store = usePracticeStore()
const theme = ref<'light' | 'dark'>('light')
const THEME_KEY = 'tuneforge-theme'

const fallbackFolderInput = ref<HTMLInputElement | null>(null)

const formattedTime = computed(() => {
  const format = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')
    return `${mins}:${secs}`
  }

  return `${format(store.currentTimeSec)} / ${format(store.durationSec)}`
})

const hasLoadedTrack = computed(() => Boolean(store.loadedFile))
const controlsDisabled = computed(() => store.isImporting || !hasLoadedTrack.value)
const hasDesktopApi = computed(() => typeof window !== 'undefined' && Boolean(window.desktopApi))
const activeLoopSection = computed(
  () => store.loopSections.find((section) => section.id === store.activeLoopSectionId) ?? null,
)
const allLoopSectionsEnabled = computed(
  () => store.loopSections.length > 0 && store.loopSections.every((section) => section.enabled),
)
const canRefreshFolder = computed(() => store.hasDirectoryHandle && !store.isScanning)
const hasPendingLoopStart = computed(() => store.pendingLoopStartSec !== null)
const canResetLoopDefinition = computed(() => hasPendingLoopStart.value || Boolean(activeLoopSection.value))

const seekPercent = computed({
  get() {
    if (!store.durationSec) return 0
    return (store.currentTimeSec / store.durationSec) * 100
  },
  set(value: number) {
    if (!store.durationSec) return
    store.seek((value / 100) * store.durationSec)
  },
})

const tempoPercent = computed(() => store.tempo * 100)
const tempoDeltaBpm = computed(() => Math.round((store.tempo - 1) * 100))
const pitchHalfToneLabel = computed(() => {
  const semitones = Math.round(store.pitchSemitones)
  if (semitones === 0) return '0 half tones'
  const direction = semitones > 0 ? 'sharp' : 'flat'
  const amount = Math.abs(semitones)
  return `${amount} half tone${amount === 1 ? '' : 's'} ${direction}`
})

function nudgeTempoByBpm(deltaBpm: number) {
  const nextTempo = store.tempo + deltaBpm / 100
  store.setTempo(nextTempo)
}

async function onFileChanged(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    await store.importFile(file)
  } finally {
    target.value = ''
  }
}

async function onImportFolderClick() {
  if (hasDesktopApi.value) {
    await store.importFolder()
    return
  }
  fallbackFolderInput.value?.click()
}

async function onFallbackFolderChanged(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  try {
    await store.importFolderFromFiles(files)
  } finally {
    target.value = ''
  }
}

async function onRefreshFolderClick() {
  if (!canRefreshFolder.value) return
  await store.refreshFolderScan()
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

function applyTheme(value: 'light' | 'dark') {
  document.documentElement.setAttribute('data-bs-theme', value)
}

function onLoopSectionStartInput(sectionId: string, value: string) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return
  const section = store.loopSections.find((entry) => entry.id === sectionId)
  if (!section) return
  store.updateLoopSectionRange(sectionId, parsed, section.endSec)
}

function onLoopSectionEndInput(sectionId: string, value: string) {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return
  const section = store.loopSections.find((entry) => entry.id === sectionId)
  if (!section) return
  store.updateLoopSectionRange(sectionId, section.startSec, parsed)
}

function registerShortcuts(event: KeyboardEvent) {
  if (controlsDisabled.value) return
  if ((event.target as HTMLElement)?.closest('input, textarea, select')) return

  if (event.code === 'Space') {
    event.preventDefault()
    void store.playPause()
  } else if (event.key.toLowerCase() === 'a') {
    store.setLoopStartFromPlayhead()
  } else if (event.key.toLowerCase() === 'b') {
    store.setLoopEndFromPlayhead()
  } else if (event.key.toLowerCase() === 'l') {
    store.setLoopEnabled(!store.loop.enabled)
  } else if (event.key === 'ArrowLeft') {
    store.seekBy(-2)
  } else if (event.key === 'ArrowRight') {
    store.seekBy(2)
  } else if (event.key === 'ArrowUp') {
    store.jumpMarker(1)
  } else if (event.key === 'ArrowDown') {
    store.jumpMarker(-1)
  } else if (event.key.toLowerCase() === 'm') {
    store.addMarker()
  } else if (event.key === 'Escape') {
    store.resetLoopDefinition()
  }
}

onMounted(() => {
  const storedTheme = localStorage.getItem(THEME_KEY)
  if (storedTheme === 'light' || storedTheme === 'dark') {
    theme.value = storedTheme
  } else {
    theme.value = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  applyTheme(theme.value)
  window.addEventListener('keydown', registerShortcuts)
  void store.restoreLastFolder()
})

watch(theme, (value) => {
  applyTheme(value)
  localStorage.setItem(THEME_KEY, value)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', registerShortcuts)
  store.teardown()
})
</script>

<template>
  <main class="container-fluid app-shell py-3 py-lg-4">
    <div class="workspace-grid">
      <aside class="card shadow-sm border-0 library-sidebar">
        <div class="card-body p-0 d-flex flex-column h-100">
          <header class="px-3 py-3 border-bottom d-flex justify-content-between align-items-center gap-2">
            <div>
              <h2 class="section-title mb-1">Library</h2>
              <small class="text-body-secondary" :title="store.folderName || 'No folder connected'">
                {{ store.folderName || 'No folder connected' }}
              </small>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              :disabled="!canRefreshFolder"
              @click="onRefreshFolderClick"
            >
              Refresh
            </button>
          </header>

          <div class="library-track-list flex-grow-1">
            <div class="p-3 text-body-secondary small" v-if="store.isScanning">Scanning folder...</div>
            <div class="p-3 text-body-secondary small" v-else-if="store.tracks.length === 0">No songs found.</div>
            <div class="p-3 text-danger small" v-if="store.scanError">{{ store.scanError }}</div>

            <button
              v-for="track in store.tracks"
              :key="track.id"
              type="button"
              class="library-track-item"
              :class="{
                active: track.id === store.activeTrackId,
                loading: track.id === store.loadingTrackId,
              }"
              :title="track.relativePath"
              :disabled="store.isScanning"
              @click="store.selectTrack(track.id)"
            >
              <span class="track-name">{{ track.name }}</span>
              <span class="track-meta">{{ track.relativePath }}</span>
              <span class="track-loading" v-if="track.id === store.loadingTrackId">Loading...</span>
            </button>
          </div>

          <div class="sidebar-footer p-3 border-top">
            <button type="button" class="btn btn-primary w-100" :disabled="store.isScanning" @click="onImportFolderClick">
              Import Folder
            </button>
            <small class="text-body-secondary d-block mt-2" v-if="!store.folderConnected && store.tracks.length > 0">
              Reconnect folder to load tracks.
            </small>
          </div>
        </div>
      </aside>

      <section class="workspace-main">
        <section class="card shadow-sm border-0 mb-3">
          <div class="card-body d-flex flex-column gap-3">
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <h1 class="display-6 fw-bold mb-1">TuneForge</h1>
                <p class="text-body-secondary mb-0">
                  Practice studio: tempo, pitch, A/B loops, markers, per-song local save.
                </p>
              </div>
              <button type="button" class="btn btn-secondary" @click="toggleTheme">
                {{ theme === 'dark' ? 'Light Mode' : 'Dark Mode' }}
              </button>
            </div>

            <div class="d-flex flex-wrap align-items-center gap-2">
              <label class="btn btn-primary">
                Import Audio
                <input class="d-none" type="file" accept="audio/*,video/*" @change="onFileChanged" />
              </label>
              <span class="badge text-bg-secondary" v-if="store.trackName">{{ store.trackName }}</span>
              <span class="badge text-bg-info" v-if="store.isImporting">Loading waveform...</span>
              <span class="badge text-bg-warning" v-if="!hasDesktopApi">Folder picker fallback mode</span>
            </div>

            <div class="alert alert-danger py-2 px-3 mb-0" v-if="store.error">{{ store.error }}</div>
          </div>
        </section>

        <section class="card shadow-sm border-0 mb-3">
          <div class="card-body">
            <WaveformPane />
          </div>
        </section>

        <section class="card shadow-sm border-0 mb-3">
          <div class="card-body d-flex flex-column gap-3">
            <div class="d-flex justify-content-between align-items-center">
              <button
                type="button"
                class="btn btn-success"
                :disabled="controlsDisabled"
                @click="store.playPause"
              >
                {{ store.isPlaying ? 'Pause' : 'Play' }}
              </button>
              <strong class="fs-5">{{ formattedTime }}</strong>
            </div>

            <input
              v-model.number="seekPercent"
              class="form-range"
              type="range"
              min="0"
              max="100"
              step="0.1"
              :disabled="controlsDisabled"
            />

            <div class="small text-body-secondary">
              <strong>Shortcuts:</strong>
              <code>Space</code> play/pause,
              <code>A</code> set loop start,
              <code>B</code> set loop end,
              <code>Esc</code> reset A/B,
              <code>L</code> loop on/off,
              <code>M</code> marker,
              arrows seek and marker jump.
            </div>
          </div>
        </section>

        <section class="row g-3 mb-3">
          <div class="col-lg-6">
            <div class="card shadow-sm border-0 h-100">
              <div class="card-body">
                <label class="form-label d-flex justify-content-between">
                  <span>Tempo</span>
                  <strong>
                    {{ tempoPercent.toFixed(0) }}%
                    ({{ tempoDeltaBpm >= 0 ? '+' : '' }}{{ tempoDeltaBpm }} BPM)
                  </strong>
                </label>
                <div class="d-flex gap-2 mb-2">
                  <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="controlsDisabled" @click="nudgeTempoByBpm(-1)">
                    -1 BPM
                  </button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="controlsDisabled" @click="nudgeTempoByBpm(1)">
                    +1 BPM
                  </button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="controlsDisabled" @click="store.setTempo(1)">
                    Reset 100%
                  </button>
                </div>
                <input
                  :value="store.tempo"
                  class="form-range mb-3"
                  type="range"
                  :min="MIN_TEMPO"
                  :max="MAX_TEMPO"
                  step="0.01"
                  :disabled="controlsDisabled"
                  @input="store.setTempo(Number(($event.target as HTMLInputElement).value))"
                />

                <label class="form-label d-flex justify-content-between">
                  <span>Pitch</span>
                  <strong>{{ pitchHalfToneLabel }}</strong>
                </label>
                <input
                  :value="store.pitchSemitones"
                  class="form-range mb-3"
                  type="range"
                  :min="MIN_PITCH"
                  :max="MAX_PITCH"
                  step="1"
                  :disabled="controlsDisabled"
                  @input="store.setPitchSemitones(Number(($event.target as HTMLInputElement).value))"
                />

                <label class="form-label d-flex justify-content-between">
                  <span>Volume</span>
                  <strong>{{ store.volume.toFixed(2) }}</strong>
                </label>
                <input
                  :value="store.volume"
                  class="form-range mb-0"
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  :disabled="controlsDisabled"
                  @input="store.setVolume(Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </div>
          </div>

          <div class="col-lg-6">
            <div class="card shadow-sm border-0 h-100">
              <div class="card-body d-flex flex-column gap-3">
                <h2 class="section-title">Loop Controls</h2>

                <div class="loop-controls-toolbar d-flex flex-wrap align-items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-primary"
                    :disabled="controlsDisabled"
                    @click="store.addLoopSection"
                  >
                    {{ hasPendingLoopStart ? 'Reset A (Set Start)' : 'Set A (Start Section)' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline-primary"
                    :disabled="controlsDisabled || !hasPendingLoopStart"
                    @click="store.setLoopEndFromPlayhead"
                  >
                    Set B (Finalize)
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline-secondary"
                    :disabled="controlsDisabled || !canResetLoopDefinition"
                    @click="store.resetLoopDefinition"
                  >
                    Reset A/B
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    :disabled="controlsDisabled || store.loopSections.length === 0"
                    @click="store.setAllLoopSectionsEnabled(!allLoopSectionsEnabled)"
                  >
                    {{ allLoopSectionsEnabled ? 'Clear All' : 'Enable All' }}
                  </button>
                  <div class="loop-mode-group d-flex align-items-center gap-2 ms-auto">
                    <label class="form-label mb-0">Mode</label>
                    <select
                      class="loop-mode-select form-select form-select-sm"
                      :value="store.loop.mode"
                      :disabled="controlsDisabled || !activeLoopSection"
                      @change="store.setLoopMode(($event.target as HTMLSelectElement).value as 'forever' | 'once')"
                    >
                      <option value="forever">Loop Forever</option>
                      <option value="once">Loop Once</option>
                    </select>
                  </div>
                </div>
                <p class="mb-0 small text-body-secondary">
                  <span v-if="hasPendingLoopStart">
                    Pending start A at {{ (store.pendingLoopStartSec ?? 0).toFixed(2) }}s. Set B to finalize this section.
                  </span>
                  <span v-else>Set A, then set B. No section is created until B is set.</span>
                </p>
                <p
                  v-if="store.loopInteractionHint"
                  class="mb-0 small"
                  :class="store.loopInteractionHint.startsWith('Set A first') ? 'text-warning-emphasis' : 'text-info-emphasis'"
                  aria-live="polite"
                >
                  {{ store.loopInteractionHint }}
                </p>

                <div class="table-responsive">
                  <table class="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th scope="col" style="width: 44px">#</th>
                        <th scope="col" style="width: 56px">Loop</th>
                        <th scope="col" style="width: 18%">Name</th>
                        <th scope="col" style="width: 116px">Start</th>
                        <th scope="col" style="width: 116px">End</th>
                        <th scope="col" style="width: 138px">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="store.loopSections.length === 0">
                        <td colspan="6" class="text-body-secondary">
                          No loop sections yet. Set A then B to define a loop region.
                        </td>
                      </tr>
                      <tr
                        v-for="(section, index) in store.loopSections"
                        :key="section.id"
                        :class="{ 'table-active': section.id === store.activeLoopSectionId }"
                      >
                        <td>{{ index + 1 }}</td>
                        <td>
                          <input
                            class="form-check-input"
                            type="checkbox"
                            :checked="section.enabled"
                            :disabled="controlsDisabled"
                            @change="store.setLoopSectionEnabled(section.id, ($event.target as HTMLInputElement).checked)"
                          />
                        </td>
                        <td>
                          <input
                            :value="section.name"
                            class="form-control form-control-sm"
                            type="text"
                            :disabled="controlsDisabled"
                            @change="store.renameLoopSection(section.id, ($event.target as HTMLInputElement).value)"
                          />
                        </td>
                        <td>
                          <input
                            :value="section.startSec.toFixed(2)"
                            class="form-control form-control-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            :disabled="controlsDisabled"
                            @change="onLoopSectionStartInput(section.id, ($event.target as HTMLInputElement).value)"
                          />
                        </td>
                        <td>
                          <input
                            :value="section.endSec.toFixed(2)"
                            class="form-control form-control-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            :disabled="controlsDisabled"
                            @change="onLoopSectionEndInput(section.id, ($event.target as HTMLInputElement).value)"
                          />
                        </td>
                        <td class="d-flex gap-1">
                          <button
                            type="button"
                            class="btn btn-sm btn-light"
                            :disabled="controlsDisabled"
                            @click="store.selectLoopSection(section.id)"
                          >
                            Jump
                          </button>
                          <button
                            type="button"
                            class="btn btn-sm btn-danger"
                            :disabled="controlsDisabled"
                            @click="store.removeLoopSection(section.id)"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="small text-body-secondary">
                  <span v-if="activeLoopSection">
                    Active: <strong>{{ activeLoopSection.name }}</strong>
                    ({{ activeLoopSection.startSec.toFixed(2) }}s - {{ activeLoopSection.endSec.toFixed(2) }}s)
                  </span>
                  <span v-else>No active section selected.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

      </section>

      <aside class="card shadow-sm border-0 markers-sidebar">
        <div class="card-body p-0 d-flex flex-column h-100">
          <header class="px-3 py-3 border-bottom">
            <h2 class="section-title mb-0">Markers</h2>
          </header>
          <div class="markers-list-wrap flex-grow-1">
            <ul class="list-group marker-list">
              <li
                v-for="marker in store.markers"
                :key="marker.id"
                class="list-group-item marker-list-item"
                :class="{ active: marker.id === store.activeMarkerId }"
              >
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="controlsDisabled"
                  @click="store.jumpToMarker(marker.id)"
                >
                  {{ marker.timeSec.toFixed(2) }}s
                </button>
                <input
                  :value="marker.label"
                  class="form-control form-control-sm"
                  type="text"
                  :disabled="controlsDisabled"
                  @change="store.renameMarker(marker.id, ($event.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="btn btn-sm btn-danger"
                  :disabled="controlsDisabled"
                  @click="store.removeMarker(marker.id)"
                >
                  Delete
                </button>
              </li>
            </ul>
            <div class="p-3 text-body-secondary small" v-if="store.markers.length === 0">
              No markers yet. Add markers from the waveform.
            </div>
          </div>
        </div>
      </aside>
    </div>

    <input
      ref="fallbackFolderInput"
      class="d-none"
      type="file"
      accept="audio/*,video/*"
      webkitdirectory
      directory
      multiple
      @change="onFallbackFolderChanged"
    />
  </main>
</template>
