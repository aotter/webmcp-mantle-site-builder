# Mantle Builder

**Describe the workflow. Ship the service.**

Mantle Builder is a WebMCP-native workspace where a person describes business
logic and an agent turns it into an inspectable Mantle service. The agent writes
the contract through structured tools; Mantle validates and runs it; the person
reviews the result in an embedded Admin developer console.

[Try the live Builder](https://webmcp-builder.mantle.tools/)

## Why WebMCP

WebMCP is the Builder's primary product interface. Instead of making an agent
guess its way through visual controls, the host exposes four typed tools:

- `builder_get_started` returns the active project, pinned Mantle contract,
  supported grammar, presets, preview status, and exact next calls.
- `builder_apply_preset` installs an intake, reservation, transaction, or
  procurement Manifest into an empty project.
- `builder_apply_manifest_patch` validates and compiles an RFC 6902 patch,
  rejects stale revisions, and activates only a valid result.
- `builder_call_preview_tool` invokes a public capability projected by the
  service the agent just built.

The starting prompt asks the agent to discuss actors, data, operations,
permissions, and HTTP, MCP, or WebMCP entry points with the user. It must
summarize the proposed model and wait for confirmation before changing the
project.

## Human + agent workflow

1. Choose a starting scenario or Blank and copy its prompt into an agent chat.
2. The agent discovers the Builder's WebMCP tools and proposes a Mantle model.
3. After human approval, the agent applies a preset or complete Manifest patch.
4. The host compiles the candidate and keeps the last valid revision active.
5. Mantle Admin immediately visualizes the resulting data model, logic,
   interfaces, and operational UI.
6. The agent invokes a projected preview tool to verify the workflow.
7. The user downloads a coding-agent handoff for the remaining frontend,
   authentication, provider configuration, and deployment work.

## What is persisted

The Builder stores only project identity, name, Manifest, and update time in
browser IndexedDB. Preview records use an in-memory Mantle adapter and are not
production data. Multiple projects can be switched or deleted independently.

The Admin iframe runs a mock identity and environment supplied by the host. It
is a functional service preview, not a production authentication boundary.

## Handoff

The downloadable ZIP intentionally contains four authored files rather than a
generated application:

- the complete `manifests/site.yaml`
- version-pinned coding-agent instructions
- a frontend WebMCP registration example
- GitHub and Cloudflare deployment guidance

This keeps the Mantle Manifest as the source of truth while allowing a coding
agent to finish the consumer-owned frontend and infrastructure choices.

## Architecture

- React 19, TypeScript, Vite, Tailwind CSS 4, and shadcn/ui
- Mantle `0.1.0-alpha.15` Spec, Runtime, Web, Admin, and Admin UI packages
- Cloudflare Workers Static Assets with the official Vite plugin
- Hono-based in-browser preview runtime
- IndexedDB project persistence
- Same-origin iframe and constrained `postMessage` Admin bridge

The iframe contains trusted, same-origin Mantle Admin code and is not a
security boundary from the Builder host. Admin document routes are served by
the Worker ahead of the host SPA fallback; Admin API calls are bridged to the
current in-browser preview runtime.

## Run locally

Use Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in ChatGPT's in-app browser, or use Chrome
149+ with WebMCP testing enabled.

## Verify

```bash
npm run check
npx wrangler deploy --dry-run
```

`npm run check` runs lint, 22 unit tests, TypeScript compilation, the Mantle
Admin asset sync, and the production build.

## Deploy

The production Worker is configured for Aotter's Cloudflare account and the
`webmcp-builder.mantle.tools` custom domain.

```bash
npm run deploy
```

## WebMCP Challenge scope

The Builder implementation began on September 2, 2026, during The WebMCP
Challenge submission period. The WebMCP authoring flow, Mantle preview,
IndexedDB persistence, coding-agent handoff, browser validation, and Cloudflare
deployment are challenge-period work. Mantle Core is a separately maintained
open-source dependency.

## License

Licensed under the [Apache License 2.0](LICENSE).
