import type { ProcedureCallableCapability, ViewCallableCapability } from '@aotter/mantle-runtime'
import type { JsonSchema, ProcedureManifest, ViewManifest } from '@aotter/mantle-spec'

const emptyInput: JsonSchema = { type: 'object', properties: {}, additionalProperties: false }

export function publicViewCapability(name: string, description: string, inputSchema: JsonSchema = emptyInput): ViewCallableCapability {
  const manifest: ViewManifest = {
    apiVersion: 'cms.mantle.aotter.net/v1',
    kind: 'View',
    metadata: { name },
    spec: { title: name, surface: 'public', from: 'builder-projects', fields: ['id'] },
  }
  return { name, kind: 'view', ownerName: name, surface: 'public', description, inputSchema, manifest }
}

export function publicProcedureCapability(
  name: string,
  description: string,
  inputSchema: JsonSchema,
): ProcedureCallableCapability {
  const outputSchema: JsonSchema = { type: 'object' }
  const manifest: ProcedureManifest = {
    apiVersion: 'cms.mantle.aotter.net/v1',
    kind: 'Procedure',
    metadata: { name },
    spec: { title: name, input: inputSchema, output: outputSchema, handler: { kind: 'ref', ref: name } },
  }
  return {
    name,
    kind: 'procedure',
    ownerName: name,
    trigger: `${name}-webmcp`,
    surface: 'public',
    description,
    inputSchema,
    outputSchema,
    manifest,
  }
}
