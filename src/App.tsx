import { bindWebMcp, type WebMcpBinding } from '@aotter/mantle-web/webmcp'
import type { Operation } from 'fast-json-patch'
import { Bot, Braces, Check, ChevronDown, Copy, FileJson2, Moon, PanelRightClose, PanelRightOpen, Sparkles, Sun, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  applyProjectPatch,
  createProjectState,
  initialProjectDocument,
  projectDocumentYaml,
  projectStateSummary,
  readPatch,
} from '@/lib/project'
import { applyStarter, getStarted, starterNames, type StarterName } from '@/lib/builder'
import { publicProcedureCapability, publicViewCapability } from '@/lib/webmcp'

const promptPresets = [
  { name: 'intake', label: 'Intake', brief: 'Build a public intake flow that collects structured requests and gives staff a review queue.' },
  { name: 'reservation', label: 'Reservation', brief: 'Build a reservation service with public booking, a member-friendly status view, and a staff queue.' },
  { name: 'transaction', label: 'Transaction', brief: 'Build a small catalog and ordering service with public discovery, checkout, and staff order management.' },
  { name: 'procurement', label: 'Procurement', brief: 'Build a procurement workflow where members submit purchase requisitions and staff review them.' },
  { name: 'blank', label: 'Blank', brief: 'Interview me to learn the actors, data, operations, permissions, and entry points this service needs.' },
] as const satisfies readonly { name: StarterName | 'blank'; label: string; brief: string }[]

type PromptType = (typeof promptPresets)[number]['name']

const hostCapabilities = [
  publicViewCapability('builder_get_started', 'Call this first. Learn the version-matched Mantle grammar, official docs, starters, current project, and preview tools.'),
  publicProcedureCapability('builder_apply_starter', 'Apply a version-checked Mantle starter pattern as a valid working example before customizing it.', {
    type: 'object',
    properties: {
      starter: { type: 'string', enum: starterNames },
      baseRevision: { type: 'integer', minimum: 1 },
      replace: { type: 'boolean', description: 'Must be true to replace a non-empty project.' },
    },
    required: ['starter', 'baseRevision'],
    additionalProperties: false,
  }),
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
  const [previewStatus, setPreviewStatus] = useState('Waiting for preview…')
  const [previewReady, setPreviewReady] = useState(false)
  const [webMcpSupported, setWebMcpSupported] = useState<boolean | null>(null)
  const [promptType, setPromptType] = useState<PromptType>('intake')
  const [brief, setBrief] = useState<string>(promptPresets[0].brief)
  const [promptCopied, setPromptCopied] = useState(false)
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'))
  const [consolePinned, setConsolePinned] = useState(() => new URLSearchParams(location.search).has('console'))
  const projectRef = useRef(project)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const buildDialogRef = useRef<HTMLDialogElement>(null)
  const previewReadyRef = useRef(false)
  const previewRevisionRef = useRef(0)
  const resyncsRef = useRef(0)
  const pendingRef = useRef(new Map<string, PendingPreviewCall>())
  const mutationReplayRef = useRef<{ key: string; revision: number; response: unknown } | undefined>(undefined)
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

  const toggleTheme = () => {
    const next = !darkMode
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('mantle-builder-theme', next ? 'dark' : 'light')
    setDarkMode(next)
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

  const runMutation = useCallback((key: string, mutate: () => unknown) => {
    const replay = mutationReplayRef.current
    if (replay?.key === key && replay.revision === projectRef.current.draftRevision) return replay.response
    const response = mutate()
    mutationReplayRef.current = { key, revision: projectRef.current.draftRevision, response }
    return response
  }, [])

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
        previewRevisionRef.current = Number(message.revision)
        setPreviewStatus(`Preview active at revision ${message.revision}. Resyncs: ${resyncsRef.current}.`)
        return
      }
      if (message.type === 'mantle:preview:error' && Array.isArray(message.diagnostics)) {
        setPreviewStatus(`Preview rejected sync: ${message.diagnostics.map(diagnosticMessage).join(' ')}`)
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
        if (capability.name === 'builder_get_started') {
          return getStarted(projectRef.current, { ready: previewReadyRef.current, revision: previewRevisionRef.current })
        }
        if (capability.name === 'builder_apply_starter') {
          if (typeof input.starter !== 'string' || !starterNames.includes(input.starter as StarterName)) throw new TypeError('Choose a starter returned by builder_get_started.')
          if (!Number.isInteger(input.baseRevision)) throw new TypeError('baseRevision must be an integer.')
          return runMutation(`${capability.name}:${JSON.stringify(input)}`, () => {
            const result = applyStarter(projectRef.current, input.starter as StarterName, Number(input.baseRevision), input.replace === true)
            projectRef.current = result.state
            setProject(result.state)
            if (result.activated && previewReadyRef.current) postToPreview({ type: 'mantle:preview:patch', ...result.activation })
            return result.response
          })
        }
        if (capability.name === 'builder_apply_manifest_patch') {
          if (!Number.isInteger(input.baseRevision)) throw new TypeError('baseRevision must be an integer.')
          return runMutation(`${capability.name}:${JSON.stringify(input)}`, () => commitPatch(Number(input.baseRevision), readPatch(input.patch)))
        }
        if (capability.name === 'builder_call_preview_tool') {
          if (typeof input.name !== 'string' || !isMessage(input.input)) throw new TypeError('Preview tool name and input are required.')
          return invokePreviewTool(input.name, input.input, signal)
        }
        throw new Error(`Unknown builder tool '${capability.name}'.`)
      },
    }).then((result) => {
      if (disposed) return result.dispose()
      binding = result
      setWebMcpSupported(result.supported)
    }).catch(() => setWebMcpSupported(false))
    return () => {
      disposed = true
      binding?.dispose()
    }
  }, [commitPatch, invokePreviewTool, postToPreview, runMutation])

  const copyStartingPrompt = async () => {
    const prompt = promptType === 'blank'
      ? `Use the WebMCP tools on this page to design a Mantle service with me.\n\n1. Call builder_get_started first to learn the current Mantle grammar and project state.\n2. Before changing the project, interview me about its actors, data, operations, permissions, and HTTP, MCP, or WebMCP entry points.\n3. Summarize the proposed Schema, View, Procedure, and Trigger model and wait for my confirmation.\n4. After confirmation, use the closest starter if helpful, then customize with builder_apply_manifest_patch.\n5. Repair validation errors from the returned diagnostics and test a public capability with builder_call_preview_tool.\n\nStarting context:\n${brief.trim()}`
      : `Use the WebMCP tools on this page to build the service below.\n\n1. Call builder_get_started first.\n2. Call builder_apply_starter with starter "${promptType}" and the returned project draftRevision so the host loads its premade Manifest. Do not recreate the starter.\n3. Learn from the returned Manifest, then customize it with builder_apply_manifest_patch.\n4. Repair validation errors with the returned draftRevision and diagnostics.\n5. Test a projected public capability with builder_call_preview_tool.\n\nService brief:\n${brief.trim()}`
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
    <div className="relative h-svh overflow-hidden bg-background text-foreground">
      <canvas className="night-tide" aria-hidden="true" />
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b bg-background/55 px-3 shadow-sm backdrop-blur-2xl sm:px-4">
        <img src="/mantle-mark.svg" alt="" className="mantle-mark size-7 shrink-0" />
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
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label={darkMode ? 'Use light theme' : 'Use dark theme'} title={darkMode ? 'Use light theme' : 'Use dark theme'}>
            {darkMode ? <Sun /> : <Moon />}
          </Button>
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

      <main className="fixed inset-x-0 bottom-0 top-14 z-10 flex min-w-0">
        <section className={`relative min-w-0 flex-1 ${hasProject ? 'bg-white' : 'bg-transparent'}`}>
          <iframe
            ref={iframeRef}
            src="/preview"
            title="Generated Mantle site preview"
            allow="tools"
            onLoad={markPreviewReady}
            className={`absolute inset-0 h-full w-full border-0 bg-white transition-opacity ${hasProject ? 'opacity-100' : 'opacity-0'}`}
          />
          {!hasProject && (
            <div className="absolute inset-0 z-10 grid place-items-center p-5">
              <section className="empty-project-glass w-full max-w-2xl rounded-2xl p-5 sm:p-7">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><Sparkles className="size-4" /> Agent-built · Agent-operated</div>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Describe the workflow. Ship the service.</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground"><a href="https://github.com/aotter/mantle" target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">Mantle</a> turns your business rules into agent-ready services.</p>
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Service outputs">
                  <Badge variant="secondary">Cloudflare-ready</Badge>
                  <Badge variant="secondary">API</Badge>
                  <Badge variant="secondary">MCP</Badge>
                  <Badge variant="secondary">WebMCP</Badge>
                </div>
                <Tabs
                  value={promptType}
                  onValueChange={(value) => {
                    const preset = promptPresets.find(({ name }) => name === value)
                    if (!preset) return
                    setPromptType(preset.name)
                    setBrief(preset.brief)
                    setPromptCopied(false)
                  }}
                  className="mt-5 gap-0 rounded-xl border bg-background/65 shadow-inner backdrop-blur-md"
                >
                  <TabsList className="h-auto w-full overflow-x-auto rounded-none bg-transparent p-1" aria-label="Starting prompt type">
                    {promptPresets.map((preset) => (
                      <TabsTrigger key={preset.name} value={preset.name} className="prompt-tab min-w-fit px-2.5 py-2 text-xs">
                        {preset.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {promptPresets.map((preset) => (
                    <TabsContent key={preset.name} value={preset.name} className="m-0">
                      <textarea
                        value={promptType === preset.name ? brief : preset.brief}
                        onChange={(event) => { setBrief(event.target.value); setPromptCopied(false) }}
                        aria-label={`${preset.label} service brief`}
                        rows={4}
                        className="block w-full resize-y border-0 bg-transparent p-3 text-sm leading-6 outline-none"
                      />
                    </TabsContent>
                  ))}
                </Tabs>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button onClick={copyStartingPrompt} disabled={!brief.trim()}>{promptCopied ? <Check /> : <Copy />}{promptCopied ? 'Copied for agent' : 'Copy agent prompt'}</Button>
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

      {webMcpSupported === false && (
        <section className="fixed inset-x-0 bottom-0 top-14 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-xl" role="alert" aria-live="assertive">
          <div className="empty-project-glass max-w-md rounded-2xl p-7 text-center">
            <Bot className="mx-auto size-7 text-primary" />
            <h1 className="mt-4 text-xl font-semibold">WebMCP is required</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Open this builder in a WebMCP-enabled browser or agent to build and preview a Mantle service.</p>
          </div>
        </section>
      )}

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
            {valid ? 'Mantle parser, linker, and RuntimePlan compiler passed.' : project.diagnostics.map(({ message }) => message).join(' ')}
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

function diagnosticMessage(value: unknown) {
  return isMessage(value) && typeof value.message === 'string' ? value.message : String(value)
}
