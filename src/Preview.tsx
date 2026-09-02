import { bindWebMcp, type WebMcpBinding } from '@aotter/mantle-web/webmcp'
import { useEffect, useRef, useState } from 'react'

import { applyPreviewSync, emptyPreviewState, type PreviewState } from '@/lib/project'
import { publicViewCapability } from '@/lib/webmcp'

const previewCapabilities = [
  publicViewCapability('preview_inspect_site', 'Inspect the active Mantle generated-site preview.'),
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
  if (!preview.plan || Object.keys(preview.plan.views).length === 0) return <div className="min-h-svh bg-white" />

  return (
    <div className="min-h-svh bg-white text-neutral-950">
      <main className="mx-auto max-w-5xl px-5 py-8">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">Mantle generated</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          </div>
          <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Active revision {preview.revision}</span>
        </div>
        <div className="mt-6 rounded-xl border border-dashed bg-neutral-50 p-8 text-center text-sm text-neutral-500">This generated view has no records yet.</div>
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
  const value = preview.document ? Object.values(preview.document.views)[0]?.spec.title : undefined
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return Object.values(value)[0] ?? 'Inventory'
  return 'Untitled view'
}

function isMessage(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
