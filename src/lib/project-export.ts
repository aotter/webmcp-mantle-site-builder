import { strToU8, zipSync } from 'fflate'

import { adminSourceRevision, mantleVersion, runtimeSourceRevision } from './builder'
import { projectDocumentYaml, type ProjectDocument } from './project'

export interface ProjectExportSnapshot {
  projectId: string
  name: string
  revision: number
  document: ProjectDocument
}

export interface ProjectHandoff {
  filename: string
  root: string
  files: Record<string, string>
  bytes: Uint8Array
}

export function projectArchiveName(name: string, projectId: string): string {
  return `${safeProjectSlug(name, projectId)}.zip`
}

export function createProjectHandoff(
  snapshot: ProjectExportSnapshot,
  active: { readonly projectId: string; readonly revision: number },
): ProjectHandoff {
  if (snapshot.projectId !== active.projectId || snapshot.revision !== active.revision) {
    throw new Error('Project changed. Reopen the project menu and download again.')
  }
  if (!Object.values(snapshot.document).some((group) => Object.keys(group).length > 0)) {
    throw new Error('Add at least one Manifest atom before downloading the project.')
  }

  const root = safeProjectSlug(snapshot.name, snapshot.projectId)
  const document = structuredClone(snapshot.document)
  const files = {
    [`${root}/manifests/site.yaml`]: projectDocumentYaml(document),
    [`${root}/HANDOFF.md`]: handoffNote(snapshot.name),
    [`${root}/examples/register-webmcp.example.ts`]: webMcpExample,
    [`${root}/DEPLOY.md`]: deployGuide,
  }
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])), { level: 6 })
  return { filename: `${root}.zip`, root, files, bytes }
}

function safeProjectSlug(name: string, projectId: string): string {
  const fromName = name.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64).replace(/-+$/gu, '')
  if (fromName) return fromName
  const suffix = projectId.toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 8)
  return `mantle-project${suffix ? `-${suffix}` : ''}`
}

function handoffNote(projectName: string): string {
  const mantleRoot = `https://github.com/aotter/mantle/blob/${adminSourceRevision}`
  const runtimeRoot = `https://github.com/aotter/mantle/blob/${runtimeSourceRevision}`
  return `# ${projectName}: Mantle coding-agent handoff

This ZIP is a coding-agent handoff, not a ready-to-run application. Its source of truth is \`manifests/site.yaml\`.

## Pinned Mantle contract

- \`@aotter/mantle\`, \`@aotter/mantle-admin\`, \`@aotter/mantle-admin-ui\`, \`@aotter/mantle-runtime\`, \`@aotter/mantle-spec\`, and \`@aotter/mantle-web\`: \`${mantleVersion}\`
- Runtime, Spec, and Web source: \`${runtimeSourceRevision}\`
- Admin, CLI, and docs source: \`${adminSourceRevision}\`
- [Mantle develop skill](${mantleRoot}/skills/develop/SKILL.md)
- [Manifest grammar and design atoms](${mantleRoot}/docs/design-atoms.md)
- [Four-atom model decision](${mantleRoot}/docs/adr/0001-four-atom-manifest-model.md)
- [Mantle Blank provisioning/CLI instructions](${mantleRoot}/packages/mantle/README.md)
- [Mantle WebMCP documentation](${runtimeRoot}/packages/mantle-web/README.md#webmcp-opt-in)

## What to do

1. Read the pinned develop skill and documentation above before editing.
2. Use the exact \`@aotter/mantle@${mantleVersion}\` CLI. Inspect its help, then follow its version-matched Blank provisioning flow; do not select a typed starter.
3. Replace the Blank project's \`manifests/site.yaml\` with the file from this ZIP.
4. Inspect the Manifest before adding code. Keep business rules in Schema, View, Procedure, and Trigger resources.
5. Implement only consumer-owned gaps the Manifest cannot express: handler refs, frontend composition, provider configuration, and equivalent project wiring.
6. Treat \`examples/register-webmcp.example.ts\` as a reference. Replace every placeholder from the Manifest and current route wiring.
7. Run the generated project's own Mantle validation and generation scripts, then its typecheck, tests, and production build.

Do not copy Builder sandbox identities or runtime records into the generated service.
`
}

const webMcpExample = `/**
 * Reference only. Replace tool names, schemas, and literal routes from
 * manifests/site.yaml, then re-check the pinned Mantle/WebMCP docs: the
 * imperative browser API is still evolving.
 */
type ModelContext = {
  registerTool(tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: Record<string, boolean>
    execute(input: Record<string, unknown>, context: { signal?: AbortSignal }): Promise<unknown>
  }, options: { signal: AbortSignal }): void | Promise<void>
}

const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext
const registrations = new AbortController()

if (modelContext) {
  void modelContext.registerTool({
    name: 'query_replace_with_public_view',
    description: 'Read from REPLACE_WITH_PUBLIC_VIEW.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(_input, { signal }) {
      const response = await fetch('/api/views/REPLACE_WITH_PUBLIC_VIEW', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      })
      if (!response.ok) throw new Error(\`View request failed (\${response.status}).\`)
      return response.json()
    },
  }, { signal: registrations.signal })

  void modelContext.registerTool({
    name: 'replace_with_public_procedure',
    description: 'Run REPLACE_WITH_PUBLIC_PROCEDURE.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute(input, { signal }) {
      const response = await fetch('/api/REPLACE_WITH_LITERAL_HTTP_ROUTE', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      })
      if (!response.ok) throw new Error(\`Procedure request failed (\${response.status}).\`)
      return response.json()
    },
  }, { signal: registrations.signal })
}

// Call when the page/app scope is disposed to unregister both tools.
export function disposeWebMcpExample() {
  registrations.abort()
}
`

const deployGuide = `# Publish the materialized Mantle project

Complete these steps only after a coding agent has provisioned the Blank project and copied in \`manifests/site.yaml\`.

## Verify locally

1. Install dependencies with the package manager recorded by the generated project.
2. Run the project's documented Mantle validation and generation scripts.
3. Run its typecheck, tests, and production build.
4. Review the generated routes, Cloudflare bindings, auth mode, and required secrets. Confirm which public site, Admin, API, MCP, and browser WebMCP surfaces the project actually exposes.

Use the scripts declared by the generated project. A pinned Blank project currently exposes this check loop:

\`\`\`sh
pnpm install --frozen-lockfile
pnpm validate
pnpm generate
pnpm typecheck
pnpm test
pnpm build
\`\`\`

## Push to GitHub

1. Ask the user to choose the GitHub owner, repository name, and public/private visibility.
2. Initialize Git only inside the generated project, review the files, and make the first commit.
3. Create the chosen repository and push the current branch. Do not infer ownership or visibility.

After the user has made those choices, the normal GitHub flow is:

\`\`\`sh
git init
git add .
git commit -m "Initial Mantle service"
gh repo create <owner>/<repository> --private --source=. --remote=origin --push
\`\`\`

Replace \`--private\` with \`--public\` only when the user explicitly chooses public visibility.

## Deploy to Cloudflare

1. Authenticate Wrangler using the user's Cloudflare account.
2. Provision only the bindings declared by the generated project.
3. Set required secrets through Wrangler or the Cloudflare dashboard; never commit secret values.
4. Run the generated project's documented deploy command.
5. Open the deployment URL and verify every surface the project claims to expose. Do not claim Admin, API, MCP, or WebMCP works until its real route responds as expected.

Use the generated project's commands after reviewing its configuration:

\`\`\`sh
pnpm exec wrangler login
pnpm deploy
\`\`\`
`
