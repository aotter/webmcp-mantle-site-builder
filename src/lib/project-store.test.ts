import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { initialProjectDocument } from './project'
import {
  listProjects,
  loadSandboxEntries,
  removeProject,
  saveProject,
  saveSandboxEntries,
  type ProjectRecord,
} from './project-store'

function record(id: string): ProjectRecord {
  return { id, name: id, manifest: structuredClone(initialProjectDocument), updatedAt: Date.now() }
}

describe('project persistence', () => {
  it('deletes and creates a required replacement atomically', async () => {
    const original = record('original')
    const replacement = record('replacement')
    await saveProject(original)
    await removeProject(original.id, replacement)
    expect((await listProjects()).map(({ id }) => id)).toEqual(['replacement'])

    const unclonable = { ...record('broken'), manifest: { bad: () => undefined } } as unknown as ProjectRecord
    await expect(removeProject(replacement.id, unclonable)).rejects.toThrow()
    expect((await listProjects()).map(({ id }) => id)).toEqual(['replacement'])
  })

  it('persists sandbox entries by project and removes them with the project', async () => {
    const project = record('sandbox-project')
    const entry = {
      id: 'entry-1',
      collection: 'items',
      status: 'published' as const,
      version: 1,
      data: { name: 'Persistent' },
      authorId: 'sandbox-owner',
      createdAt: 1,
      updatedAt: 1,
    }
    await saveProject(project)
    await saveSandboxEntries(project.id, [entry])
    await expect(loadSandboxEntries(project.id)).resolves.toEqual([entry])
    await removeProject(project.id)
    await expect(loadSandboxEntries(project.id)).resolves.toEqual([])
  })
})
