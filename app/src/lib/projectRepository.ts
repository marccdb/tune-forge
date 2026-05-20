import { openDB, type DBSchema } from 'idb'
import type { PracticeProject } from '../types/practice'

const DB_NAME = 'anytune-practice-db'
const DB_VERSION = 1
const STORE_NAME = 'projects'

interface PracticeDB extends DBSchema {
  [STORE_NAME]: {
    key: string
    value: PracticeProject
    indexes: { 'by-updated-at': string }
  }
}

export interface ProjectRepository {
  get(projectId: string): Promise<PracticeProject | undefined>
  list(): Promise<PracticeProject[]>
  save(project: PracticeProject): Promise<void>
  delete(projectId: string): Promise<void>
}

async function getDB() {
  return openDB<PracticeDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('by-updated-at', 'updatedAt')
      }
    },
  })
}

export class IndexedDbProjectRepository implements ProjectRepository {
  async get(projectId: string): Promise<PracticeProject | undefined> {
    const db = await getDB()
    return db.get(STORE_NAME, projectId)
  }

  async list(): Promise<PracticeProject[]> {
    const db = await getDB()
    return db.getAllFromIndex(STORE_NAME, 'by-updated-at')
  }

  async save(project: PracticeProject): Promise<void> {
    const db = await getDB()
    const serializableProject = JSON.parse(JSON.stringify(project)) as PracticeProject
    await db.put(STORE_NAME, serializableProject)
  }

  async delete(projectId: string): Promise<void> {
    const db = await getDB()
    await db.delete(STORE_NAME, projectId)
  }
}
