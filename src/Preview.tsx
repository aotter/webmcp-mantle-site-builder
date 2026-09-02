import { bindWebMcp, type WebMcpBinding } from '@aotter/mantle-web/webmcp'
import { Boxes, Search, ShoppingCart } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { applyPreviewSync, emptyPreviewState, type PreviewState } from '@/lib/project'
import { publicViewCapability } from '@/lib/webmcp'

const previewCapabilities = [
  publicViewCapability('preview_inspect_site', 'Inspect the active Mantle generated-site preview.'),
]

const sampleItems = [
  { sku: 'CAM-01', name: 'Field camera', quantity: 12 },
  { sku: 'MIC-04', name: 'Studio microphone', quantity: 7 },
  { sku: 'LGT-02', name: 'Panel light', quantity: 18 },
]

export default function Preview() {
  const [preview, setPreview] = useState<PreviewState>(() => emptyPreviewState())
  const [webMcpStatus, setWebMcpStatus] = useState('Registering preview tool…')
  const [calls, setCalls] = useState(0)
  const previewRef = useRef(preview)
  const callsRef = useRef(0)

  useEffect(() => {
    let binding: WebMcpBinding | undefined
    let disposed = false
    void bindWebMcp({
      capabilities: previewCapabilities,
      invoke: async (capability) => {
        const nextCalls = ++callsRef.current
        setCalls(nextCalls)
        return {
          document: 'preview',
          capability: capability.name,
          revision: previewRef.current.revision,
          viewTitle: viewTitle(previewRef.current),
          calls: nextCalls,
          ok: true,
        }
      },
    }).then((result) => {
      if (disposed) return result.dispose()
      binding = result
      setWebMcpStatus(result.supported ? 'Preview WebMCP ready' : 'Host proxy active')
    }).catch((error: unknown) => setWebMcpStatus(String(error)))
    return () => {
      disposed = true
      binding?.dispose()
    }
  }, [])

  useEffect(() => {
    const send = (message: Record<string, unknown>) => parent.postMessage({ protocolVersion: 1, ...message }, location.origin)
    const invoke = async (request: Record<string, unknown>) => {
      try {
        if (request.name !== 'preview_inspect_site') throw new Error(`Unknown preview tool '${String(request.name)}'.`)
        const nextCalls = ++callsRef.current
        setCalls(nextCalls)
        send({
          type: 'mantle:preview:result',
          requestId: request.requestId,
          ok: true,
          result: {
            document: 'preview',
            capability: request.name,
            revision: previewRef.current.revision,
            viewTitle: viewTitle(previewRef.current),
            calls: nextCalls,
          },
        })
      } catch (error) {
        send({
          type: 'mantle:preview:result',
          requestId: request.requestId,
          ok: false,
          error: error instanceof Error ? error.message : 'Preview tool failed.',
        })
      }
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== parent || !isMessage(event.data)) return
      const request = event.data
      if (request.protocolVersion !== 1) return
      if (request.type === 'mantle:preview:invoke') {
        void invoke(request)
        return
      }
      if (request.type !== 'mantle:preview:snapshot' && request.type !== 'mantle:preview:patch') return
      try {
        const result = applyPreviewSync(previewRef.current, request)
        if (result.kind === 'resync') {
          send({ type: 'mantle:preview:resync', expectedRevision: result.expectedRevision, receivedRevision: result.receivedRevision })
        } else if (result.kind === 'error') {
          send({ type: 'mantle:preview:error', diagnostics: result.diagnostics })
        } else if (result.kind === 'applied') {
          previewRef.current = result.state
          setPreview(result.state)
          send({ type: 'mantle:preview:applied', revision: result.state.revision })
        }
      } catch (error) {
        send({ type: 'mantle:preview:error', diagnostics: [error instanceof Error ? error.message : 'Preview sync failed.'] })
      }
    }
    window.addEventListener('message', onMessage)
    send({ type: 'mantle:preview:ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const title = viewTitle(preview)

  return (
    <div className="min-h-svh bg-white text-neutral-950">
      <header className="flex h-14 items-center border-b px-5">
        <div className="flex items-center gap-2 font-semibold"><Boxes className="size-5" /> Northstar Supply</div>
        <nav className="ml-auto flex items-center gap-4 text-sm text-neutral-600"><span>Catalog</span><span>About</span><ShoppingCart className="size-4" /></nav>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">Mantle generated</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          </div>
          <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Active revision {preview.revision}</span>
        </div>
        <div className="mt-6 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-neutral-500"><Search className="size-4" /> Search inventory</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {sampleItems.map((item) => (
            <article key={item.sku} className="rounded-xl border bg-neutral-50 p-4">
              <p className="font-mono text-xs text-neutral-500">{item.sku}</p>
              <h2 className="mt-3 font-medium">{item.name}</h2>
              <p className="mt-1 text-sm text-neutral-600">{item.quantity} in stock</p>
            </article>
          ))}
        </div>
        <footer className="mt-8 flex flex-wrap gap-3 border-t pt-4 text-xs text-neutral-500">
          <span>{preview.plan ? 'Mantle RuntimePlan compiled' : 'Waiting for Manifest snapshot'}</span>
          <span>·</span>
          <span>{webMcpStatus}</span>
          <span>·</span>
          <span>{calls} tool calls</span>
        </footer>
      </main>
    </div>
  )
}

function viewTitle(preview: PreviewState) {
  const value = preview.document?.views.inventory.spec.title
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return Object.values(value)[0] ?? 'Inventory'
  return 'Loading preview…'
}

function isMessage(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
