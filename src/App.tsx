import { bindWebMcp, type WebMcpBinding } from '@aotter/mantle-web/webmcp'
import type { Operation } from 'fast-json-patch'
import { Bot, Braces, Check, ChevronDown, Copy, FileJson2, PanelRightClose, PanelRightOpen, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  applyProjectPatch,
  createProjectState,
  initialProjectDocument,
  projectDocumentYaml,
  projectStateSummary,
  readPatch,
} from '@/lib/project'
import { publicProcedureCapability, publicViewCapability } from '@/lib/webmcp'

const hostCapabilities = [
  publicViewCapability('builder_inspect_host', 'Inspect the WebMCP Mantle Site Builder revision state.'),
  publicProcedureCapability('builder_apply_manifest_patch', 'Apply an RFC 6902 JSON Patch to the current Mantle Manifest draft.', {
    type: 'object',
    properties: {
      baseRevision: { type: 'integer', minimum: 1 },
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
    required: ['baseRevision', 'patch'],
    additionalProperties: false,
  }),
  publicProcedureCapability('builder_call_preview_tool', 'Call a public WebMCP capability in the active site preview.', {
    type: 'object',
    properties: {
      name: { type: 'string' },
      input: { type: 'object', additionalProperties: true },
    },
    required: ['name', 'input'],
    additionalProperties: false,
  }),
]

interface PendingPreviewCall {
  resolve(value: unknown): void
  reject(reason: unknown): void
}

export default function App() {
  const [project, setProject] = useState(() => createProjectState(initialProjectDocument))
  const [webMcpStatus, setWebMcpStatus] = useState('Registering builder tools…')
  const [previewStatus, setPreviewStatus] = useState('Waiting for preview…')
  const [previewReady, setPreviewReady] = useState(false)
  const [previewResult, setPreviewResult] = useState('Preview tool has not been called.')
  const [brief, setBrief] = useState('Build a member-only equipment checkout site with public catalog browsing, signed-in reservations, staff approvals, inventory tracking, and WebMCP tools for members and staff. Use Mantle built-in handlers only.')
  const [promptCopied, setPromptCopied] = useState(false)
  const [consolePinned, setConsolePinned] = useState(() => new URLSearchParams(location.search).has('console'))
  const projectRef = useRef(project)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const buildDialogRef = useRef<HTMLDialogElement>(null)
  const previewReadyRef = useRef(false)
  const resyncsRef = useRef(0)
  const pendingRef = useRef(new Map<string, PendingPreviewCall>())
  const adminDevUrl = import.meta.env.VITE_MANTLE_ADMIN_URL
  const closeMenus = useCallback(() => {
    document.querySelectorAll<HTMLDetailsElement>('[data-toolbar-menu][open]').forEach((menu) => { menu.open = false })
  }, [])

  const syncUiFromUrl = useCallback(() => {
    const search = new URLSearchParams(location.search)
    setConsolePinned(search.has('console'))
    const dialog = buildDialogRef.current
    if (search.get('tool') === 'build' && !dialog?.open) dialog?.showModal()
    if (search.get('tool') !== 'build' && dialog?.open) dialog.close()
  }, [])

  useEffect(() => {
    if (new URLSearchParams(location.search).get('tool') === 'build') buildDialogRef.current?.showModal()
    window.addEventListener('popstate', syncUiFromUrl)
    return () => window.removeEventListener('popstate', syncUiFromUrl)
  }, [syncUiFromUrl])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-toolbar-menu]')) closeMenus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [closeMenus])

  const openBuild = () => {
    const url = new URL(location.href)
    url.searchParams.set('tool', 'build')
    history.pushState(null, '', url)
    syncUiFromUrl()
  }

  const closeBuild = () => {
    const url = new URL(location.href)
    url.searchParams.delete('tool')
    history.replaceState(null, '', url)
    buildDialogRef.current?.close()
  }

  const toggleConsole = () => {
    const url = new URL(location.href)
    if (consolePinned) url.searchParams.delete('console')
    else url.searchParams.set('console', 'right')
    history.pushState(null, '', url)
    syncUiFromUrl()
  }

  const postToPreview = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ protocolVersion: 1, ...message }, location.origin)
  }, [])

  const sendSnapshot = useCallback(() => {
    if (!previewReadyRef.current) return
    const current = projectRef.current
    postToPreview({
      type: 'mantle:preview:snapshot',
      revision: current.activeRevision,
      document: current.activeDocument,
    })
  }, [postToPreview])

  const markPreviewReady = useCallback(() => {
    if (!previewReadyRef.current) {
      previewReadyRef.current = true
      setPreviewReady(true)
    }
    sendSnapshot()
  }, [sendSnapshot])

  const commitPatch = useCallback((baseRevision: number, patch: readonly Operation[]) => {
    const result = applyProjectPatch(projectRef.current, baseRevision, patch)
    projectRef.current = result.state
    setProject(result.state)
    if (result.activated && previewReadyRef.current) {
      if (result.activation.patch.length === 0) sendSnapshot()
      else postToPreview({ type: 'mantle:preview:patch', ...result.activation })
    }
    return { ...projectStateSummary(result.state), activated: result.activated }
  }, [postToPreview, sendSnapshot])

  const invokePreviewTool = useCallback((name: string, input: Record<string, unknown>, signal?: AbortSignal) => {
    if (!previewReadyRef.current) return Promise.reject(new Error('Preview is not ready.'))
    const requestId = crypto.randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(requestId)
        reject(new Error(`Preview tool '${name}' timed out.`))
      }, 5_000)
      const settle = (callback: (value: unknown) => void, value: unknown) => {
        clearTimeout(timeout)
        pendingRef.current.delete(requestId)
        callback(value)
      }
      pendingRef.current.set(requestId, {
        resolve: (value) => settle(resolve, value),
        reject: (reason) => settle(reject, reason instanceof Error ? reason : new Error(String(reason))),
      })
      signal?.addEventListener('abort', () => settle(reject, signal.reason), { once: true })
      postToPreview({ type: 'mantle:preview:invoke', requestId, name, input })
    })
  }, [postToPreview])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== iframeRef.current?.contentWindow || !isMessage(event.data)) return
      const message = event.data
      if (message.protocolVersion !== 1) return
      if (message.type === 'mantle:preview:ready') return markPreviewReady()
      if (message.type === 'mantle:preview:resync') {
        resyncsRef.current += 1
        sendSnapshot()
        return
      }
      if (message.type === 'mantle:preview:applied' && Number.isInteger(message.revision)) {
        setPreviewStatus(`Preview active at revision ${message.revision}. Resyncs: ${resyncsRef.current}.`)
        return
      }
      if (message.type === 'mantle:preview:error' && Array.isArray(message.diagnostics)) {
        setPreviewStatus(`Preview rejected sync: ${message.diagnostics.join(' ')}`)
        return
      }
      if (message.type !== 'mantle:preview:result' || typeof message.requestId !== 'string') return
      const pending = pendingRef.current.get(message.requestId)
      if (!pending) return
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Preview tool failed.'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [markPreviewReady, sendSnapshot])

  useEffect(() => {
    let binding: WebMcpBinding | undefined
    let disposed = false
    void bindWebMcp({
      capabilities: hostCapabilities,
      invoke: async (capability, input, signal) => {
        if (capability.name === 'builder_apply_manifest_patch') {
          if (!Number.isInteger(input.baseRevision)) throw new TypeError('baseRevision must be an integer.')
          return commitPatch(Number(input.baseRevision), readPatch(input.patch))
        }
        if (capability.name === 'builder_call_preview_tool') {
          if (typeof input.name !== 'string' || !isMessage(input.input)) throw new TypeError('Preview tool name and input are required.')
          return invokePreviewTool(input.name, input.input, signal)
        }
        return projectStateSummary(projectRef.current)
      },
    }).then((result) => {
      if (disposed) return result.dispose()
      binding = result
      setWebMcpStatus(result.supported ? '3 builder WebMCP tools ready' : 'Native WebMCP unavailable')
    }).catch((error: unknown) => setWebMcpStatus(String(error)))
    return () => {
      disposed = true
      binding?.dispose()
    }
  }, [commitPatch, invokePreviewTool])

  const callPreview = async () => {
    try {
      const result = await invokePreviewTool('preview_inspect_site', {})
      setPreviewResult(JSON.stringify(result))
    } catch (error) {
      setPreviewResult(error instanceof Error ? error.message : 'Preview tool failed.')
    }
  }

  const copyStartingPrompt = async () => {
    const prompt = `Use the WebMCP tools exposed by this Mantle Site Builder to build the site below. First call builder_inspect_host, then apply small RFC 6902 patches with builder_apply_manifest_patch. Keep business logic in supported Mantle built-in handlers, preserve the last-known-good revision, and inspect the preview after each activation.\n\nSite brief:\n${brief.trim()}`
    try {
      await navigator.clipboard.writeText(prompt)
      setPromptCopied(true)
    } catch {
      setPromptCopied(false)
    }
  }

  const summary = projectStateSummary(project)
  const valid = summary.valid
  const hasProject = Object.values(summary.atoms).some((names) => names.length > 0)

  return (
    <div className="h-svh overflow-hidden bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-4" /></div>
        <p className="hidden text-sm font-semibold sm:block">Mantle Builder</p>

        <details name="toolbar-menu" data-toolbar-menu className="group relative">
          <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <FileJson2 className="size-4" /> Untitled project <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute left-0 top-10 z-60 w-72 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl">
            <p className="text-sm font-semibold">Untitled project</p>
            <p className="mt-1 text-xs text-muted-foreground">Empty Manifest · ready for an agent</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {Object.entries(summary.atoms).map(([kind, names]) => (
                <div key={kind} className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-2">
                  <span className="capitalize text-muted-foreground">{kind}</span>
                  <span className="font-mono">{names.length}</span>
                </div>
              ))}
            </div>
          </div>
        </details>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={openBuild} aria-label="Open build manifest">
            <Braces /> <span className="hidden sm:inline">Build</span>
            <span className={`size-2 rounded-full ${valid ? 'bg-emerald-500' : 'bg-destructive'}`} />
          </Button>

          <details name="toolbar-menu" data-toolbar-menu className="group relative">
            <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Bot className="size-3.5" /> <span className="hidden sm:inline">Agent</span> <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 top-9 z-60 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-emerald-500" /> Agent interface</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{webMcpStatus}</p>
              <div className="mt-3 space-y-1 rounded-lg bg-muted p-2 font-mono text-[0.7rem] text-muted-foreground">
                <p>builder_inspect_host</p>
                <p>builder_apply_manifest_patch</p>
                <p>builder_call_preview_tool</p>
              </div>
              <Button className="mt-3 w-full" variant="outline" size="sm" disabled={!previewReady} onClick={callPreview}>Call preview WebMCP</Button>
              <p className="mt-2 truncate text-xs text-muted-foreground" title={previewResult}>{previewResult}</p>
            </div>
          </details>

          <Button
            variant={consolePinned ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={toggleConsole}
            aria-label={consolePinned ? 'Unpin developer console' : 'Pin developer console'}
            aria-pressed={consolePinned}
            title={consolePinned ? 'Unpin developer console' : 'Pin developer console'}
          >
            {consolePinned ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </header>

      <div className="toolbar-menu-backdrop fixed inset-x-0 bottom-0 top-14 z-40" aria-hidden="true" />

      <main className="fixed inset-x-0 bottom-0 top-14 flex min-w-0 bg-muted/30">
        <section className="relative min-w-0 flex-1 bg-white">
          <iframe
            ref={iframeRef}
            src="/preview"
            title="Generated Mantle site preview"
            allow="tools"
            onLoad={markPreviewReady}
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
          {!hasProject && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-background/90 p-5 backdrop-blur-sm">
              <section className="w-full max-w-2xl rounded-2xl border bg-card p-5 shadow-xl sm:p-7">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"><Sparkles className="size-4" /> Empty project</div>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">What should Mantle build?</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Describe the site, then copy a ready-to-run instruction into your browser agent.</p>
                <textarea
                  value={brief}
                  onChange={(event) => { setBrief(event.target.value); setPromptCopied(false) }}
                  aria-label="Site brief"
                  rows={5}
                  className="mt-5 w-full resize-y rounded-xl border bg-background p-3 text-sm leading-6 outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/30"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button onClick={copyStartingPrompt} disabled={!brief.trim()}>{promptCopied ? <Check /> : <Copy />}{promptCopied ? 'Copied for agent' : 'Copy starting prompt'}</Button>
                  <span className="text-xs text-muted-foreground">{webMcpStatus}</span>
                </div>
              </section>
            </div>
          )}
          {hasProject && (
            <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-full border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
              {previewReady ? previewStatus : 'Connecting preview…'}
            </div>
          )}
        </section>

        {consolePinned && (
          <aside className="absolute inset-0 z-40 flex min-w-0 flex-col border-l bg-background md:static md:w-[46vw] md:max-w-3xl" aria-label="Mantle Admin Dev Console">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <p className="text-sm font-semibold">Mantle Admin Dev Console</p>
              <span className="ml-auto text-xs text-muted-foreground">/admin/dev</span>
              <Button variant="ghost" size="icon-sm" onClick={toggleConsole} aria-label="Unpin developer console"><X /></Button>
            </div>
            {adminDevUrl ? (
              <iframe className="min-h-0 flex-1 border-0 bg-background" src={adminDevUrl} title="Mantle Admin Dev Console" />
            ) : (
              <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
                <div className="max-w-sm">
                  <PanelRightOpen className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-4 text-sm font-semibold">Developer console is pinned</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Connect the generated site's <code className="rounded bg-muted px-1 py-0.5">/admin/dev</code> URL with <code className="rounded bg-muted px-1 py-0.5">VITE_MANTLE_ADMIN_URL</code>.</p>
                </div>
              </div>
            )}
          </aside>
        )}
      </main>

      <dialog
        ref={buildDialogRef}
        onClose={closeBuild}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-2xl flex-col border-l bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40 open:flex"
        aria-labelledby="build-title"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Braces className="size-4" />
          <div>
            <h1 id="build-title" className="text-sm font-semibold">Manifest build</h1>
            <p className="text-xs text-muted-foreground">Draft {summary.draftRevision} · Active {summary.activeRevision}</p>
          </div>
          <span className={`ml-auto rounded-full px-2 py-1 text-xs font-medium ${valid ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
            {valid ? 'Compiled' : 'Draft rejected'}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={closeBuild} aria-label="Close build panel"><X /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className={`rounded-xl border p-3 text-sm ${valid ? 'bg-card' : 'border-destructive/30 bg-destructive/5'}`} aria-live="polite">
            {valid ? 'Mantle parser, linker, and RuntimePlan compiler passed.' : project.diagnostics.join(' ')}
          </div>
          {hasProject ? (
            <pre className="overflow-auto rounded-xl border bg-neutral-950 p-4 text-xs leading-5 text-neutral-200 shadow-inner">
              <code>{projectDocumentYaml(project.draftDocument)}</code>
            </pre>
          ) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No Manifest atoms yet.</p>}
        </div>
      </dialog>
    </div>
  )
}

function isMessage(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
