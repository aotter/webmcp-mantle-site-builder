# WebMCP Mantle Site Builder

Competition project for building Mantle sites through host WebMCP tools while a
same-origin iframe renders the last valid revision in Mantle Admin Dev Console.

## Stack

- React 19, Vite, Tailwind CSS 4, and shadcn/ui
- Cloudflare Workers Static Assets with the official Vite plugin
- Unreleased Mantle spec, runtime, and web packages packed from commit
  `620252551b012295a6bb882de4274213e66fe4dd`

## Local development

```bash
npm install
npm run dev
```

The host is served at `/` and Mantle Admin Dev Console is copied from the pinned
unreleased package into `/_mantle/admin/`. The Worker health endpoint is
available at `/api/health`.

The iframe is trusted, same-origin, unsandboxed Mantle Admin code; it is not a
security boundary from the Builder host. It boots `/_mantle/admin/index.html`, which the host bridge renames to
`/admin/dev`. Admin is a client-side SPA, so any document navigation under
`/admin/*` (except `/admin/api/*`) is served that same Admin document by the
Worker — `run_worker_first` in `wrangler.jsonc` keeps this ahead of the host SPA
fallback in both dev and deploy. `/admin/api/*` and `/api/auth/*` stay on the
postMessage host bridge, so Admin's `location.href` CSV export download
(`/admin/api/entries/export`) is not supported inside the iframe.

The project menu exports the current valid Manifest as a client-side coding-agent
handoff ZIP. It contains four authored files only and is intentionally not a
ready-to-run generated application.

## Verification

```bash
npm run check
npm run cf-typegen
npm run build
npx wrangler deploy --dry-run
```

Deployment is intentionally not configured or performed yet.
