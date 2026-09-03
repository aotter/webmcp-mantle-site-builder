import { mountMantleAdmin, type AdminAuth, type MantleAdminRuntime } from '@aotter/mantle-admin'
import {
  createMantleRuntime,
  prepareDeployment,
  projectCallableCapabilities,
  type HandlerContext,
  type RuntimePlan,
} from '@aotter/mantle-runtime'
import { DiagnosticError } from '@aotter/mantle-spec'
import { Hono } from 'hono'

import { MemoryMantleStorageAdapter } from './memory-storage'
import type { BuilderDiagnostic } from './project'

export interface PreviewDeployment {
  fetch(request: Request): Promise<Response>
  invoke(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}

export async function createPreviewDeployment(
  plan: RuntimePlan,
  project: { readonly id: string; readonly name: string },
  origin: string,
): Promise<PreviewDeployment> {
  const env = Object.freeze({
    PUBLIC_ORIGIN: origin,
    PROJECT_ID: project.id,
    PROJECT_NAME: project.name,
  })
  const prepared = await prepareDeployment(plan, new MemoryMantleStorageAdapter(project.name, origin), { handlerNames: [] })
  const runtime = createMantleRuntime({ prepared })
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
  const context: HandlerContext<typeof env> = {
    user: { id: 'sandbox-member' },
    staff: null,
    auth: { credential: 'session', credentialId: 'sandbox-session', clientId: null, scopes: [] },
    env,
    waitUntil,
  }

  return {
    fetch: async (request) => app.fetch(request, env),
    async invoke(name, input, signal) {
      signal?.throwIfAborted()
      const capability = projectCallableCapabilities(plan, { surface: 'public' }).find((item) => item.name === name)
      if (!capability) throw new Error(`Unknown public capability '${name}'.`)
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
  }
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

const mockAdminAuth: AdminAuth = {
  basePath: '/api/auth',
  handler: async () => new Response(null, { status: 404 }),
  methods: [],
  getSession: async () => ({ session: { id: 'sandbox-session' }, user: { id: 'sandbox-owner', githubLogin: 'sandbox' } }),
  getUserRole: async () => 'owner',
  listUsers: async () => [{
    id: 'sandbox-owner',
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
