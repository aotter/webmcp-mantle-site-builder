import { bindWebMcp, type WebMcpBinding } from '@aotter/mantle-web/webmcp'
import type { Operation } from 'fast-json-patch'
import { Braces, Cloud, Eye, FileJson2, Hammer, RefreshCw, Sparkles } from 'lucide-react'
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
  const projectRef = useRef(project)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewReadyRef = useRef(false)
  const resyncsRef = useRef(0)
  const pendingRef = useRef(new Map<string, PendingPreviewCall>())

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

  const applyValidPatch = () => {
    const title = projectRef.current.draftDocument.views.inventory.spec.title
    commitPatch(projectRef.current.draftRevision, [{
      op: 'replace',
      path: '/views/inventory/spec/title',
      value: title === 'Available stock' ? 'Inventory' : 'Available stock',
    }])
  }

  const applyInvalidDraft = () => commitPatch(projectRef.current.draftRevision, [
    { op: 'replace', path: '/schemas/inventory-items/spec/title', value: 'Stock ledger' },
    { op: 'replace', path: '/triggers/create-inventory-item-mcp/spec/target/procedure', value: 'missing-procedure' },
  ])

  const repairDraft = () => commitPatch(projectRef.current.draftRevision, [{
    op: 'replace',
    path: '/triggers/create-inventory-item-mcp/spec/target/procedure',
    value: 'create-inventory-item',
  }])

  const testResync = () => postToPreview({
    type: 'mantle:preview:patch',
    baseRevision: project.activeRevision + 99,
    revision: project.activeRevision + 100,
    patch: [{ op: 'replace', path: '/views/inventory/spec/title', value: 'Wrong base' }],
  })

  const callPreview = async () => {
    try {
      const result = await invokePreviewTool('preview_inspect_site', {})
      setPreviewResult(JSON.stringify(result))
    } catch (error) {
      setPreviewResult(error instanceof Error ? error.message : 'Preview tool failed.')
    }
  }

  const summary = projectStateSummary(project)
  const valid = summary.valid

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="flex h-14 items-center gap-3 border-b px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-4" /></div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">WebMCP Mantle Site Builder</p>
          <p className="truncate text-xs text-muted-foreground">Cloudflare competition workspace</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Cloud className="size-4" /> Workers ready
        </div>
      </header>

      <div className="grid min-h-[calc(100svh-3.5rem)] lg:grid-cols-[15rem_minmax(24rem,1fr)_minmax(25rem,0.9fr)]">
        <aside className="border-b bg-muted/25 p-4 lg:border-r lg:border-b-0">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Project</p>
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium"><FileJson2 className="size-4" /> Inventory starter</div>
            <p className="mt-1 text-xs text-muted-foreground">Manifest-backed · public MCP</p>
          </div>
          <div className="mt-6 space-y-2 text-xs">
            {Object.entries(summary.atoms).map(([kind, names]) => (
              <div key={kind} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted">
                <span className="capitalize text-muted-foreground">{kind}</span>
                <span className="font-mono">{names.length}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-xl border bg-card p-3 text-xs">
            <p className="font-medium">Agent interface</p>
            <p className="mt-1 leading-5 text-muted-foreground">{webMcpStatus}</p>
          </div>
        </aside>

        <main className="min-w-0 border-b lg:border-r lg:border-b-0">
          <div className="flex flex-wrap items-center gap-2 border-b p-4">
            <div>
              <div className="flex items-center gap-2"><Braces className="size-4" /><h1 className="text-sm font-semibold">Manifest draft</h1></div>
              <p className="mt-1 text-xs text-muted-foreground">Draft {summary.draftRevision} · Active {summary.activeRevision}</p>
            </div>
            <span className={`ml-auto rounded-full px-2 py-1 text-xs font-medium ${valid ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
              {valid ? 'Compiled' : 'Draft rejected'}
            </span>
          </div>

          <div className="space-y-4 p-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={applyValidPatch}><Hammer /> Apply valid patch</Button>
              <Button variant="outline" onClick={applyInvalidDraft}>Break draft</Button>
              <Button variant="outline" disabled={valid} onClick={repairDraft}>Repair draft</Button>
              <Button variant="ghost" onClick={testResync}><RefreshCw /> Test resync</Button>
            </div>
            <div className={`rounded-xl border p-3 text-sm ${valid ? 'bg-card' : 'border-destructive/30 bg-destructive/5'}`}>
              {valid ? 'Mantle parser, linker, and RuntimePlan compiler passed.' : project.diagnostics.join(' ')}
            </div>
            <pre className="max-h-[calc(100svh-15rem)] overflow-auto rounded-xl border bg-neutral-950 p-4 text-xs leading-5 text-neutral-200 shadow-inner">
              <code>{projectDocumentYaml(project.draftDocument)}</code>
            </pre>
          </div>
        </main>

        <section className="min-w-0 bg-muted/20 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2"><Eye className="size-4" /><h2 className="text-sm font-semibold">Live preview</h2></div>
            <span className="ml-auto text-xs text-muted-foreground">{previewReady ? previewStatus : 'Connecting…'}</span>
          </div>
          <iframe
            ref={iframeRef}
            src="/preview"
            title="Generated Mantle site preview"
            allow="tools"
            onLoad={markPreviewReady}
            className="h-[34rem] w-full rounded-xl border bg-white shadow-sm lg:h-[calc(100svh-10rem)]"
          />
          <div className="mt-3 flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!previewReady} onClick={callPreview}>Call preview WebMCP</Button>
            <p className="min-w-0 truncate text-xs text-muted-foreground">{previewResult}</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function isMessage(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
