# ModAudio (Electron Baseline)

Desktop-first practice workflow app built with Vue 3 + Vite + Electron.

## Run and Build

From `app/`:

- `npm run dev` - web dev
- `npm run build` - web production build
- `npm run dev:desktop` - Electron desktop dev
- `npm run build:desktop` - Electron desktop production build
- `npm run dist:desktop` - Electron package output
- `npm run test` - unit tests
- `npm run licenses:check` - runtime license allowlist/denylist gate
- `npm run licenses:notices` - regenerate `THIRD_PARTY_NOTICES.md`
- `npm run qa:memory-long-file` - long-file memory smoke check
- `npm run qa:package-smoke` - unpacked packaging smoke
- `npm run qa:desktop` - memory + packaging smoke sequence

If running Electron directly, make sure `ELECTRON_RUN_AS_NODE` is unset.

## CI Coverage

Workflow: `.github/workflows/desktop-ci.yml`

- license gate + notices drift check
- long-file memory behavior smoke
- packaging smoke on Linux/macOS/Windows
- desktop build artifacts: Linux AppImage (`linux-appimage`), Windows NSIS `.exe` (`windows-x64`), macOS Apple Silicon `.dmg` (`macos-arm64`, runs on `macos-14`)
