import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { initialProjectDocument } from './project'
import { listProjects, removeProject, saveProject, type ProjectRecord } from './project-store'

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
})
