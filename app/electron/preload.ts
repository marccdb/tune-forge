import { contextBridge, ipcRenderer } from 'electron'

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

type RefreshFolderData = {
  tracks: DesktopTrack[]
}

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

const ALLOWED_CHANNELS = new Set<string>(Object.values(CHANNELS))

async function invokeAllowed<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  if (!ALLOWED_CHANNELS.has(channel)) {
    return { ok: false, code: 'IPC_CHANNEL_FORBIDDEN', message: `Blocked channel: ${channel}` }
  }
  return ipcRenderer.invoke(channel, payload) as Promise<Result<T>>
}

const desktopApi = {
  pickFolder: () => invokeAllowed<PickFolderData>(CHANNELS.pickFolder),
  refreshFolder: (folderId: string) => invokeAllowed<RefreshFolderData>(CHANNELS.refreshFolder, { folderId }),
  readTrack: (folderId: string, relativePath: string) =>
    invokeAllowed<ReadTrackData>(CHANNELS.readTrack, { folderId, relativePath }),
}

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
