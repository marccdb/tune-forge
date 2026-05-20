<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import type { Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { usePracticeStore } from '../stores/practice'

const store = usePracticeStore()

const host = ref<HTMLElement | null>(null)

let waveSurfer: WaveSurfer | null = null
let regionsPlugin: ReturnType<typeof RegionsPlugin.create> | null = null
let loopRegion: Region | null = null
const markerRegions = new Map<string, Region>()
let updatingLoopFromRegion = false

const hasAudio = computed(() => Boolean(store.fileObjectUrl))

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

function syncLoopRegion() {
  if (!regionsPlugin || !store.durationSec) return
  if (loopRegion) {
    loopRegion.remove()
    loopRegion = null
  }

  loopRegion = regionsPlugin.addRegion({
    id: 'loop',
    start: store.loop.startSec,
    end: store.loop.endSec,
    drag: true,
    resize: true,
    color: store.loop.enabled ? 'rgba(11, 173, 107, 0.28)' : 'rgba(11, 173, 107, 0.14)',
    minLength: 0.05,
    content: `Loop (${store.loop.mode})`,
  })

  loopRegion.on('update-end', () => {
    if (!loopRegion) return
    updatingLoopFromRegion = true
    store.updateLoop({
      ...store.loop,
      startSec: loopRegion.start,
      endSec: loopRegion.end,
      enabled: true,
    })
    updatingLoopFromRegion = false
  })
}

async function loadWaveform(url: string) {
  if (!waveSurfer) return
  await waveSurfer.load(url)
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
        syncLoopRegion()
        refreshMarkers()
      })
    },
    { immediate: true },
  )

  watch(
    () => [store.loop.startSec, store.loop.endSec, store.loop.enabled, store.loop.mode],
    () => {
      if (updatingLoopFromRegion) return
      syncLoopRegion()
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
  for (const region of markerRegions.values()) {
    region.remove()
  }
  markerRegions.clear()
  loopRegion?.remove()
  waveSurfer?.destroy()
})
</script>

<template>
  <section class="waveform-shell">
    <header class="wave-head">
      <h2>Waveform</h2>
      <span v-if="hasAudio">Click waveform to seek. Drag green region for loop.</span>
      <span v-else>Import audio file to start.</span>
    </header>
    <div ref="host" class="waveform-host" />
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
  align-items: baseline;
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

.waveform-host {
  min-height: 180px;
  max-width: 100%;
  overflow: hidden;
}
</style>
