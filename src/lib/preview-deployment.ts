import { mountMantleAdmin, type AdminAuth, type MantleAdminRuntime } from '@aotter/mantle-admin'
import {
  createMantleRuntime,
  prepareDeployment,
  projectCallableCapabilities,
  type HandlerContext,
  type EntryRow,
  type RuntimePlan,
} from '@aotter/mantle-runtime'
import { DiagnosticError, EntryDataValidator } from '@aotter/mantle-spec'
import { Hono } from 'hono'

import { MemoryMantleStorageAdapter } from './memory-storage'
import type { BuilderDiagnostic } from './project'

export interface PreviewDeployment {
  fetch(request: Request): Promise<Response>
  invoke(name: string, input: Record<string, unknown>, signal?: AbortSignal, actor?: PreviewActor): Promise<unknown>
  seed(fixtures: readonly PreviewSeed[]): Promise<readonly EntryRow[]>
  readonly compatibilityDiagnostics: readonly BuilderDiagnostic[]
}

export type PreviewActor = 'anonymous' | 'member' | 'owner'

export interface PreviewSeed {
  readonly collection: string
  readonly data: Record<string, unknown>
  readonly status?: 'draft' | 'published'
}

export async function createPreviewDeployment(
  plan: RuntimePlan,
  project: { readonly id: string; readonly name: string },
  origin: string,
  storage: {
    readonly entries?: readonly EntryRow[]
    readonly persistEntries?: (entries: readonly EntryRow[]) => Promise<void>
  } = {},
): Promise<PreviewDeployment> {
  const env = Object.freeze({
    PUBLIC_ORIGIN: origin,
    PROJECT_ID: project.id,
    PROJECT_NAME: project.name,
  })
  const prepared = await prepareDeployment(
    plan,
    new MemoryMantleStorageAdapter(project.name, origin, storage.entries, storage.persistEntries),
    { handlerNames: [] },
  )
  const runtime = createMantleRuntime({ prepared })
  const compatibilityDiagnostics = sandboxCompatibilityDiagnostics(plan, storage.entries ?? [])
  if (!runtime.siteConfig || !runtime.updateSiteSettings) throw new Error('Sandbox storage did not prepare site settings.')
  const adminRuntime: MantleAdminRuntime = {
    ...runtime,
    siteConfig: runtime.siteConfig,
    updateSiteSettings: runtime.updateSiteSettings,
  }
  const app = new Hono()
  mountMantleAdmin(app, {
    plan,
    auth: mockAdminAuth,
    assets: { fetch: async () => null },
    get: async () => adminRuntime,
    requestContext: () => ({ env, waitUntil }),
  })
  const contextFor = (actor: PreviewActor): HandlerContext<typeof env> => ({
    user: actor === 'anonymous' ? null : { id: actor === 'owner' ? sandboxOwner.id : 'sandbox-member' },
    staff: actor === 'owner' ? { id: sandboxOwner.id, role: 'owner' } : null,
    ...(actor === 'anonymous' ? {} : { auth: { credential: 'session' as const, credentialId: 'sandbox-session', clientId: null, scopes: [] } }),
    env,
    waitUntil,
  })

  return {
    compatibilityDiagnostics,
    fetch: async (request) => app.fetch(request, env),
    async invoke(name, input, signal, actor = 'member') {
      signal?.throwIfAborted()
      const capabilities = projectCallableCapabilities(plan, actor === 'owner' ? undefined : { surface: 'public' })
      const capability = capabilities.find((item) => item.name === name)
      if (!capability) throw new Error(`Unknown capability '${name}' for sandbox actor '${actor}'.`)
      const context = contextFor(actor)
      if (capability.kind === 'procedure') {
        const response = await runtime.invokeTrigger({ trigger: capability.trigger, input, ctx: context })
        if (!response.ok) throw new Error(response.diagnostic.message)
        return response.data
      }
      const response = await runtime.executeView({
        view: capability.ownerName,
        options: {
          params: Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'page' && key !== 'show')),
          ...(typeof input.page === 'number' ? { page: input.page } : {}),
          ...(typeof input.show === 'number' ? { show: input.show } : {}),
        },
        ctx: context,
      })
      if (!response.ok) throw new Error(response.diagnostic.message)
      return response.result
    },
    async seed(fixtures) {
      const rows: EntryRow[] = []
      const context = contextFor('owner')
      for (const fixture of fixtures) {
        let row = await runtime.createDraft.execute({
          collection: fixture.collection,
          data: fixture.data,
          authorId: sandboxOwner.id,
          ctx: context,
          originalInput: fixture,
        })
        if (fixture.status === 'published' && row.status === 'draft') {
          row = await runtime.requestPublish.execute({ id: row.id, ctx: context, originalInput: fixture })
        }
        if (fixture.status && row.status !== fixture.status) {
          throw new Error(`Seed '${fixture.collection}' requested status '${fixture.status}' but the Schema lifecycle produced '${row.status}'.`)
        }
        rows.push(row)
      }
      return rows
    },
  }
}

function sandboxCompatibilityDiagnostics(plan: RuntimePlan, entries: readonly EntryRow[]): BuilderDiagnostic[] {
  const validator = new EntryDataValidator()
  return entries.flatMap((entry) => {
    const schema = plan.schemas[entry.collection]?.manifest
    if (!schema) {
      return [{
        code: 'SANDBOX_SCHEMA_MISSING',
        phase: 'runtime' as const,
        severity: 'warning' as const,
        path: `/sandbox/${entry.collection}/${entry.id}`,
        message: `Sandbox entry '${entry.id}' belongs to removed Schema '${entry.collection}'.`,
        suggestion: 'Run builder_execute_preview with reset: true and seed data that matches the current Manifest.',
      }]
    }
    return validator.validate(schema, entry.data, { partial: entry.status === 'draft' }).map((diagnostic) => ({
      code: `SANDBOX_${diagnostic.code}`,
      phase: diagnostic.phase,
      severity: 'warning' as const,
      path: `/sandbox/${entry.collection}/${entry.id}${diagnostic.path}`,
      message: `Sandbox entry '${entry.id}' no longer matches Schema '${entry.collection}': ${diagnostic.message}`,
      suggestion: 'Run builder_execute_preview with reset: true and seed data that matches the current Manifest.',
    }))
  })
}

const bootSuggestion = 'The Manifest compiles but cannot boot in the Builder preview runtime. Revise the atoms named above and apply the patch again.'

/**
 * A Manifest can compile and still fail to boot here — the host sandbox is an
 * in-memory adapter with no native View dialects. Report that as diagnostics so
 * the agent can fix the Manifest instead of seeing an opaque rejection.
 */
export function previewDeploymentDiagnostics(error: unknown): BuilderDiagnostic[] {
  if (error instanceof DiagnosticError) {
    return error.diagnostics.map(({ code, phase, severity, path, message, suggestion }) => ({
      code,
      phase,
      severity,
      path,
      message,
      suggestion: suggestion ?? bootSuggestion,
    }))
  }
  return [{
    code: 'PREVIEW_BOOT_FAILED',
    phase: 'boot',
    severity: 'error',
    path: '/',
    message: error instanceof Error ? error.message : 'Preview deployment failed.',
    suggestion: bootSuggestion,
  }]
}

const sandboxOwner = { id: 'sandbox-owner', githubLogin: 'sandbox' } as const

const mockAdminAuth: AdminAuth = {
  basePath: '/api/auth',
  handler: async () => new Response(null, { status: 404 }),
  methods: [],
  getSession: async () => ({ session: { id: 'sandbox-session' }, user: sandboxOwner }),
  getUserRole: async () => 'owner',
  listUsers: async () => [{
    id: sandboxOwner.id,
    email: 'owner@sandbox.invalid',
    name: 'Sandbox owner',
    role: 'owner',
    githubLogin: null,
    emailVerified: true,
    createdAt: new Date(0),
  }],
  listMembers: async () => ({ items: [], previousCursor: null, nextCursor: null }),
  setUserRole: async () => false,
  inviteUser: async () => ({ kind: 'created', id: crypto.randomUUID() }),
  revokeInvite: async () => false,
}

function waitUntil(promise: Promise<unknown>): void {
  void promise.catch((error) => console.error('Sandbox background task failed.', error))
}
