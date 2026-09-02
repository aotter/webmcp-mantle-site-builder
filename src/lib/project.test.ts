import { describe, expect, it } from 'vitest'

import {
  applyProjectPatch,
  createProjectState,
  initialProjectDocument,
  type ProjectDocument,
} from './project'
import { applyStarter, getStarted, publicTools, starterNames } from './builder'
import { createPreviewDeployment } from './preview-deployment'

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
  it('keeps the active deployment on the last valid revision', () => {
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
    expect(applyStarter(initial, 'procurement', 1).response.document.triggers['review-requisition-mcp']?.spec.source).toMatchObject({ kind: 'mcp', surface: 'staff' })
    expect(() => applyStarter(started.state, 'intake', 2)).toThrow('replace: true')
  })

  it('serves Admin and invokes public tools through one host runtime', async () => {
    const started = applyStarter(createProjectState(initialProjectDocument), 'intake', 1)
    const deployment = await createPreviewDeployment(started.state.activePlan, { id: 'test', name: 'Customer intake' }, 'https://builder.test')

    const developer = await deployment.fetch(new Request('https://builder.test/admin/api/developer-console'))
    expect(developer.status).toBe(200)
    await expect(developer.json()).resolves.toMatchObject({
      graph: { atoms: expect.arrayContaining([expect.objectContaining({ id: 'Trigger:submit-request-mcp' })]) },
    })

    await expect(deployment.invoke('submit_request', {
      name: 'Ada',
      email: 'ada@example.com',
      message: 'Please call me.',
    })).resolves.toMatchObject({ collection: 'requests', data: { name: 'Ada' } })

    const queue = await deployment.fetch(new Request('https://builder.test/admin/api/views/recent-requests'))
    expect(queue.status).toBe(200)
    await expect(queue.json()).resolves.toMatchObject({ data: { rows: [expect.objectContaining({ name: 'Ada' })] } })
  })
})
