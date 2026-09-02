import { projectCallableCapabilities } from '@aotter/mantle-runtime'
import { BUILTIN_OPS, LIFECYCLE_HOOKS, MCP_TRIGGER_SURFACES, STAFF_ROLES } from '@aotter/mantle-spec'
import type { Operation } from 'fast-json-patch'

import {
  applyProjectPatch,
  projectDocumentYaml,
  projectStateSummary,
  type ProjectDocument,
  type ProjectState,
} from './project'

const apiVersion = 'cms.mantle.aotter.net/v1' as const
const mantleVersion = '0.1.0-alpha.14'

const starters = {
  intake: {
    description: 'Collect a public request and let staff review recent submissions.',
    bestFor: ['contact', 'application', 'intake', 'request', 'lead'],
    source: 'https://github.com/aotter/mantle-starters/blob/develop/overlays/intake/manifests/site.yaml',
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
    source: 'https://github.com/aotter/mantle-starters/blob/develop/overlays/reservation/manifests/site.yaml',
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
    source: 'https://github.com/aotter/mantle-starters/blob/develop/overlays/transaction/manifests/site.yaml',
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
    source: 'https://github.com/aotter/mantle-starters/tree/develop/overlays/transaction',
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

export type StarterName = keyof typeof starters
export const starterNames = Object.keys(starters) as StarterName[]

export function getStarted(state: ProjectState, preview: { ready: boolean; revision: number }) {
  return {
    mantleVersion,
    workflow: [
      'For a premade flow, choose the closest starter and call builder_apply_starter.',
      'For a blank flow, skip builder_apply_starter and create the complete model with builder_apply_manifest_patch.',
      'On rejection, repair the draft using its draftRevision and structured diagnostics.',
      'Call builder_call_preview_tool with a projected public tool to verify the active revision.',
    ],
    grammar: {
      document: {
        '/schemas/<name>': 'Stored entity shape.',
        '/views/<name>': 'Typed read/query surface over a Schema.',
        '/procedures/<name>': 'Typed operation using a built-in CRUD handler or a registered handler ref.',
        '/triggers/<name>': 'HTTP, MCP, or lifecycle binding to a Procedure.',
      },
      invariants: [
        'Every map key must equal metadata.name and kind must match its map.',
        'Views reference existing Schemas; Triggers reference existing Procedures.',
        'GET reads are Views. Procedure HTTP triggers use POST, PUT, PATCH, or DELETE.',
        'Public MCP triggers project browser WebMCP tools; staff tools remain authenticated.',
      ],
      builtins: { operations: BUILTIN_OPS, lifecycleHooks: LIFECYCLE_HOOKS, mcpSurfaces: MCP_TRIGGER_SURFACES, staffRoles: STAFF_ROLES },
    },
    limits: ['This Builder currently edits Manifest atoms only. Use built-in handlers; handler refs require generated TypeScript that this toolset cannot write yet.'],
    official: {
      developSkill: `https://github.com/aotter/mantle/blob/v${mantleVersion}/skills/develop/SKILL.md`,
      manifestGrammar: `https://github.com/aotter/mantle/blob/v${mantleVersion}/packages/mantle-spec/src/domain/model/ManifestGrammar.ts`,
      fourAtomDecision: `https://github.com/aotter/mantle/blob/v${mantleVersion}/docs/adr/0001-four-atom-manifest-model.md`,
      starterExamples: 'https://github.com/aotter/mantle-starters/tree/develop/overlays',
    },
    starters: starterNames.map((name) => ({ name, description: starters[name].description, bestFor: starters[name].bestFor, source: starters[name].source })),
    project: { ...projectStateSummary(state), document: state.draftDocument },
    preview: {
      ready: preview.ready,
      appliedRevision: preview.revision,
      tools: publicTools(state),
    },
  }
}

export function applyStarter(state: ProjectState, name: StarterName, baseRevision: number, replace = false) {
  if (!starterNames.includes(name)) throw new TypeError(`Unknown starter '${name}'.`)
  if (!replace && Object.values(state.draftDocument).some((group) => Object.keys(group).length > 0)) {
    throw new Error('The project is not empty. Pass replace: true to replace the current draft explicitly.')
  }
  const document = structuredClone(starters[name].document) as ProjectDocument
  const patch: Operation[] = Object.entries(document).map(([group, value]) => ({ op: 'replace', path: `/${group}`, value }))
  const result = applyProjectPatch(state, baseRevision, patch)
  return {
    ...result,
    response: {
      starter: name,
      source: starters[name].source,
      ...projectStateSummary(result.state),
      document: result.state.draftDocument,
      manifestYaml: projectDocumentYaml(result.state.draftDocument),
      previewTools: publicTools(result.state),
      next: 'Customize this valid example with builder_apply_manifest_patch, then test one of previewTools through builder_call_preview_tool.',
    },
  }
}

export function publicTools(state: ProjectState) {
  return projectCallableCapabilities(state.activePlan, { surface: 'public' }).map(({ name, kind, ownerName, description, inputSchema }) => ({
    name,
    kind,
    ownerName,
    description,
    inputSchema,
  }))
}
