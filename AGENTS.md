# Anytune-Style Web App Plan v3 (Open-Source-Only + Audacity-Informed)

## Summary
Build browser app (Vue 3.5 + TS, desktop-first) matching core Anytune workflow: local import, independent tempo/pitch, A/B loops, markers, shortcuts, per-song save.  
All runtime dependencies must be open source, with policy locked to `Permissive + LGPL` (no GPL runtime deps in v1).  
Use Audacity as reference for plugin categories/workflows, not native desktop plugin binary loading.

## Implementation Changes
1. **Dependency and license policy**
- Allowed licenses: MIT, BSD, Apache-2.0, LGPL.
- Excluded in v1 runtime: GPL-only DSP/plugin libs.
- Add automated license gate in CI (`license-checker` or equivalent) with denylist for GPL packages.
- Add `THIRD_PARTY_NOTICES.md` generation step in release pipeline.

2. **Core OSS stack (selected)**
- UI/framework: Vue 3.5 + TypeScript + Vite (OSS).
- Waveform/regions: `wavesurfer.js` + Regions plugin (BSD-3-Clause).
- Tempo+pitch engine: `signalsmith-stretch` (MIT) via WebAssembly + AudioWorklet wrapper.
- Media decode fallback (video→audio extraction, rare formats): `ffmpeg.wasm` wrapper (MIT) with explicitly LGPL-compatible `@ffmpeg/core` build profile only.
- Storage: IndexedDB wrapper (`idb`, MIT) for project persistence.
- Optional fallback DSP: SoundTouch-based path (LGPL) behind engine adapter, disabled by default.

3. **Audio/plugin architecture (Audacity-informed, browser-feasible)**
- Keep main features: transport, independent tempo/pitch, A/B loops, markers/loopmarks, keyboard shortcuts, per-song project restore.
- Add effect-chain architecture with `EffectNode` contract (pre/post stretch slots).
- v1 ships built-in open-source effect set mapped from Audacity common categories:
- EQ/filters (Biquad chain), dynamics (Compressor), delay/reverb (DelayNode/Convolver), pan/gain.
- No native VST/LV2/LADSPA/AU binary loading in v1.
- Plugin-ready API for future browser plugin bundles (WASM/JS + manifest + parameter schema).

4. **Project schema and Supabase-ready boundary**
- Keep local-only repo implementation now (`IndexedDbProjectRepository`).
- Freeze interfaces now for future cloud adapter:
- `ProjectRepository`, `PracticeProject`, `Loopmark`, `AudioEngine`, `EffectPreset`.
- Add `schemaVersion` and migration hooks from day one.

5. **Operational and compliance track**
- Add legal docs page in app (`/licenses`) listing all third-party deps and licenses.
- Add codec/build manifest for ffmpeg core flags used in release builds.
- Add “unsupported source” UX for DRM/streaming imports.
- Track OSS risk register: copyleft exposure, patent-sensitive codecs, wasm bundle size/perf.

## Public Interfaces / Types
- `AudioEngine`: `load`, `play`, `pause`, `seek`, `setTempo`, `setPitch`, `setLoop`, events (`timeupdate`, `statechange`, `error`).
- `EffectNode`: `id`, `name`, `params`, `setParam`, `connect`, `bypass`, `serialize`.
- `PracticeProject`: `id`, `trackMeta`, `tempo`, `pitch`, `loop`, `markers`, `effects`, `updatedAt`, `schemaVersion`.
- `ProjectRepository`: `get`, `list`, `save`, `delete`, `migrate`.
- `LicenseManifestEntry`: package, version, license, homepage, notice path.

## Test Plan
- Unit: tempo/pitch clamp math, loop validation, marker/loopmark ordering, effect preset serialize/restore, schema migrations.
- Integration: import→decode→play; tempo change keeps pitch; pitch change keeps tempo; loop boundaries stable under seek/play/pause; effects chain on/off without transport drift.
- Compliance tests: CI fails on forbidden license; notices file generated; ffmpeg core build flags verified against LGPL-only profile.
- Browser acceptance (latest Chrome/Edge/Safari/Firefox): AudioWorklet init, fallback engine activation, waveform sync, shortcut parity.
- Manual audio QA: short-loop click suppression, slow-practice quality (`0.5x`), ±12 semitone shifts, long-file memory behavior.

## Assumptions and Defaults
- “Use all open source dependencies” interpreted as: every chosen dependency must be OSS under approved policy, not “include every available OSS package.”
- v1 scope remains core Anytune workflow only; no trainer automation yet.
- Desktop-first remains priority; mobile parity deferred.
- Supabase deferred to v2, but repository boundary fixed now to avoid refactor later.

## Sources
- https://anytune.zendesk.com/hc/en-us/articles/360001988672-Getting-started-with-Anytune
- https://plugins.audacityteam.org/
- https://manual.audacityteam.org/man/customization.html
- https://manual.audacityteam.org/man/effect_menu_vst.html
- https://manual.audacityteam.org/man/effect_menu_nyquist.html
- https://raw.githubusercontent.com/audacity/audacity/master/LICENSE.txt
- https://github.com/katspaugh/wavesurfer.js
- https://raw.githubusercontent.com/katspaugh/wavesurfer.js/main/LICENSE
- https://github.com/Signalsmith-Audio/signalsmith-stretch
- https://raw.githubusercontent.com/Signalsmith-Audio/signalsmith-stretch/main/LICENSE.txt
- https://ffmpegwasm.netlify.app/docs/faq/
- https://svn.ffmpeg.org/legal.html
- https://raw.githubusercontent.com/FFmpeg-wasm/core/master/LICENSE.md
- https://www.surina.net/soundtouch/index.html
