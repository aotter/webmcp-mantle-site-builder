import { compileRuntimePlan, type RuntimePlan } from '@aotter/mantle-runtime'
import {
  linkManifestSet,
  parseManifestSources,
  type Manifest,
  type ProcedureManifest,
  type SchemaManifest,
  type TriggerManifest,
  type ViewManifest,
  type Diagnostic,
} from '@aotter/mantle-spec'
import jsonPatch, { type Operation } from 'fast-json-patch'
import { stringify } from 'yaml'

export interface ProjectDocument {
  schemas: Record<string, SchemaManifest>
  views: Record<string, ViewManifest>
  procedures: Record<string, ProcedureManifest>
  triggers: Record<string, TriggerManifest>
}

export interface ProjectState {
  draftDocument: ProjectDocument
  draftRevision: number
  activeDocument: ProjectDocument
  activeRevision: number
  activePlan: RuntimePlan
  diagnostics: BuilderDiagnostic[]
}

export type BuilderDiagnostic = Pick<Diagnostic, 'code' | 'phase' | 'severity' | 'path' | 'message' | 'suggestion'>

export const initialProjectDocument: ProjectDocument = {
  schemas: {},
  views: {},
  procedures: {},
  triggers: {},
}

const groups = {
  schemas: 'Schema',
  views: 'View',
  procedures: 'Procedure',
  triggers: 'Trigger',
} as const

export function compileProjectDocument(document: ProjectDocument) {
  let source: string
  const pointers = projectDocumentPointers(document)
  try {
    source = projectDocumentYaml(document)
  } catch (error) {
    return { ok: false as const, diagnostics: [invalidDocumentDiagnostic(error)] }
  }

  const parsed = parseManifestSources({ sources: [{ sourceId: 'site.yaml', text: source }] })
  if (!parsed.ok) return { ok: false as const, diagnostics: parsed.diagnostics.map((diagnostic) => builderDiagnostic(diagnostic, pointers)) }

  const linked = linkManifestSet(parsed.value)
  if (!linked.ok) return { ok: false as const, diagnostics: linked.diagnostics.map((diagnostic) => builderDiagnostic(diagnostic, pointers)) }

  const compiled = compileRuntimePlan(linked.value)
  if (!compiled.ok) return { ok: false as const, diagnostics: compiled.diagnostics.map((diagnostic) => builderDiagnostic(diagnostic, pointers)) }
  return {
    ok: true as const,
    diagnostics: [...parsed.diagnostics, ...linked.diagnostics, ...compiled.diagnostics].map((diagnostic) => builderDiagnostic(diagnostic, pointers)),
    plan: compiled.value,
    source,
  }
}

export function projectDocumentYaml(document: ProjectDocument) {
  assertProjectDocument(document)
  const groupEntries = Object.entries(groups) as [keyof ProjectDocument, (typeof groups)[keyof ProjectDocument]][]
  return groupEntries
    .flatMap(([group, kind]) => (Object.entries(document[group]) as [string, Manifest][])
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, manifest]) => {
        if (manifest.kind !== kind || manifest.metadata?.name !== name) {
          throw new TypeError(`${group}/${name} must be a ${kind} manifest named '${name}'.`)
        }
        return stringify(manifest).trimEnd()
      }))
    .join('\n---\n') + '\n'
}

export function createProjectState(document: ProjectDocument): ProjectState {
  const compilation = compileProjectDocument(document)
  if (!compilation.ok) throw new Error(`Initial project is invalid: ${compilation.diagnostics.map(({ message }) => message).join('; ')}`)
  return {
    draftDocument: structuredClone(document),
    draftRevision: 1,
    activeDocument: structuredClone(document),
    activeRevision: 1,
    activePlan: compilation.plan,
    diagnostics: compilation.diagnostics,
  }
}

export function applyProjectPatch(state: ProjectState, baseRevision: number, patch: readonly Operation[]) {
  if (baseRevision !== state.draftRevision) {
    throw new Error(`Revision conflict: expected ${state.draftRevision}, received ${baseRevision}.`)
  }

  const draftDocument = applyJsonPatch(state.draftDocument, patch)
  const draftRevision = state.draftRevision + 1
  const compilation = compileProjectDocument(draftDocument)
  if (!compilation.ok) {
    return {
      state: { ...state, draftDocument, draftRevision, diagnostics: compilation.diagnostics },
      activated: false as const,
      activation: null,
    }
  }

  return {
    state: {
      draftDocument,
      draftRevision,
      activeDocument: structuredClone(draftDocument),
      activeRevision: draftRevision,
      activePlan: compilation.plan,
      diagnostics: compilation.diagnostics,
    },
    activated: true as const,
    activation: {
      baseRevision: state.activeRevision,
      revision: draftRevision,
      patch: jsonPatch.compare(state.activeDocument, draftDocument, true),
    },
  }
}

export function projectStateSummary(state: ProjectState) {
  return {
    draftRevision: state.draftRevision,
    activeRevision: state.activeRevision,
    valid: state.draftRevision === state.activeRevision,
    diagnostics: state.diagnostics,
    atoms: {
      schemas: Object.keys(state.activePlan.schemas).sort(),
      views: Object.keys(state.activePlan.views).sort(),
      procedures: Object.keys(state.activePlan.procedures).sort(),
      triggers: Object.keys(state.activePlan.triggers).sort(),
    },
  }
}

export function readPatch(value: unknown): Operation[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('patch must be a non-empty array.')
  const allowed = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test'])
  for (const operation of value) {
    if (!isRecord(operation) || typeof operation.op !== 'string' || !allowed.has(operation.op) || typeof operation.path !== 'string') {
      throw new TypeError('Each patch operation needs a supported op and JSON Pointer path.')
    }
  }
  return value as Operation[]
}

function applyJsonPatch<T>(document: T, patch: readonly Operation[]): T {
  return jsonPatch.applyPatch(document, [...patch], true, false, true).newDocument
}

function assertProjectDocument(document: unknown): asserts document is ProjectDocument {
  if (!isRecord(document)) throw new TypeError('Project document must be an object.')
  const actual = Object.keys(document).sort()
  const expected = Object.keys(groups).sort()
  if (actual.join('\0') !== expected.join('\0')) throw new TypeError(`Project document must contain only ${expected.join(', ')}.`)
  for (const group of expected) {
    if (!isRecord(document[group])) throw new TypeError(`${group} must be an object.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Invalid project document.'
}

function builderDiagnostic({ code, phase, severity, path, source, message, suggestion }: Diagnostic, pointers: string[]): BuilderDiagnostic {
  const prefix = source ? pointers[source.documentIndex] : undefined
  return { code, phase, severity, path: prefix ? `${prefix}${path}` : path, message, ...(suggestion ? { suggestion } : {}) }
}

function invalidDocumentDiagnostic(error: unknown): BuilderDiagnostic {
  return {
    code: 'INVALID_MANIFEST_ENVELOPE',
    phase: 'validate',
    severity: 'error',
    path: '/',
    message: messageOf(error),
  }
}

function projectDocumentPointers(document: ProjectDocument) {
  return (Object.keys(groups) as (keyof ProjectDocument)[]).flatMap((group) => Object.keys(document[group])
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `/${group}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`))
}
