<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import type { Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { usePracticeStore } from '../stores/practice'

const store = usePracticeStore()

const host = ref<HTMLElement | null>(null)
const zoomPxPerSec = ref(0)
const MIN_ZOOM_PX_PER_SEC = 0
const MAX_ZOOM_PX_PER_SEC = 240
const ZOOM_STEP = 12

let waveSurfer: WaveSurfer | null = null
let regionsPlugin: ReturnType<typeof RegionsPlugin.create> | null = null
const loopRegions = new Map<string, Region>()
const markerRegions = new Map<string, Region>()
let updatingLoopSectionFromRegion = false

const hasAudio = computed(() => Boolean(store.fileObjectUrl))
const canZoomOut = computed(() => zoomPxPerSec.value > MIN_ZOOM_PX_PER_SEC)
const canZoomIn = computed(() => zoomPxPerSec.value < MAX_ZOOM_PX_PER_SEC)

function getWaveColors() {
  const theme = document.documentElement.getAttribute('data-bs-theme')
  if (theme === 'dark') {
    return {
      waveColor: '#5f89ff',
      progressColor: '#b3c7ff',
      cursorColor: '#f8f9fa',
    }
  }

  return {
    waveColor: '#7ea3ff',
    progressColor: '#1a2b59',
    cursorColor: '#0f112f',
  }
}

function applyWaveTheme() {
  if (!waveSurfer) return
  const colors = getWaveColors()
  waveSurfer.setOptions({
    waveColor: colors.waveColor,
    progressColor: colors.progressColor,
    cursorColor: colors.cursorColor,
  })
}

function applyZoom(pxPerSec: number) {
  if (!waveSurfer) return
  const clamped = Math.max(MIN_ZOOM_PX_PER_SEC, Math.min(MAX_ZOOM_PX_PER_SEC, pxPerSec))
  zoomPxPerSec.value = clamped

  if (typeof waveSurfer.zoom === 'function') {
    waveSurfer.zoom(clamped)
    return
  }

  waveSurfer.setOptions({ minPxPerSec: clamped })
}

function zoomIn() {
  applyZoom(zoomPxPerSec.value + ZOOM_STEP)
}

function zoomOut() {
  applyZoom(zoomPxPerSec.value - ZOOM_STEP)
}

function resetZoom() {
  applyZoom(MIN_ZOOM_PX_PER_SEC)
}

function refreshMarkers() {
  if (!regionsPlugin) return
  for (const region of markerRegions.values()) {
    region.remove()
  }
  markerRegions.clear()

  for (const marker of store.markers) {
    const markerRegion = regionsPlugin.addRegion({
      id: marker.id,
      start: marker.timeSec,
      end: Math.min(marker.timeSec + 0.02, store.durationSec || marker.timeSec + 0.02),
      drag: false,
      resize: false,
      color: 'rgba(250, 154, 12, 0.9)',
      content: marker.label,
    })
    markerRegion.on('click', (event) => {
      event.preventDefault()
      store.jumpToMarker(marker.id)
    })
    markerRegions.set(marker.id, markerRegion)
  }
}

function refreshLoopSections() {
  if (!regionsPlugin || !store.durationSec) return
  const plugin = regionsPlugin
  for (const region of loopRegions.values()) {
    region.remove()
  }
  loopRegions.clear()

  store.loopSections.forEach((section, index) => {
    const isActive = section.id === store.activeLoopSectionId
    const region = plugin.addRegion({
      id: section.id,
      start: section.startSec,
      end: section.endSec,
      drag: true,
      resize: true,
      color: section.enabled
        ? isActive
          ? 'rgba(11, 173, 107, 0.34)'
          : 'rgba(11, 173, 107, 0.18)'
        : isActive
          ? 'rgba(108, 117, 125, 0.34)'
          : 'rgba(108, 117, 125, 0.16)',
      minLength: 0.05,
      content: `${index + 1}. ${section.name}${section.enabled ? '' : ' (off)'}`,
    })

    region.on('click', (event) => {
      event.preventDefault()
      store.selectLoopSection(section.id)
    })

    region.on('update-end', () => {
      updatingLoopSectionFromRegion = true
      store.updateLoopSectionRange(section.id, region.start, region.end)
      updatingLoopSectionFromRegion = false
    })

    loopRegions.set(section.id, region)
  })
}

async function loadWaveform(url: string) {
  if (!waveSurfer) return
  await waveSurfer.load(url)
  applyZoom(zoomPxPerSec.value)
}

onMounted(() => {
  if (!host.value) return

  regionsPlugin = RegionsPlugin.create()
  const colors = getWaveColors()
  waveSurfer = WaveSurfer.create({
    container: host.value,
    waveColor: colors.waveColor,
    progressColor: colors.progressColor,
    height: 180,
    cursorColor: colors.cursorColor,
    cursorWidth: 2,
    minPxPerSec: 0,
    normalize: true,
    plugins: [regionsPlugin],
  })

  waveSurfer.on('click', (relativeX) => {
    if (!store.durationSec) return
    store.seek(relativeX * store.durationSec)
  })

  watch(
    () => store.fileObjectUrl,
    (url) => {
      if (!url) return
      void loadWaveform(url).then(() => {
        refreshLoopSections()
        refreshMarkers()
      })
    },
    { immediate: true },
  )

  watch(
    () => [store.loopSections, store.activeLoopSectionId],
    () => {
      if (updatingLoopSectionFromRegion) return
      refreshLoopSections()
    },
    { deep: true },
  )

  watch(
    () => store.markers,
    () => refreshMarkers(),
    { deep: true },
  )

  watch(
    () => store.currentTimeSec,
    (timeSec) => {
      if (!waveSurfer || !store.durationSec) return
      waveSurfer.setTime(timeSec)
    },
  )

  const observer = new MutationObserver(() => applyWaveTheme())
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] })

  onBeforeUnmount(() => {
    observer.disconnect()
  })
})

onBeforeUnmount(() => {
  for (const region of loopRegions.values()) {
    region.remove()
  }
  loopRegions.clear()
  for (const region of markerRegions.values()) {
    region.remove()
  }
  markerRegions.clear()
  waveSurfer?.destroy()
})
</script>

<template>
  <section class="waveform-shell">
    <header class="wave-head">
      <h2>Waveform</h2>
      <div class="wave-controls">
        <span v-if="hasAudio">Click waveform to seek. Add/select sections to loop. Drag section to edit.</span>
        <span v-else>Import audio file to start.</span>
        <div class="zoom-controls">
          <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="!hasAudio || !canZoomOut" @click="zoomOut">
            -
          </button>
          <input
            :value="zoomPxPerSec"
            class="form-range zoom-slider"
            type="range"
            :min="MIN_ZOOM_PX_PER_SEC"
            :max="MAX_ZOOM_PX_PER_SEC"
            :step="ZOOM_STEP"
            :disabled="!hasAudio"
            @input="applyZoom(Number(($event.target as HTMLInputElement).value))"
          />
          <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="!hasAudio || !canZoomIn" @click="zoomIn">
            +
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="!hasAudio || !canZoomOut" @click="resetZoom">
            1:1
          </button>
        </div>
      </div>
    </header>
    <div class="wave-scroll" :class="{ 'is-empty': !hasAudio }">
      <div ref="host" class="waveform-host" />
    </div>
  </section>
</template>

<style scoped>
.waveform-shell {
  border: 1px solid var(--bs-border-color);
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: var(--bs-secondary-bg);
}

.wave-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.wave-head h2 {
  margin: 0;
  font-size: 0.9rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bs-secondary-color);
}

.wave-head span {
  font-size: 0.82rem;
  color: var(--bs-secondary-color);
}

.wave-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--bs-border-color);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--bs-body-bg) 84%, transparent);
}

.zoom-slider {
  width: 220px;
  height: 1.25rem;
  margin: 0;
  accent-color: var(--bs-primary);
}

.wave-scroll {
  position: relative;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}

.wave-scroll.is-empty::before {
  content: '';
  position: absolute;
  inset: 0.5rem 0;
  pointer-events: none;
  opacity: 0.35;
  background:
    linear-gradient(
      180deg,
      transparent 47%,
      color-mix(in srgb, var(--bs-secondary-color) 45%, transparent) 47%,
      color-mix(in srgb, var(--bs-secondary-color) 45%, transparent) 53%,
      transparent 53%
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 10px,
      color-mix(in srgb, var(--bs-secondary-color) 35%, transparent) 10px 12px,
      transparent 12px 20px
    );
}

.waveform-host {
  min-height: 180px;
  min-width: 100%;
}
</style>
