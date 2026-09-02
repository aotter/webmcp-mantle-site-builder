import { describe, expect, it } from 'vitest'
import { projectDeveloperConsole } from '@aotter/mantle-admin'

import {
  applyPreviewSync,
  applyProjectPatch,
  createProjectState,
  emptyPreviewState,
  initialProjectDocument,
  type ProjectDocument,
} from './project'
import { applyStarter, getStarted, publicTools, starterNames } from './builder'

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
    expect(invalid.state.diagnostics[0]?.path).toBe('/views/items/spec/from')

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

  it('does not mutate a draft when a JSON Patch fails halfway through', () => {
    const initial = createProjectState(fixtureDocument)
    expect(() => applyProjectPatch(initial, 1, [
      { op: 'replace', path: '/views/items/spec/title', value: 'Changed' },
      { op: 'replace', path: '/views/items/spec/missing', value: 'Invalid' },
    ])).toThrow()
    expect(initial.draftDocument.views.items?.spec.title).toBe('Items')
  })

  it('starts from an official example and returns agent-readable grammar', () => {
    const initial = createProjectState(initialProjectDocument)
    const guide = getStarted(initial, { ready: true, revision: 1 })
    expect(guide.grammar.builtins.operations).toContain('create')
    expect(guide.starters.map(({ name }) => name)).toEqual(['intake', 'reservation', 'transaction', 'procurement'])

    for (const starter of starterNames) expect(applyStarter(initial, starter, 1).response.valid).toBe(true)

    const started = applyStarter(initial, 'transaction', 1)
    expect(started.response.valid).toBe(true)
    expect(started.response.document.triggers['place-order-mcp']?.spec.source.kind).toBe('mcp')
    expect(publicTools(started.state).some(({ ownerName }) => ownerName === 'place-order')).toBe(true)
    expect(projectDeveloperConsole(started.state.activePlan).graph.atoms).toContainEqual(expect.objectContaining({ id: 'Trigger:place-order-mcp' }))
    expect(applyStarter(initial, 'procurement', 1).response.document.triggers['review-requisition-mcp']?.spec.source).toMatchObject({ kind: 'mcp', surface: 'staff' })
    expect(() => applyStarter(started.state, 'intake', 2)).toThrow('replace: true')
  })
})
