<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WaveformPane from './components/WaveformPane.vue'
import { usePracticeStore } from './stores/practice'
import { MIN_PITCH, MAX_PITCH, MIN_TEMPO, MAX_TEMPO } from './lib/math'

const store = usePracticeStore()
const theme = ref<'light' | 'dark'>('light')
const THEME_KEY = 'tuneforge-theme'

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
const activeLoopSection = computed(
  () => store.loopSections.find((section) => section.id === store.activeLoopSectionId) ?? null,
)

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
          <code>A</code>/<code>B</code> loop edges,
          <code>L</code> loop on/off,
          <code>M</code> marker,
          arrows seek/marker jump.
        </div>
      </div>
    </section>

    <section class="row g-3 mb-3">
      <div class="col-lg-6">
        <div class="card shadow-sm border-0 h-100">
          <div class="card-body">
            <h2 class="section-title">Tempo, Pitch, Volume</h2>

            <label class="form-label d-flex justify-content-between">
              <span>Tempo</span>
              <strong>{{ store.tempo.toFixed(2) }}x</strong>
            </label>
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
              <strong>{{ store.pitchSemitones.toFixed(1) }} st</strong>
            </label>
            <input
              :value="store.pitchSemitones"
              class="form-range mb-3"
              type="range"
              :min="MIN_PITCH"
              :max="MAX_PITCH"
              step="0.1"
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

            <div class="d-flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-primary"
                :disabled="controlsDisabled"
                @click="store.addLoopSection"
              >
                Add Section
              </button>
              <button
                type="button"
                class="btn btn-warning"
                :disabled="controlsDisabled || !activeLoopSection"
                @click="store.setLoopEnabled(!store.loop.enabled)"
              >
                {{ store.loop.enabled ? 'Disable Active Loop' : 'Enable Active Loop' }}
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                :disabled="controlsDisabled || !activeLoopSection"
                @click="store.clearActiveLoopSection"
              >
                Clear Active
              </button>
              <div class="ms-auto d-flex align-items-center gap-2">
                <label class="form-label mb-0">Mode</label>
                <select
                  class="form-select form-select-sm"
                  :value="store.loop.mode"
                  :disabled="controlsDisabled || !activeLoopSection"
                  @change="store.setLoopMode(($event.target as HTMLSelectElement).value as 'forever' | 'once')"
                >
                  <option value="forever">Loop Forever</option>
                  <option value="once">Loop Once</option>
                </select>
              </div>
            </div>

            <div class="table-responsive">
              <table class="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th scope="col" style="width: 44px">#</th>
                    <th scope="col" style="width: 24%">Name</th>
                    <th scope="col" style="width: 96px">Start</th>
                    <th scope="col" style="width: 96px">End</th>
                    <th scope="col" style="width: 150px">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="store.loopSections.length === 0">
                    <td colspan="5" class="text-body-secondary">
                      No loop sections yet. Add one to define loopable regions.
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

    <section class="card shadow-sm border-0 mb-3">
      <div class="card-body">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <h2 class="section-title mb-0">Markers</h2>
          <button
            type="button"
            class="btn btn-warning btn-sm"
            :disabled="controlsDisabled"
            @click="store.addMarker()"
          >
            Add Marker
          </button>
        </div>
        <ul class="list-group marker-list">
          <li
            v-for="marker in store.markers"
            :key="marker.id"
            class="list-group-item d-flex align-items-center gap-2"
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
      </div>
    </section>
  </main>
</template>
