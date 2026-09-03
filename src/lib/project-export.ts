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
  const mantleRelease = `https://github.com/aotter/mantle/releases/tag/v${mantleVersion}`
  return `# ${projectName}: Mantle coding-agent handoff

This ZIP is a coding-agent handoff, not a ready-to-run application. Its source of truth is \`manifests/site.yaml\`.

## Pinned Mantle contract

- \`@aotter/mantle\`, \`@aotter/mantle-admin\`, \`@aotter/mantle-admin-ui\`, \`@aotter/mantle-runtime\`, \`@aotter/mantle-spec\`, and \`@aotter/mantle-web\`: \`${mantleVersion}\`
- Runtime, Spec, and Web source: \`${runtimeSourceRevision}\`
- Admin, CLI, and docs source: \`${adminSourceRevision}\`
- [Mantle develop skill](${mantleRoot}/skills/develop/SKILL.md)
- [Manifest grammar and design atoms](${mantleRoot}/docs/design-atoms.md)
- [Four-atom model decision](${mantleRoot}/docs/adr/0001-four-atom-manifest-model.md)
- [Mantle ${mantleVersion} release and bootstrap](${mantleRelease})
- [Mantle WebMCP documentation](${runtimeRoot}/packages/mantle-web/README.md#webmcp-opt-in)

## What to do

1. Read the pinned develop skill and documentation above before editing.
2. Open the pinned Mantle release above and follow its exact Blank bootstrap command; do not select a typed starter.
3. Replace the Blank project's \`manifests/site.yaml\` with the file from this ZIP.
4. Inspect the Manifest before adding code. Keep business rules in Schema, View, Procedure, and Trigger resources.
5. Implement only consumer-owned gaps the Manifest cannot express: handler refs, frontend composition, provider configuration, and equivalent project wiring.
6. Treat \`examples/register-webmcp.example.ts\` as a reference. Replace every placeholder from the Manifest and current route wiring.
7. Run only the verification scripts declared by the generated project's \`package.json\`: Mantle validation/generation, typecheck, any available tests, production build, and Worker dry-run. Do not invent a test command when no test script exists.

The default production Admin uses self-managed GitHub OAuth. After the first deploy, follow \`DEPLOY.md\` to configure the GitHub OAuth App, Worker variables and secrets, then sign in as the initial owner. Never put secret values in source, the handoff ZIP, or agent chat.

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
3. Run its declared typecheck, test (when present), and production build scripts.
4. Review the generated routes, Cloudflare bindings, auth mode, and required secrets. Confirm which public site, Admin, API, MCP, and browser WebMCP surfaces the project actually exposes.

Use the scripts declared by the generated project. A pinned Blank project currently exposes this check loop:

\`\`\`sh
pnpm install --frozen-lockfile
pnpm validate
pnpm generate
pnpm typecheck
pnpm build
\`\`\`

Run \`pnpm test\` only when the generated \`package.json\` declares a \`test\` script.

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

## First deploy to Cloudflare

1. Authenticate Wrangler using the user's Cloudflare account.
2. Provision only the bindings declared by the generated project.
3. Run the generated project's documented deploy command.
4. Record its HTTPS Worker URL and verify the public site. Admin remains unavailable until Auth is configured below.

Use the generated project's commands after reviewing its configuration:

\`\`\`sh
pnpm exec wrangler login
pnpm deploy
\`\`\`

## Enable your Admin with GitHub

The default Auth mode is self-managed GitHub OAuth.

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Homepage URL** to your Worker URL, for example \`https://your-site.workers.dev\`.
3. Set **Authorization callback URL** to \`https://your-site.workers.dev/api/auth/callback/github\`. Leave Device Flow disabled.
4. Put these non-secret values in the generated project's \`wrangler.toml\` \`[vars]\` section:

\`\`\`toml
PUBLIC_ORIGIN = "https://your-site.workers.dev"
MANTLE_AUTH_MODE = "self-managed"
GITHUB_CLIENT_ID = "<github-oauth-client-id>"
ADMIN_GITHUB_LOGIN = "<your-github-login>"
\`\`\`

\`ADMIN_GITHUB_LOGIN\` is the GitHub username allowed to become the first owner when no owner exists yet.

5. Add the two secret values through Cloudflare's Worker settings, or from the project directory:

\`\`\`sh
read -rsp "GitHub OAuth client secret: " MANTLE_GITHUB_CLIENT_SECRET && printf '\\n'
printf '%s' "$MANTLE_GITHUB_CLIENT_SECRET" | pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -hex 32 | pnpm exec wrangler secret put BETTER_AUTH_SECRET
unset MANTLE_GITHUB_CLIENT_SECRET
\`\`\`

Keep \`BETTER_AUTH_SECRET\` stable; rotating it signs out existing sessions. Never paste either secret into source files, Git, or agent chat.

6. Commit and push the non-secret \`wrangler.toml\` changes, then redeploy with \`pnpm deploy\`.
7. Open \`https://your-site.workers.dev/admin/sign-in\` and sign in with the GitHub account named by \`ADMIN_GITHUB_LOGIN\`. Verify the Admin and every API, MCP, or WebMCP surface the project claims to expose.

If you add a custom domain later, update \`PUBLIC_ORIGIN\` and the GitHub OAuth callback URL together, then redeploy.
`
