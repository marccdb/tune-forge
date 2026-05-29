<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import WaveformPane from './components/WaveformPane.vue'
import { usePracticeStore } from './stores/practice'
import { MIN_PITCH, MAX_PITCH, MIN_TEMPO, MAX_TEMPO } from './lib/math'

const store = usePracticeStore()

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
  window.addEventListener('keydown', registerShortcuts)
  void store.restoreLastFolder()
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
          <header class="px-3 py-3 border-bottom">
            <div class="d-flex gap-2 mb-3">
              <button type="button" class="btn btn-primary flex-fill" :disabled="store.isScanning" @click="onImportFolderClick">
                Import Folder
              </button>
              <label class="btn btn-primary flex-fill d-flex align-items-center justify-content-center mb-0">
                Import Audio
                <input class="d-none" type="file" accept="audio/*,video/*" @change="onFileChanged" />
              </label>
            </div>

            <div class="d-flex justify-content-between align-items-center gap-2">
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
            </div>
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

          <div class="sidebar-footer p-3 border-top" v-if="!store.folderConnected && store.tracks.length > 0">
            <small class="text-body-secondary d-block">
              Reconnect folder to load tracks.
            </small>
          </div>
        </div>
      </aside>

      <section class="workspace-main">
        <section class="card shadow-sm border-0 mb-3">
          <div class="card-body d-flex flex-column gap-3">
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div class="brand-heading">
                <div class="brand-mark" aria-hidden="true">
                  <svg
                    class="brand-mark-svg"
                    width="1024"
                    height="1024"
                    viewBox="0 0 1024 1024"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect width="1024" height="1024" fill="#4A4A4A" />

                    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M365 320 Q512 210 659 320" stroke="#6D8196" stroke-width="14" />
                      <path d="M365 590 Q512 700 659 590" stroke="#6D8196" stroke-width="14" />

                      <path d="M345 570 V365 L512 500 L679 365 V570" stroke="#FFFFE3" stroke-width="38" />

                      <path d="M392 438 V552" stroke="#6D8196" stroke-width="10" />
                      <circle cx="392" cy="488" r="18" fill="#FFFFE3" />

                      <path d="M632 438 V552" stroke="#6D8196" stroke-width="10" />
                      <circle cx="632" cy="488" r="18" fill="#FFFFE3" />

                      <polygon points="490,525 490,580 540,552" fill="#FFFFE3" />
                    </g>

                    <g fill="#CBCBCB">
                      <rect x="180" y="490" width="18" height="36" rx="9" />
                      <rect x="220" y="460" width="18" height="80" rx="9" />
                      <rect x="260" y="430" width="18" height="140" rx="9" />
                      <rect x="300" y="395" width="18" height="210" rx="9" />

                      <rect x="706" y="395" width="18" height="210" rx="9" />
                      <rect x="746" y="430" width="18" height="140" rx="9" />
                      <rect x="786" y="460" width="18" height="80" rx="9" />
                      <rect x="826" y="490" width="18" height="36" rx="9" />
                    </g>

                    <text
                      x="512"
                      y="760"
                      text-anchor="middle"
                      font-family="Montserrat, Poppins, Arial, sans-serif"
                      font-size="118"
                      font-weight="300"
                      letter-spacing="-4"
                    >
                      <tspan fill="#FFFFE3">Mod</tspan><tspan fill="#6D8196">audio</tspan>
                    </text>

                    <circle cx="825" cy="730" r="28" fill="#6D8196" />
                    <polygon points="816,714 816,746 842,730" fill="#FFFFE3" />
                  </svg>
                </div>
                <div class="brand-copy">
                  <h1 class="display-6 fw-bold mb-1 brand-title">
                    <span class="brand-title-main">Mod</span><span class="brand-title-accent">Audio</span>
                  </h1>
                  <p class="text-body-secondary mb-0">
                    Practice studio: tempo, pitch, A/B loops, markers, per-song local save.
                  </p>
                </div>
              </div>
            </div>

            <div class="d-flex flex-wrap align-items-center gap-2" v-if="store.trackName || store.isImporting">
              <span class="badge text-bg-secondary" v-if="store.trackName">{{ store.trackName }}</span>
              <span class="badge text-bg-info" v-if="store.isImporting">Loading waveform...</span>
            </div>

            <div class="alert alert-danger py-2 px-3 mb-0" v-if="store.error">{{ store.error }}</div>
          </div>
        </section>

        <section class="card shadow-sm border-0 mb-3">
          <div class="card-body player-panel-body d-flex flex-column gap-2">
            <WaveformPane />

            <input
              v-model.number="seekPercent"
              class="form-range song-seek-slider mb-0"
              type="range"
              min="0"
              max="100"
              step="0.1"
              :disabled="controlsDisabled"
            />

            <div class="player-bottom-row">
              <div class="player-loop-cluster">
                <h2 class="section-title mb-1">Loop Controls</h2>
                <div class="player-loop-actions" role="group" aria-label="Loop controls">
                  <button
                    type="button"
                    class="btn btn-sm loop-action-btn"
                    :class="hasPendingLoopStart ? 'btn-primary' : 'btn-outline-primary'"
                    :disabled="controlsDisabled"
                    :title="hasPendingLoopStart ? 'Reset A and set loop start (A) from playhead' : 'Set loop start (A) from playhead'"
                    :aria-label="hasPendingLoopStart ? 'Reset A and set loop start (A) from playhead' : 'Set loop start (A) from playhead'"
                    @click="store.addLoopSection"
                  >
                    <i class="bi" :class="hasPendingLoopStart ? 'bi-skip-start-circle-fill' : 'bi-skip-start-circle'" aria-hidden="true"></i>
                    <span>{{ hasPendingLoopStart ? 'Reset A' : 'Set A' }}</span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary loop-action-btn"
                    :disabled="controlsDisabled || !hasPendingLoopStart"
                    title="Set loop end (B) and finalize section from playhead"
                    aria-label="Set loop end (B) and finalize section from playhead"
                    @click="store.setLoopEndFromPlayhead"
                  >
                    <i class="bi bi-skip-end-circle" aria-hidden="true"></i>
                    <span>Set B</span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary loop-action-btn"
                    :disabled="controlsDisabled || !canResetLoopDefinition"
                    title="Reset A and B loop points"
                    aria-label="Reset A and B loop points"
                    @click="store.resetLoopDefinition"
                  >
                    <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                    <span>Reset</span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary loop-action-btn"
                    :disabled="controlsDisabled || store.loopSections.length === 0"
                    :title="allLoopSectionsEnabled ? 'Disable all loop sections' : 'Enable all loop sections'"
                    :aria-label="allLoopSectionsEnabled ? 'Disable all loop sections' : 'Enable all loop sections'"
                    @click="store.setAllLoopSectionsEnabled(!allLoopSectionsEnabled)"
                  >
                    <i class="bi" :class="allLoopSectionsEnabled ? 'bi-toggle-on' : 'bi-toggle-off'" aria-hidden="true"></i>
                    <span>{{ allLoopSectionsEnabled ? 'Disable All' : 'Enable All' }}</span>
                  </button>
                </div>
              </div>
              <div class="playback-toggle-wrap">
                <button
                  type="button"
                  class="playback-toggle-btn"
                  :disabled="controlsDisabled"
                  @click="store.playPause"
                  :aria-label="store.isPlaying ? 'Pause' : 'Play'"
                >
                  <i class="bi" :class="store.isPlaying ? 'bi-pause-circle-fill' : 'bi-play-circle-fill'" aria-hidden="true"></i>
                </button>
              </div>
              <strong class="fs-5 player-time">{{ formattedTime }}</strong>
            </div>

            <div class="small text-body-secondary player-shortcuts">
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
              <div class="card-body d-flex flex-column gap-3">
                <div class="d-flex justify-content-between align-items-center gap-2">
                  <h2 class="section-title mb-0">Loops</h2>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger"
                    :disabled="controlsDisabled || store.loopSections.length === 0"
                    @click="store.clearAllLoopSections"
                  >
                    Clear All
                  </button>
                </div>
                <p v-if="hasPendingLoopStart" class="mb-0 small text-body-secondary">
                  Pending start A at {{ (store.pendingLoopStartSec ?? 0).toFixed(2) }}s. Set B to finalize this section.
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
