import { projectCallableCapabilities } from '@aotter/mantle-runtime'
import type { Operation } from 'fast-json-patch'

import {
  applyProjectPatch,
  projectStateSummary,
  type BuilderDiagnostic,
  type CandidateResult,
  type ProjectDocument,
  type ProjectState,
} from './project'
import { publicProcedureCapability, publicViewCapability } from './webmcp'

const apiVersion = 'cms.mantle.aotter.net/v1' as const
export const mantleVersion = '0.1.0-alpha.14'
export const runtimeSourceRevision = '620252551b012295a6bb882de4274213e66fe4dd'
export const adminSourceRevision = 'c00b7e9b7399c6c3ff478c35aa7d0653a53e7a2e'

const presets = {
  intake: {
    description: 'Collect a public request and let staff review recent submissions.',
    bestFor: ['contact', 'application', 'intake', 'request', 'lead'],
    document: {
      schemas: {
        requests: {
          apiVersion,
          kind: 'Schema',
          metadata: { name: 'requests' },
          spec: {
            title: 'Requests',
            description: 'Requests submitted through the public intake flow.',
            lifecycle: 'operational',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'email', 'message'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 120 },
                email: { type: 'string', format: 'email' },
                message: { type: 'string', minLength: 1, maxLength: 2000 },
                createdAt: { type: 'number', 'x-mcp-hint': 'timestamp-ms', 'x-mantle-bind': 'now' },
              },
            },
          },
        },
      },
      views: {
        'recent-requests': {
          apiVersion,
          kind: 'View',
          metadata: { name: 'recent-requests' },
          spec: {
            title: 'Recent requests',
            surface: 'staff',
            from: 'requests',
            fields: ['id', 'name', 'email', 'message', 'createdAt'],
            orderBy: [{ field: 'createdAt', direction: 'desc' }],
            limit: 50,
          },
        },
      },
      procedures: {
        'submit-request': {
          apiVersion,
          kind: 'Procedure',
          metadata: { name: 'submit-request' },
          spec: {
            title: 'Submit request',
            description: 'Create a new public request.',
            input: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'email', 'message'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 120 },
                email: { type: 'string', format: 'email' },
                message: { type: 'string', minLength: 1, maxLength: 2000 },
              },
            },
            output: { type: 'object' },
            handler: { kind: 'builtin', op: 'create', schema: 'requests' },
          },
        },
      },
      triggers: {
        'submit-request-http': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'submit-request-http' },
          spec: { source: { kind: 'http', method: 'POST', path: '/api/requests' }, target: { procedure: 'submit-request' } },
        },
        'submit-request-mcp': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'submit-request-mcp' },
          spec: { source: { kind: 'mcp', surface: 'public' }, target: { procedure: 'submit-request' } },
        },
      },
    } satisfies ProjectDocument,
  },
  reservation: {
    description: 'Accept public reservations and expose the queue to staff.',
    bestFor: ['appointment', 'booking', 'reservation', 'schedule'],
    document: {
      schemas: {
        reservations: {
          apiVersion,
          kind: 'Schema',
          metadata: { name: 'reservations' },
          spec: {
            title: 'Reservations',
            lifecycle: 'operational',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'email', 'requestedFor'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 120 },
                email: { type: 'string', format: 'email' },
                requestedFor: { type: 'string', description: 'Requested date, time, or slot.' },
                partySize: { type: 'integer', minimum: 1 },
                note: { type: 'string', maxLength: 1000 },
                createdAt: { type: 'number', 'x-mcp-hint': 'timestamp-ms', 'x-mantle-bind': 'now' },
              },
            },
          },
        },
      },
      views: {
        'reservation-queue': {
          apiVersion,
          kind: 'View',
          metadata: { name: 'reservation-queue' },
          spec: {
            title: 'Reservation queue',
            surface: 'staff',
            from: 'reservations',
            fields: ['id', 'name', 'email', 'requestedFor', 'partySize', 'note', 'createdAt'],
            orderBy: [{ field: 'createdAt', direction: 'desc' }],
            limit: 50,
          },
        },
      },
      procedures: {
        'submit-reservation': {
          apiVersion,
          kind: 'Procedure',
          metadata: { name: 'submit-reservation' },
          spec: {
            title: 'Submit reservation',
            input: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'email', 'requestedFor'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 120 },
                email: { type: 'string', format: 'email' },
                requestedFor: { type: 'string' },
                partySize: { type: 'integer', minimum: 1 },
                note: { type: 'string', maxLength: 1000 },
              },
            },
            output: { type: 'object' },
            handler: { kind: 'builtin', op: 'create', schema: 'reservations' },
          },
        },
      },
      triggers: {
        'submit-reservation-http': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'submit-reservation-http' },
          spec: { source: { kind: 'http', method: 'POST', path: '/api/reservations' }, target: { procedure: 'submit-reservation' } },
        },
        'submit-reservation-mcp': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'submit-reservation-mcp' },
          spec: { source: { kind: 'mcp', surface: 'public' }, target: { procedure: 'submit-reservation' } },
        },
      },
    } satisfies ProjectDocument,
  },
  transaction: {
    description: 'Publish a catalog and accept orders through HTTP, MCP, and WebMCP.',
    bestFor: ['catalog', 'checkout', 'commerce', 'inventory', 'order', 'transaction'],
    document: {
      schemas: {
        'catalog-items': {
          apiVersion,
          kind: 'Schema',
          metadata: { name: 'catalog-items' },
          spec: {
            title: 'Catalog items',
            lifecycle: 'publishing',
            uniqueIndexes: [['slug']],
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['slug', 'title', 'priceMinor'],
              properties: {
                slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
                title: { type: 'string', minLength: 1, maxLength: 160 },
                description: { type: 'string', maxLength: 2000 },
                priceMinor: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
        orders: {
          apiVersion,
          kind: 'Schema',
          metadata: { name: 'orders' },
          spec: {
            title: 'Orders',
            lifecycle: 'operational',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['customerEmail', 'itemSlug', 'quantity'],
              properties: {
                customerEmail: { type: 'string', format: 'email' },
                itemSlug: { type: 'string', 'x-mantle-ref': 'catalog-items' },
                quantity: { type: 'integer', minimum: 1, maximum: 99 },
                createdAt: { type: 'number', 'x-mcp-hint': 'timestamp-ms', 'x-mantle-bind': 'now' },
              },
            },
          },
        },
      },
      views: {
        catalog: {
          apiVersion,
          kind: 'View',
          metadata: { name: 'catalog' },
          spec: {
            title: 'Catalog',
            surface: 'public',
            from: 'catalog-items',
            fields: ['id', 'slug', 'title', 'description', 'priceMinor', 'updatedAt'],
            filter: { eq: { field: 'status', value: 'published' } },
            orderBy: [{ field: 'title', direction: 'asc' }],
            limit: 100,
          },
        },
        orders: {
          apiVersion,
          kind: 'View',
          metadata: { name: 'orders' },
          spec: {
            title: 'Orders',
            surface: 'staff',
            from: 'orders',
            fields: ['id', 'customerEmail', 'itemSlug', 'quantity', 'createdAt'],
            orderBy: [{ field: 'createdAt', direction: 'desc' }],
            limit: 100,
          },
        },
      },
      procedures: {
        'place-order': {
          apiVersion,
          kind: 'Procedure',
          metadata: { name: 'place-order' },
          spec: {
            title: 'Place order',
            input: {
              type: 'object',
              additionalProperties: false,
              required: ['customerEmail', 'itemSlug', 'quantity'],
              properties: {
                customerEmail: { type: 'string', format: 'email' },
                itemSlug: { type: 'string' },
                quantity: { type: 'integer', minimum: 1, maximum: 99 },
              },
            },
            output: { type: 'object' },
            handler: { kind: 'builtin', op: 'create', schema: 'orders' },
          },
        },
      },
      triggers: {
        'place-order-http': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'place-order-http' },
          spec: { source: { kind: 'http', method: 'POST', path: '/api/orders' }, target: { procedure: 'place-order' } },
        },
        'place-order-mcp': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'place-order-mcp' },
          spec: { source: { kind: 'mcp', surface: 'public' }, target: { procedure: 'place-order' } },
        },
      },
    } satisfies ProjectDocument,
  },
  procurement: {
    description: 'Collect member purchase requisitions and let staff review the queue.',
    bestFor: ['approval', 'procurement', 'purchase request', 'requisition', 'supply'],
    document: {
      schemas: {
        'purchase-requisitions': {
          apiVersion,
          kind: 'Schema',
          metadata: { name: 'purchase-requisitions' },
          spec: {
            title: 'Purchase requisitions',
            description: 'Member-submitted purchase needs waiting for staff review.',
            lifecycle: 'operational',
            uniqueIndexes: [['requestNumber']],
            indexes: [['requestedBy', 'requestedAt'], ['requestStatus', 'needBy']],
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['requestNumber', 'requestedBy', 'item', 'quantity', 'needBy', 'justification', 'requestStatus', 'requestedAt'],
              properties: {
                requestNumber: { type: 'string', pattern: '^REQ-[A-Z0-9-]+$' },
                requestedBy: { type: 'string', 'x-mantle-bind': 'ctx.user' },
                item: { type: 'string', minLength: 1, maxLength: 160 },
                quantity: { type: 'integer', minimum: 1 },
                needBy: { type: 'number', 'x-mcp-hint': 'timestamp-ms' },
                justification: { type: 'string', minLength: 1, maxLength: 1000 },
                requestStatus: { type: 'string', enum: ['submitted', 'approved', 'rejected'] },
                reviewerNote: { type: 'string', maxLength: 1000 },
                requestedAt: { type: 'number', 'x-mcp-hint': 'timestamp-ms', 'x-mantle-bind': 'now' },
              },
            },
          },
        },
      },
      views: {
        'my-requisitions': {
          apiVersion,
          kind: 'View',
          metadata: { name: 'my-requisitions' },
          spec: {
            title: 'My requisitions',
            surface: 'public',
            from: 'purchase-requisitions',
            requires: { auth: { all: ['ctx.user'] } },
            fields: ['id', 'requestNumber', 'item', 'quantity', 'needBy', 'justification', 'requestStatus', 'reviewerNote', 'requestedAt'],
            filter: { eq: { field: 'requestedBy', value: { '$ctx.user': 'id' } } },
            orderBy: [{ field: 'requestedAt', direction: 'desc' }],
            limit: 100,
          },
        },
        'pending-approvals': {
          apiVersion,
          kind: 'View',
          metadata: { name: 'pending-approvals' },
          spec: {
            title: 'Pending approvals',
            surface: 'staff',
            from: 'purchase-requisitions',
            requires: { auth: { all: [{ 'ctx.staff': ['owner', 'editor'] }] } },
            fields: ['id', 'version', 'requestNumber', 'requestedBy', 'item', 'quantity', 'needBy', 'justification', 'requestedAt'],
            filter: { eq: { field: 'requestStatus', value: 'submitted' } },
            orderBy: [{ field: 'needBy', direction: 'asc' }],
            limit: 100,
          },
        },
      },
      procedures: {
        'submit-requisition': {
          apiVersion,
          kind: 'Procedure',
          metadata: { name: 'submit-requisition' },
          spec: {
            title: 'Submit requisition',
            input: {
              type: 'object',
              additionalProperties: false,
              required: ['requestNumber', 'item', 'quantity', 'needBy', 'justification', 'requestStatus'],
              properties: {
                requestNumber: { type: 'string', pattern: '^REQ-[A-Z0-9-]+$' },
                item: { type: 'string', minLength: 1, maxLength: 160 },
                quantity: { type: 'integer', minimum: 1 },
                needBy: { type: 'number', 'x-mcp-hint': 'timestamp-ms' },
                justification: { type: 'string', minLength: 1, maxLength: 1000 },
                requestStatus: { type: 'string', enum: ['submitted'] },
              },
            },
            output: { type: 'object' },
            handler: { kind: 'builtin', op: 'create', schema: 'purchase-requisitions' },
            requires: { auth: { all: ['ctx.user'] } },
          },
        },
        'review-requisition': {
          apiVersion,
          kind: 'Procedure',
          metadata: { name: 'review-requisition' },
          spec: {
            title: 'Review requisition',
            input: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'expectedVersion', 'requestStatus'],
              properties: {
                id: { type: 'string', 'x-mantle-ref': 'purchase-requisitions' },
                expectedVersion: { type: 'number', minimum: 1 },
                requestStatus: { type: 'string', enum: ['approved', 'rejected'] },
                reviewerNote: { type: 'string', maxLength: 1000 },
              },
            },
            output: { type: 'object' },
            handler: { kind: 'builtin', op: 'update', schema: 'purchase-requisitions' },
            requires: { auth: { all: [{ 'ctx.staff': ['owner', 'editor'] }] } },
          },
        },
      },
      triggers: {
        'submit-requisition-http': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'submit-requisition-http' },
          spec: { source: { kind: 'http', method: 'POST', path: '/api/requisitions' }, target: { procedure: 'submit-requisition' } },
        },
        'submit-requisition-mcp': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'submit-requisition-mcp' },
          spec: { source: { kind: 'mcp', surface: 'public' }, target: { procedure: 'submit-requisition' } },
        },
        'review-requisition-mcp': {
          apiVersion,
          kind: 'Trigger',
          metadata: { name: 'review-requisition-mcp' },
          spec: { source: { kind: 'mcp', surface: 'staff' }, target: { procedure: 'review-requisition' } },
        },
      },
    } satisfies ProjectDocument,
  },
} as const

export type PresetName = keyof typeof presets
export const presetNames = Object.keys(presets) as PresetName[]
export const referenceSectionNames = ['overview', 'schema', 'view', 'procedure', 'trigger', 'builtin', 'auth'] as const
export type ReferenceSection = (typeof referenceSectionNames)[number]

export const builderCapabilities = [
  publicViewCapability('builder_get_started', 'Call this first to inspect the pinned Mantle grammar, Builder presets, active project, and exact next tool calls.', {
    type: 'object',
    properties: { referenceSection: { type: 'string', enum: referenceSectionNames } },
    additionalProperties: false,
  }),
  publicProcedureCapability('builder_apply_preset', 'Apply one host-owned preset to the active empty project.', {
    type: 'object',
    properties: {
      projectId: { type: 'string', minLength: 1 },
      baseRevision: { type: 'integer', minimum: 1 },
      preset: { type: 'string', enum: presetNames },
      projectName: { type: 'string', minLength: 1, maxLength: 80 },
    },
    required: ['projectId', 'baseRevision', 'preset', 'projectName'],
    additionalProperties: false,
  }),
  publicProcedureCapability('builder_apply_manifest_patch', 'Compile an RFC 6902 JSON Patch against the active committed Mantle Manifest.', {
    type: 'object',
    properties: {
      projectId: { type: 'string', minLength: 1 },
      baseRevision: { type: 'integer', minimum: 1 },
      projectName: { type: 'string', minLength: 1, maxLength: 80 },
      patch: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'replace', 'move', 'copy', 'test'] },
            path: { type: 'string' },
            from: { type: 'string' },
            value: {},
          },
          required: ['op', 'path'],
          additionalProperties: false,
        },
      },
    },
    required: ['projectId', 'baseRevision', 'projectName', 'patch'],
    additionalProperties: false,
  }),
  publicProcedureCapability('builder_call_preview_tool', 'Call a projected public capability in the active site preview.', {
    type: 'object',
    properties: {
      projectId: { type: 'string', minLength: 1 },
      baseRevision: { type: 'integer', minimum: 1 },
      name: { type: 'string' },
      input: { type: 'object', additionalProperties: true },
    },
    required: ['projectId', 'baseRevision', 'name', 'input'],
    additionalProperties: false,
  }),
]

export function getStarted(
  state: ProjectState,
  preview: { ready: boolean; revision: number; diagnostics?: BuilderDiagnostic[] },
  project = { id: '', name: 'Untitled project' },
  reference?: { section: ReferenceSection; content: string },
) {
  return {
    pinned: {
      packages: {
        '@aotter/mantle': mantleVersion,
        '@aotter/mantle-admin': mantleVersion,
        '@aotter/mantle-admin-ui': mantleVersion,
        '@aotter/mantle-runtime': mantleVersion,
        '@aotter/mantle-spec': mantleVersion,
        '@aotter/mantle-web': mantleVersion,
      },
      sourceRevisions: {
        runtimeSpecWeb: runtimeSourceRevision,
        adminAndDocs: adminSourceRevision,
      },
    },
    grammar: {
      atoms: {
        Schema: 'Defines stored entity shape, lifecycle, and indexes.',
        View: 'Defines a named read surface over one Schema.',
        Procedure: 'Defines typed business logic; the Builder supports builtin handlers only.',
        Trigger: 'Binds HTTP, MCP, or lifecycle input to one Procedure.',
      },
      triggerSourceKinds: ['http', 'mcp', 'lifecycle'],
      builtinHandlers: ['create', 'update', 'upsert', 'delete', 'archive'],
      surfaces: ['public', 'staff'],
      authorization: 'Use requires.auth on Views and Procedures for user, staff-role, credential, or delegated-scope gates.',
    },
    manifestReference: {
      source: '@aotter/mantle/docs/design-atoms.md',
      availableSections: referenceSectionNames,
      ...(reference ? { section: reference.section, content: extractReferenceSection(reference.content, reference.section) } : {}),
    },
    limits: ['This Builder supports declarative Views and builtin Procedure handlers. Handler refs require generated TypeScript and are not authorable here yet.'],
    official: {
      developSkill: `https://github.com/aotter/mantle/blob/${adminSourceRevision}/skills/develop/SKILL.md`,
      fourAtomDecision: `https://github.com/aotter/mantle/blob/${adminSourceRevision}/docs/adr/0001-four-atom-manifest-model.md`,
    },
    presets: presetNames.map((name) => ({ id: name, description: presets[name].description, bestFor: presets[name].bestFor })),
    blankWorkflow: [
      'Interview the user about actors, data, operations, permissions, and entry points.',
      'Summarize the proposed Schema, View, Procedure, and Trigger model and wait for confirmation.',
      'Submit one complete builder_apply_manifest_patch call against the empty document.',
    ],
    nextTools: {
      preset: { name: 'builder_apply_preset', required: ['projectId', 'baseRevision', 'preset', 'projectName'] },
      blank: { name: 'builder_apply_manifest_patch', required: ['projectId', 'baseRevision', 'projectName', 'patch'] },
      patch: { name: 'builder_apply_manifest_patch', required: ['projectId', 'baseRevision', 'projectName', 'patch'] },
      preview: { name: 'builder_call_preview_tool', required: ['projectId', 'baseRevision', 'name', 'input'] },
    },
    project: { ...project, ...projectStateSummary(state), document: state.document },
    preview: {
      ready: preview.ready,
      appliedRevision: preview.revision,
      identity: { kind: 'mock-member', userId: 'sandbox-member', credential: 'session' },
      tools: publicTools(state),
      ...(preview.diagnostics?.length
        ? { error: preview.diagnostics[0]!.message, diagnostics: preview.diagnostics }
        : {}),
    },
  }
}

export function proposePreset(state: ProjectState, name: PresetName, baseRevision: number): CandidateResult {
  if (!presetNames.includes(name)) throw new TypeError(`Unknown preset '${name}'.`)
  if (Object.values(state.document).some((group) => Object.keys(group).length > 0)) {
    throw new Error('Presets can only be applied to an empty project. Create a new project to choose another preset.')
  }
  const document = structuredClone(presets[name].document) as ProjectDocument
  const patch: Operation[] = Object.entries(document).map(([group, value]) => ({ op: 'replace', path: `/${group}`, value }))
  return applyProjectPatch(state, baseRevision, patch)
}

export function startingPrompt(type: PresetName | 'blank', brief: string) {
  if (type === 'blank') {
    return `Use the WebMCP tools on this page to design a Mantle service with me.\n\n1. Call builder_get_started first.\n2. Interview me about actors, data, operations, permissions, and HTTP, MCP, or WebMCP entry points.\n3. Summarize the proposed Schema, View, Procedure, and Trigger model and wait for my confirmation.\n4. After confirmation, choose a concise projectName and make one complete builder_apply_manifest_patch call with { projectId, baseRevision: revision, projectName, patch }.\n5. If validation fails, correct the patch against the unchanged currentRevision. Then test a projected public capability with builder_call_preview_tool using { projectId, baseRevision: currentRevision, name, input }.\n\nStarting context:\n${brief.trim()}`
  }
  return `Use the WebMCP tools on this page to build the service below.\n\n1. Call builder_get_started first.\n2. Choose a concise projectName, then call builder_apply_preset with { projectId, baseRevision: revision, preset: "${type}", projectName }. The host supplies the premade Manifest.\n3. Discuss how the preset should fit my actors, data, operations, permissions, and entry points. Summarize the proposed changes and wait for my confirmation.\n4. After confirmation, call builder_apply_manifest_patch with { projectId, baseRevision: currentRevision, projectName, patch } when changes are needed.\n5. If validation fails, correct the patch against the unchanged currentRevision. Then test a projected public capability with builder_call_preview_tool using { projectId, baseRevision: currentRevision, name, input }.\n\nService brief:\n${brief.trim()}`
}

export function publicTools(state: Pick<ProjectState, 'plan'>) {
  return projectCallableCapabilities(state.plan, { surface: 'public' }).map(({ name, kind, ownerName, description, inputSchema }) => ({
    name,
    kind,
    ownerName,
    description,
    inputSchema,
  }))
}

const referenceHeadings: Record<ReferenceSection, string> = {
  overview: '## TL;DR',
  schema: '### 1. `Schema`',
  view: '### 2. `View`',
  procedure: '### 3. `Procedure`',
  trigger: '### 4. `Trigger`',
  builtin: '### `handler.kind: builtin`',
  auth: '## RBAC',
}

function extractReferenceSection(markdown: string, section: ReferenceSection) {
  const lines = markdown.split('\n')
  const heading = referenceHeadings[section]
  const start = lines.findIndex((line) => line.startsWith(heading))
  if (start < 0) throw new Error(`Embedded Mantle reference is missing the '${section}' section.`)
  const level = heading.indexOf(' ')
  const end = lines.findIndex((line, index) => index > start && /^#{1,6} /.test(line) && line.indexOf(' ') <= level)
  return lines.slice(start, end < 0 ? undefined : end).join('\n').trim()
}
