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
  const records = await request(database.transaction(storeName).objectStore(storeName).getAll()) as ProjectRecord[]
  return records.sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put(project)
  await transactionDone(transaction)
}

export async function removeProject(id: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).delete(id)
  await transactionDone(transaction)
}

export function selectedProjectId(): string | null {
  return localStorage.getItem(selectedProjectKey)
}

export function selectProjectId(id: string): void {
  localStorage.setItem(selectedProjectKey, id)
}

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore(storeName, { keyPath: 'id' })
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab.'))
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
