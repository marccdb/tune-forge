import { app, BrowserWindow, dialog, ipcMain, session, type OpenDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type OkResult<T> = { ok: true; data: T }
type ErrResult = { ok: false; code: string; message: string }
type Result<T> = OkResult<T> | ErrResult

type DesktopTrack = {
  id: string
  name: string
  relativePath: string
  fingerprint: string
  size: number
  lastModified: number
}

type PickFolderData = {
  folderId: string
  folderName: string
  tracks: DesktopTrack[]
}

type RefreshFolderInput = { folderId: string }
type ReadTrackInput = { folderId: string; relativePath: string }
type RefreshFolderData = { tracks: DesktopTrack[] }
type ReadTrackData = {
  name: string
  mimeType: string
  arrayBuffer: ArrayBuffer
}

const CHANNELS = {
  pickFolder: 'desktop:pick-folder',
  refreshFolder: 'desktop:refresh-folder',
  readTrack: 'desktop:read-track',
} as const

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  '.aac',
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.m4b',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.weba',
  '.webm',
  '.wma',
])

const MIME_BY_EXT: Record<string, string> = {
  '.aac': 'audio/aac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.weba': 'audio/webm',
  '.webm': 'video/webm',
  '.wma': 'audio/x-ms-wma',
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type FolderEntry = {
  absolutePath: string
  track: DesktopTrack
}

type CachedFolder = {
  folderId: string
  rootPath: string
  tracks: DesktopTrack[]
  byRelativePath: Map<string, FolderEntry>
}

const folderIdByRootPath = new Map<string, string>()
const folderCacheById = new Map<string, CachedFolder>()
let folderIdCounter = 1

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function err(code: string, message: string): ErrResult {
  return { ok: false, code, message }
}

function normalizeAbsolutePath(inputPath: string): string {
  return path.resolve(inputPath)
}

function toRelativeSlashPath(fromRoot: string, absolutePath: string): string {
  return path.relative(fromRoot, absolutePath).split(path.sep).join('/')
}

function isPathInside(root: string, targetPath: string): boolean {
  const relative = path.relative(root, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isSupportedMediaPath(absolutePath: string): boolean {
  return SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())
}

function buildFolderId(rootPath: string): string {
  const existing = folderIdByRootPath.get(rootPath)
  if (existing) return existing
  const folderId = `folder_${folderIdCounter++}`
  folderIdByRootPath.set(rootPath, folderId)
  return folderId
}

async function scanFolder(rootPath: string): Promise<CachedFolder> {
  const tracks: DesktopTrack[] = []
  const byRelativePath = new Map<string, FolderEntry>()
  const normalizedRoot = normalizeAbsolutePath(rootPath)
  const folderId = buildFolderId(normalizedRoot)

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isSymbolicLink()) {
        continue
      }
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!entry.isFile() || !isSupportedMediaPath(absolutePath)) {
        continue
      }

      const stat = await fs.stat(absolutePath)
      const relativePath = toRelativeSlashPath(normalizedRoot, absolutePath)
      const fingerprint = `${relativePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`
      const track: DesktopTrack = {
        id: fingerprint,
        name: entry.name,
        relativePath,
        fingerprint,
        size: stat.size,
        lastModified: Math.trunc(stat.mtimeMs),
      }
      tracks.push(track)
      byRelativePath.set(relativePath, { absolutePath, track })
    }
  }

  await walk(normalizedRoot)
  tracks.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }))
  return {
    folderId,
    rootPath: normalizedRoot,
    tracks,
    byRelativePath,
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await win.loadURL(devServerUrl)
  } else {
    await win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return win
}

function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.pickFolder, async (): Promise<Result<PickFolderData>> => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: 'Select music folder',
      properties: ['openDirectory', 'dontAddToRecent'],
    }
    const response = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, options)
      : await dialog.showOpenDialog(options)

    if (response.canceled || response.filePaths.length === 0) {
      return err('PICKER_CANCELLED', 'Folder selection cancelled.')
    }

    const folderPath = normalizeAbsolutePath(response.filePaths[0])
    try {
      const scanned = await scanFolder(folderPath)
      folderCacheById.set(scanned.folderId, scanned)
      return ok({
        folderId: scanned.folderId,
        folderName: path.basename(scanned.rootPath),
        tracks: scanned.tracks,
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to scan folder.'
      return err('SCAN_FAILED', message)
    }
  })

  ipcMain.handle(
    CHANNELS.refreshFolder,
    async (_event, payload: RefreshFolderInput): Promise<Result<RefreshFolderData>> => {
      const folderId = payload?.folderId ?? ''
      const existing = folderCacheById.get(folderId)
      if (!folderId || !existing) {
        return err('FOLDER_FORBIDDEN', 'Folder id is not in allowlist.')
      }

      try {
        const scanned = await scanFolder(existing.rootPath)
        const refreshed: CachedFolder = {
          ...scanned,
          folderId: existing.folderId,
        }
        folderCacheById.set(folderId, refreshed)
        return ok({
          tracks: refreshed.tracks,
        })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Failed to refresh folder.'
        return err('SCAN_FAILED', message)
      }
    },
  )

  ipcMain.handle(CHANNELS.readTrack, async (_event, payload: ReadTrackInput): Promise<Result<ReadTrackData>> => {
    const folderId = payload?.folderId ?? ''
    const relativePath = payload?.relativePath ?? ''
    const existing = folderCacheById.get(folderId)
    if (!existing) {
      return err('TRACK_FORBIDDEN', 'Folder id is not in allowlist.')
    }

    const entry = existing.byRelativePath.get(relativePath)
    if (!entry || !isPathInside(existing.rootPath, entry.absolutePath)) {
      return err('TRACK_FORBIDDEN', 'Track path is not in allowlist.')
    }

    try {
      const [stat, buffer] = await Promise.all([fs.stat(entry.absolutePath), fs.readFile(entry.absolutePath)])
      if (!stat.isFile()) {
        return err('TRACK_NOT_FILE', 'Track path is not a file.')
      }
      const extension = path.extname(entry.absolutePath).toLowerCase()
      return ok({
        name: path.basename(entry.absolutePath),
        mimeType: MIME_BY_EXT[extension] ?? 'application/octet-stream',
        arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to read track.'
      return err('READ_FAILED', message)
    }
  })
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  registerIpcHandlers()
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
