import { strFromU8, unzipSync } from 'fflate'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'

import { adminSourceRevision, mantleVersion, runtimeSourceRevision, proposePreset } from './builder'
import { createProjectHandoff } from './project-export'
import { createProjectState, initialProjectDocument, type ProjectDocument } from './project'

function transactionDocument(): ProjectDocument {
  const result = proposePreset(createProjectState(initialProjectDocument), 'transaction', 1)
  if (!result.ok) throw new Error('Transaction fixture did not compile.')
  return result.candidate.document
}

describe('project handoff ZIP', () => {
  it('exports exactly four safe authored files and preserves the Manifest', () => {
    const document = transactionDocument()
    const handoff = createProjectHandoff({ projectId: '../unsafe', name: '../../Store 🛒', revision: 4, document }, { projectId: '../unsafe', revision: 4 })
    const extracted = unzipSync(handoff.bytes)
    expect(handoff.filename).toBe('store.zip')
    expect(Object.keys(extracted).sort()).toEqual([
      'store/DEPLOY.md',
      'store/HANDOFF.md',
      'store/examples/register-webmcp.example.ts',
      'store/manifests/site.yaml',
    ])
    expect(Object.keys(extracted).every((path) => path.startsWith('store/') && !path.includes('..'))).toBe(true)

    const parsed: ProjectDocument = { schemas: {}, views: {}, procedures: {}, triggers: {} }
    for (const yamlDocument of parseAllDocuments(strFromU8(extracted['store/manifests/site.yaml']!))) {
      const atom = yamlDocument.toJS() as { kind: string; metadata: { name: string } }
      const group = `${atom.kind.toLowerCase()}s` as keyof ProjectDocument
      ;(parsed[group] as Record<string, unknown>)[atom.metadata.name] = atom
    }
    expect(parsed).toEqual(document)
  })

  it('pins the handoff and keeps WebMCP/deployment guidance explicit', () => {
    const { files, root } = createProjectHandoff({ projectId: 'project-a', name: 'Orders', revision: 2, document: transactionDocument() }, { projectId: 'project-a', revision: 2 })
    const handoff = files[`${root}/HANDOFF.md`]!
    const webMcp = files[`${root}/examples/register-webmcp.example.ts`]!
    const deploy = files[`${root}/DEPLOY.md`]!

    expect(handoff).toContain(`@aotter/mantle@${mantleVersion}`)
    expect(handoff).toContain(runtimeSourceRevision)
    expect(handoff).toContain(adminSourceRevision)
    expect(handoff).toContain('Blank')
    expect(handoff).toContain('skills/develop/SKILL.md')
    expect(handoff).toContain('packages/mantle-web/README.md#webmcp-opt-in')
    expect(webMcp).toContain('document as Document & { modelContext?: ModelContext }')
    expect(webMcp).toContain("method: 'GET'")
    expect(webMcp).toContain("method: 'POST'")
    expect(webMcp).toContain("credentials: 'same-origin'")
    expect(webMcp).toContain('registrations.abort()')
    expect(deploy).toContain('choose the GitHub owner, repository name, and public/private visibility')
    expect(deploy).toContain('never commit secret values')
    expect(JSON.stringify(files)).not.toMatch(/sandbox-owner|sandbox-member|private[_-]?key|access[_-]?token/iu)
  })

  it('rejects empty and stale projects before creating an archive', () => {
    expect(() => createProjectHandoff({ projectId: 'a', name: 'Empty', revision: 1, document: initialProjectDocument }, { projectId: 'a', revision: 1 })).toThrow('at least one')
    expect(() => createProjectHandoff({ projectId: 'a', name: 'Orders', revision: 2, document: transactionDocument() }, { projectId: 'a', revision: 3 })).toThrow('Project changed')
  })
})
