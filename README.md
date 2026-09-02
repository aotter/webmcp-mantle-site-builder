# WebMCP Mantle Site Builder

Competition project for building Mantle sites through host WebMCP tools while a
same-origin iframe renders the last valid compiled Manifest revision.

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

The host is served at `/`, the generated preview document at `/preview`, and
the Worker health endpoint at `/api/health`.

## Verification

```bash
npm run check
npm run cf-typegen
npm run build
npx wrangler deploy --dry-run
```

Deployment is intentionally not configured or performed yet.
