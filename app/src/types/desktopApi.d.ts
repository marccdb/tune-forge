export interface DesktopTrack {
  id: string
  name: string
  relativePath: string
  fingerprint: string
  lastModified: number
  size: number
}

export interface DesktopErrorResult {
  ok: false
  code: string
  message: string
}

export interface DesktopOkResult<T> {
  ok: true
  data: T
}

export type DesktopResult<T> = DesktopOkResult<T> | DesktopErrorResult

export interface DesktopApi {
  pickFolder(): Promise<DesktopResult<{ folderId: string; folderName: string; tracks: DesktopTrack[] }>>
  refreshFolder(folderId: string): Promise<DesktopResult<{ tracks: DesktopTrack[] }>>
  readTrack(
    folderId: string,
    relativePath: string,
  ): Promise<DesktopResult<{ name: string; mimeType: string; arrayBuffer: ArrayBuffer }>>
}

declare global {
  interface Window {
    desktopApi?: DesktopApi
  }
}
