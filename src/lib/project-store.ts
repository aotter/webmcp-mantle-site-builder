import { initialProjectDocument, type ProjectDocument } from './project'

export interface ProjectRecord {
  id: string
  name: string
  manifest: ProjectDocument
  updatedAt: number
}

const databaseName = 'webmcp-mantle-site-builder'
const storeName = 'projects'
const selectedProjectKey = 'mantle-builder-project'
let connection: Promise<IDBDatabase> | undefined

export function createProjectRecord(): ProjectRecord {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled project',
    manifest: structuredClone(initialProjectDocument),
    updatedAt: Date.now(),
  }
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const database = await openDatabase()
  const records = await request(database.transaction(storeName).objectStore(storeName).getAll()) as unknown[]
  return readProjectRecords(records)
}

/**
 * Saved rows are untrusted: an older Builder revision may have written any shape.
 * Keep every row that still has an id so the user can delete it, and leave the
 * manifest untouched — it is validated when the project is activated.
 */
export function readProjectRecords(values: readonly unknown[]): ProjectRecord[] {
  return values
    .flatMap((value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
      const record = value as Partial<ProjectRecord>
      if (typeof record.id !== 'string' || record.id.length === 0) return []
      return [{
        id: record.id,
        name: typeof record.name === 'string' && record.name.trim().length > 0 ? record.name : 'Untitled project',
        manifest: record.manifest as ProjectDocument,
        updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
      }]
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put(project)
  await transactionDone(transaction)
}

export async function removeProject(id: string, replacement?: ProjectRecord): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  const done = transactionDone(transaction)
  try {
    const store = transaction.objectStore(storeName)
    store.delete(id)
    if (replacement) store.put(replacement)
    await done
  } catch (error) {
    try { transaction.abort() } catch { /* Transaction already finished. */ }
    await done.catch(() => {})
    throw error
  }
}

export function selectedProjectId(): string | null {
  return localStorage.getItem(selectedProjectKey)
}

export function selectProjectId(id: string): void {
  localStorage.setItem(selectedProjectKey, id)
}

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore(storeName, { keyPath: 'id' })
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab.'))
  }).catch((error: unknown) => {
    connection = undefined
    throw error
  })
  return connection
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
