import { DiagnosticError } from '@aotter/mantle-spec'
import { describe, expect, it } from 'vitest'

import {
  applyProjectPatch,
  assertActiveTarget,
  createMutationQueue,
  createProjectState,
  initialProjectDocument,
  type CandidateResult,
  type ProjectDocument,
  type ProjectState,
} from './project'
import { readProjectRecords } from './project-store'
import {
  builderCapabilities,
  getStarted,
  presetNames,
  proposePreset,
  publicTools,
  startingPrompt,
} from './builder'
import { createPreviewDeployment, previewDeploymentDiagnostics, type PreviewDeployment } from './preview-deployment'

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

function accept(result: CandidateResult): ProjectState {
  if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '))
  return { ...result.candidate, revision: result.nextRevision }
}

describe('Builder authoring contract', () => {
  it('returns candidates and leaves committed state unchanged when a patch is invalid', () => {
    expect(createProjectState(initialProjectDocument).plan.views).toEqual({})

    const initial = createProjectState(fixtureDocument)
    const committed = accept(applyProjectPatch(initial, 1, [
      { op: 'replace', path: '/views/items/spec/title', value: 'Available items' },
    ]))
    expect(committed.revision).toBe(2)
    expect(initial.document.views.items?.spec.title).toBe('Items')

    const invalid = applyProjectPatch(committed, 2, [
      { op: 'replace', path: '/views/items/spec/from', value: 'missing-schema' },
    ])
    expect(invalid.ok).toBe(false)
    if (invalid.ok) throw new Error('Expected the candidate to be rejected.')
    expect(invalid.currentRevision).toBe(2)
    expect(invalid.diagnostics[0]?.path).toBe('/views/items/spec/from')
    expect(committed.document.views.items?.spec.from).toBe('items')
    expect(committed.revision).toBe(2)
  })

  it('does not mutate the document when JSON Patch application fails', () => {
    const state = createProjectState(fixtureDocument)
    const invalid = applyProjectPatch(state, 1, [
      { op: 'replace', path: '/views/items/spec/title', value: 'Changed' },
      { op: 'replace', path: '/views/items/spec/missing', value: 'Invalid' },
    ])
    expect(invalid.ok).toBe(false)
    if (invalid.ok) throw new Error('Expected the patch to be rejected.')
    expect(invalid.diagnostics[0]?.code).toBe('INVALID_JSON_PATCH')
    expect(state.document.views.items?.spec.title).toBe('Items')
    expect(state.revision).toBe(1)
  })

  it('describes the pinned grammar concisely and returns only a requested embedded section', () => {
    const state = createProjectState(initialProjectDocument)
    const project = { id: 'project-a', name: 'Untitled project' }
    const guide = getStarted(state, { ready: true, revision: 1 }, project)
    expect(guide.presets.map(({ id }) => id)).toEqual(['intake', 'reservation', 'transaction', 'procurement'])
    expect(guide.project).toMatchObject({ id: 'project-a', revision: 1 })
    expect('content' in guide.manifestReference).toBe(false)
    expect(guide.preview.identity).toEqual({ kind: 'mock-member', userId: 'sandbox-member', credential: 'session' })

    const reference = '## TL;DR\n\nFour atoms.\n\n## Manifest envelope\n\nEnvelope details.'
    const detail = getStarted(state, { ready: true, revision: 1 }, project, { section: 'overview', content: reference })
    expect(detail.manifestReference.content).toMatch(/^## TL;DR/)
    expect(detail.manifestReference.content).not.toContain('## Manifest envelope')
    expect(JSON.stringify(guide)).not.toMatch(/starter/i)
  })

  it('compiles all four host presets offline and rejects a preset on a non-empty project', () => {
    const empty = createProjectState(initialProjectDocument)
    for (const preset of presetNames) expect(proposePreset(empty, preset, 1).ok).toBe(true)

    const transaction = accept(proposePreset(empty, 'transaction', 1))
    expect(transaction.document.triggers['place-order-mcp']?.spec.source.kind).toBe('mcp')
    expect(publicTools(transaction).some(({ ownerName }) => ownerName === 'place-order')).toBe(true)

    const procurement = accept(proposePreset(empty, 'procurement', 1))
    expect(procurement.document.triggers['review-requisition-mcp']?.spec.source).toMatchObject({ kind: 'mcp', surface: 'staff' })
    expect(() => proposePreset(transaction, 'intake', 2)).toThrow('empty project')
  })

  it('rejects stale revisions and delayed mutations for another project', () => {
    expect(() => applyProjectPatch(createProjectState(fixtureDocument), 2, [])).toThrow('Revision conflict')
    expect(() => assertActiveTarget({ id: 'project-b', revision: 1 }, { projectId: 'project-a', baseRevision: 1 })).toThrow('Project changed')
    expect(() => assertActiveTarget({ id: 'project-a', revision: 2 }, { projectId: 'project-a', baseRevision: 1 })).toThrow('Project changed')
    expect(() => assertActiveTarget({ id: 'project-a', revision: 1 }, { projectId: 'project-a', baseRevision: 1 })).not.toThrow()
  })

  it('keeps registered tool schemas and copied prompts on the same contract', () => {
    const schemas = Object.fromEntries(builderCapabilities.map(({ name, inputSchema }) => [name, inputSchema])) as Record<string, { required?: string[] }>
    expect(Object.keys(schemas)).toEqual([
      'builder_get_started',
      'builder_apply_preset',
      'builder_apply_manifest_patch',
      'builder_call_preview_tool',
      'builder_run_smoke_test',
    ])
    expect(schemas.builder_apply_preset?.required).toEqual(['projectId', 'baseRevision', 'preset', 'projectName'])
    expect(schemas.builder_apply_manifest_patch?.required).toEqual(['projectId', 'baseRevision', 'projectName', 'patch'])
    expect(schemas.builder_call_preview_tool?.required).toEqual(['projectId', 'baseRevision', 'name', 'input'])
    expect(schemas.builder_run_smoke_test?.required).toEqual(['projectId', 'baseRevision', 'actor', 'reset', 'seed', 'calls'])

    for (const preset of presetNames) {
      const prompt = startingPrompt(preset, 'Build it.')
      expect(prompt).toContain('builder_get_started')
      expect(prompt).toContain('builder_apply_preset')
      expect(prompt).toContain('projectId')
      expect(prompt).toContain('baseRevision: revision')
      expect(prompt).toContain('projectName')
      expect(prompt).toContain('wait for my confirmation')
      expect(prompt).toContain('builder_run_smoke_test')
      expect(prompt).not.toMatch(/starter/i)
    }
    const blank = startingPrompt('blank', 'Build it.')
    expect(blank).toContain('builder_apply_manifest_patch')
    expect(blank).toContain('{ projectId, baseRevision: revision, projectName, patch }')
    expect(blank).toContain('wait for my confirmation')
    expect(blank).not.toContain('builder_apply_preset')
  })

  it('keeps Blank as exactly four empty atom groups', () => {
    expect(initialProjectDocument).toEqual({ schemas: {}, views: {}, procedures: {}, triggers: {} })
  })

  it('serves Admin and invokes public tools through one host runtime', async () => {
    const state = accept(proposePreset(createProjectState(initialProjectDocument), 'intake', 1))
    const deployment = await createPreviewDeployment(state.plan, { id: 'test', name: 'Customer intake' }, 'https://builder.test')

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

  it('persists seeded sandbox data across preview deployments', async () => {
    const state = createProjectState(fixtureDocument)
    let entries = [] as Awaited<ReturnType<PreviewDeployment['seed']>>
    const storage = () => ({
      entries,
      persistEntries: async (next: typeof entries) => { entries = structuredClone(next) },
    })
    const first = await createPreviewDeployment(state.plan, { id: 'test', name: 'Catalog' }, 'https://builder.test', storage())
    await first.seed([{ collection: 'items', status: 'published', data: { name: 'Seeded' } }])

    const second = await createPreviewDeployment(state.plan, { id: 'test', name: 'Catalog' }, 'https://builder.test', storage())
    await expect(second.invoke('query_view_items', {}, undefined, 'anonymous')).resolves.toMatchObject({
      rows: [expect.objectContaining({ status: 'published' })],
    })

    const changed = structuredClone(fixtureDocument)
    changed.schemas.items = {
      ...changed.schemas.items!,
      spec: {
        ...changed.schemas.items!.spec,
        schema: {
          type: 'object',
          properties: { name: { type: 'integer' } },
          required: ['name'],
        },
      },
    }
    const incompatible = await createPreviewDeployment(createProjectState(changed).plan, { id: 'test', name: 'Catalog' }, 'https://builder.test', storage())
    expect(incompatible.compatibilityDiagnostics).toEqual([
      expect.objectContaining({ code: 'SANDBOX_INPUT_VALIDATION_FAILED', severity: 'warning' }),
    ])
  })

  it('reports a failed preview boot as actionable diagnostics instead of an opaque rejection', async () => {
    const boot = await createPreviewDeployment({} as never, { id: 'test', name: 'Broken' }, 'https://builder.test')
      .then(() => null, (error: unknown) => error)
    expect(boot).not.toBeNull()

    const diagnostics = previewDeploymentDiagnostics(boot)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: 'PREVIEW_BOOT_FAILED', phase: 'boot', severity: 'error', path: '/' })
    expect(diagnostics[0]?.suggestion).toContain('cannot boot')

    const carried = previewDeploymentDiagnostics(new DiagnosticError({
      code: 'VIEW_DIALECT_UNSUPPORTED',
      phase: 'boot',
      severity: 'error',
      path: '/views/items',
      message: 'Dialect is unavailable in the preview runtime.',
    }))
    expect(carried).toEqual([expect.objectContaining({ code: 'VIEW_DIALECT_UNSUPPORTED', path: '/views/items' })])
  })

  it('rejects handler refs that the Builder sandbox cannot dispatch', async () => {
    const document = structuredClone(fixtureDocument)
    document.procedures.custom = {
      apiVersion: 'cms.mantle.aotter.net/v1',
      kind: 'Procedure',
      metadata: { name: 'custom' },
      spec: {
        title: 'Custom',
        input: { type: 'object' },
        output: { type: 'object' },
        handler: { kind: 'ref', ref: 'customHandler' },
      },
    }
    const state = createProjectState(document)
    await expect(createPreviewDeployment(state.plan, { id: 'test', name: 'Custom' }, 'https://builder.test')).rejects.toThrow()
  })

  it('serializes queued mutations so only one commits against a revision', async () => {
    const serialize = createMutationQueue()
    let committed = createProjectState(fixtureDocument)
    const mutate = (baseRevision: number, title: string) => serialize(async () => {
      assertActiveTarget({ id: 'project-a', revision: committed.revision }, { projectId: 'project-a', baseRevision })
      const result = applyProjectPatch(committed, baseRevision, [{ op: 'replace', path: '/views/items/spec/title', value: title }])
      await Promise.resolve()
      committed = accept(result)
      return committed.revision
    })

    const [first, second] = await Promise.allSettled([mutate(1, 'First'), mutate(1, 'Second')])
    expect(first).toMatchObject({ status: 'fulfilled', value: 2 })
    expect(second).toMatchObject({ status: 'rejected' })
    expect((second as PromiseRejectedResult).reason).toMatchObject({ message: expect.stringContaining('Project changed') })
    expect(committed.revision).toBe(2)
    expect(committed.document.views.items?.spec.title).toBe('First')
  })

  it('keeps every readable saved record and normalizes untrusted fields', () => {
    const records = readProjectRecords([
      null,
      'not a record',
      [{ id: 'array' }],
      { name: 'No id', updatedAt: 9 },
      { id: 'broken', name: '  ', manifest: { schemas: 'nope' }, updatedAt: Number.NaN },
      { id: 'newer', name: 'Newer', manifest: initialProjectDocument, updatedAt: 20 },
      { id: 'older', name: 'Older', manifest: initialProjectDocument, updatedAt: 10 },
    ])
    expect(records.map(({ id }) => id)).toEqual(['newer', 'older', 'broken'])
    expect(records[2]).toMatchObject({ name: 'Untitled project', updatedAt: 0 })
    expect(() => createProjectState(records[2]!.manifest)).toThrow()
    expect(() => createProjectState(records[0]!.manifest)).not.toThrow()
  })
})
