import { describe, expect, it } from 'vitest'

import {
  applyPreviewSync,
  applyProjectPatch,
  createProjectState,
  emptyPreviewState,
  initialProjectDocument,
  type ProjectDocument,
} from './project'

const fixtureDocument: ProjectDocument = {
  schemas: {
    items: {
      apiVersion: 'cms.mantle.aotter.net/v1',
      kind: 'Schema',
      metadata: { name: 'items' },
      spec: { title: 'Items', schema: { type: 'object' } },
    },
  },
  views: {
    items: {
      apiVersion: 'cms.mantle.aotter.net/v1',
      kind: 'View',
      metadata: { name: 'items' },
      spec: { title: 'Items', surface: 'public', from: 'items' },
    },
  },
  procedures: {},
  triggers: {},
}

describe('Manifest revision boundary', () => {
  it('keeps the preview on the last valid revision and resynchronizes mismatches', () => {
    expect(createProjectState(initialProjectDocument).activePlan.views).toEqual({})

    const initial = createProjectState(fixtureDocument)
    const valid = applyProjectPatch(initial, 1, [
      { op: 'replace', path: '/views/items/spec/title', value: 'Available items' },
    ])
    expect(valid.activated).toBe(true)

    const invalid = applyProjectPatch(valid.state, 2, [
      { op: 'replace', path: '/views/items/spec/from', value: 'missing-schema' },
    ])
    expect(invalid.activated).toBe(false)
    expect(invalid.state.activeRevision).toBe(2)

    const snapshot = applyPreviewSync(emptyPreviewState(), {
      type: 'mantle:preview:snapshot',
      revision: valid.state.activeRevision,
      document: valid.state.activeDocument,
    })
    expect(snapshot.kind).toBe('applied')
    if (snapshot.kind !== 'applied') throw new Error('Expected snapshot activation.')

    const mismatch = applyPreviewSync(snapshot.state, {
      type: 'mantle:preview:patch',
      baseRevision: 99,
      revision: 100,
      patch: [{ op: 'replace', path: '/views/items/spec/title', value: 'Wrong base' }],
    })
    expect(mismatch.kind).toBe('resync')
    if (mismatch.kind !== 'resync') throw new Error('Expected a resync request.')
    expect(mismatch.state.revision).toBe(2)
  })
})
