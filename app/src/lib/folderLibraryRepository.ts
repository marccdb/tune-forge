import { openDB, type DBSchema } from 'idb'
import type { FolderTrack, LibrarySnapshot } from '../types/practice'

const DB_NAME = 'anytune-library-db'
const DB_VERSION = 1
const STORE_NAME = 'library'
const SNAPSHOT_KEY = 'snapshot'

interface LibraryDB extends DBSchema {
  [STORE_NAME]: {
    key: string
    value: {
      key: string
      snapshot: LibrarySnapshot
    }
  }
}

type LegacyLibrarySnapshot = Omit<LibrarySnapshot, 'sourceType' | 'folderId' | 'tracks'> & {
  sourceType: 'directory-handle' | 'webkitdirectory'
  directoryHandle?: FileSystemDirectoryHandle | null
  folderId?: string | null
  tracks: Array<Omit<FolderTrack, 'sourceType'> & { sourceType: 'directory-handle' | 'webkitdirectory' }>
}

async function getDB() {
  return openDB<LibraryDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    },
  })
}

export interface FolderLibraryRepository {
  getSnapshot(): Promise<LibrarySnapshot | undefined>
  saveSnapshot(snapshot: LibrarySnapshot): Promise<void>
  clearSnapshot(): Promise<void>
}

export class IndexedDbFolderLibraryRepository implements FolderLibraryRepository {
  async getSnapshot(): Promise<LibrarySnapshot | undefined> {
    const db = await getDB()
    const value = await db.get(STORE_NAME, SNAPSHOT_KEY)
    const snapshot = value?.snapshot as LibrarySnapshot | LegacyLibrarySnapshot | undefined
    if (!snapshot) return undefined

    const sourceType = snapshot.sourceType === 'directory-handle' ? 'webkitdirectory' : snapshot.sourceType

    return {
      folderName: snapshot.folderName,
      tracks: snapshot.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        relativePath: track.relativePath,
        fingerprint: track.fingerprint,
        lastModified: track.lastModified,
        size: track.size,
        sourceType: track.sourceType === 'directory-handle' ? 'webkitdirectory' : track.sourceType,
      })),
      activeTrackId: snapshot.activeTrackId,
      sourceType,
      folderId: snapshot.folderId ?? null,
      updatedAt: snapshot.updatedAt,
    }
  }

  async saveSnapshot(snapshot: LibrarySnapshot): Promise<void> {
    const db = await getDB()
    const serializableSnapshot: LibrarySnapshot = {
      folderName: snapshot.folderName,
      tracks: snapshot.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        relativePath: track.relativePath,
        fingerprint: track.fingerprint,
        lastModified: track.lastModified,
        size: track.size,
        sourceType: track.sourceType,
      })),
      activeTrackId: snapshot.activeTrackId,
      sourceType: snapshot.sourceType,
      folderId: snapshot.folderId,
      updatedAt: snapshot.updatedAt,
    }
    await db.put(STORE_NAME, { key: SNAPSHOT_KEY, snapshot: serializableSnapshot })
  }

  async clearSnapshot(): Promise<void> {
    const db = await getDB()
    await db.delete(STORE_NAME, SNAPSHOT_KEY)
  }
}
