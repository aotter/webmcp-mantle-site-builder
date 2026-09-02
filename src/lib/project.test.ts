import { describe, expect, it } from 'vitest'

import { applyPreviewSync, applyProjectPatch, createProjectState, emptyPreviewState, initialProjectDocument } from './project'

describe('Manifest revision boundary', () => {
  it('keeps the preview on the last valid revision and resynchronizes mismatches', () => {
    const initial = createProjectState(initialProjectDocument)
    const valid = applyProjectPatch(initial, 1, [
      { op: 'replace', path: '/views/inventory/spec/title', value: 'Available stock' },
    ])
    expect(valid.activated).toBe(true)

    const invalid = applyProjectPatch(valid.state, 2, [
      { op: 'replace', path: '/triggers/create-inventory-item-mcp/spec/target/procedure', value: 'missing-procedure' },
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
      patch: [{ op: 'replace', path: '/views/inventory/spec/title', value: 'Wrong base' }],
    })
    expect(mismatch.kind).toBe('resync')
    if (mismatch.kind !== 'resync') throw new Error('Expected a resync request.')
    expect(mismatch.state.revision).toBe(2)
  })
})
