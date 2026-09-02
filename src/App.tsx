import { bindWebMcp, type WebMcpBinding } from '@aotter/mantle-web/webmcp'
import type { Operation } from 'fast-json-patch'
import { Bot, Braces, Check, ChevronDown, Copy, FileJson2, Monitor, Moon, Plus, Smartphone, Sparkles, Sun, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import {
  createProjectRecord,
  listProjects,
  removeProject,
  saveProject,
  selectedProjectId,
  selectProjectId,
  type ProjectRecord,
} from '@/lib/project-store'
import { publicProcedureCapability, publicViewCapability } from '@/lib/webmcp'
import { createPreviewDeployment, type PreviewDeployment } from '@/lib/preview-deployment'

const promptPresets = [
  { name: 'intake', label: 'Intake', brief: 'Build a public intake flow that collects structured requests and gives staff a review queue.' },
  { name: 'reservation', label: 'Reservation', brief: 'Build a reservation service with public booking, a member-friendly status view, and a staff queue.' },
  { name: 'transaction', label: 'Transaction', brief: 'Build a small catalog and ordering service with public discovery, checkout, and staff order management.' },
  { name: 'procurement', label: 'Procurement', brief: 'Build a procurement workflow where members submit purchase requisitions and staff review them.' },
  { name: 'blank', label: 'Blank', brief: 'Interview me to learn the actors, data, operations, permissions, and entry points this service needs.' },
] as const satisfies readonly { name: StarterName | 'blank'; label: string; brief: string }[]

type PromptType = (typeof promptPresets)[number]['name']
type PreviewViewport = 'desktop' | 'mobile'

const hostCapabilities = [
  publicViewCapability('builder_get_started', 'Call this first. Learn the version-matched Mantle grammar, official docs, starters, current project, and preview tools.'),
  publicProcedureCapability('builder_apply_starter', 'Apply a version-checked Mantle starter pattern as a valid working example before customizing it.', {
    type: 'object',
    properties: {
      starter: { type: 'string', enum: starterNames },
      baseRevision: { type: 'integer', minimum: 1 },
      projectName: { type: 'string', minLength: 1, maxLength: 80, description: 'A concise project name chosen by the agent.' },
      replace: { type: 'boolean', description: 'Must be true to replace a non-empty project.' },
    },
    required: ['starter', 'baseRevision', 'projectName'],
    additionalProperties: false,
  }),
  publicProcedureCapability('builder_apply_manifest_patch', 'Apply an RFC 6902 JSON Patch to the current Mantle Manifest draft.', {
    type: 'object',
    properties: {
      baseRevision: { type: 'integer', minimum: 1 },
      projectName: { type: 'string', minLength: 1, maxLength: 80, description: 'The current concise project name, chosen by the agent.' },
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
    required: ['baseRevision', 'projectName', 'patch'],
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

export default function App() {
  const [currentProject, setCurrentProject] = useState(createProjectRecord)
  const [projects, setProjects] = useState<ProjectRecord[]>(() => [currentProject])
  const [project, setProject] = useState(() => createProjectState(initialProjectDocument))
  const [projectsReady, setProjectsReady] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectRecord | null>(null)
  const [webMcpSupported, setWebMcpSupported] = useState<boolean | null>(null)
  const [promptType, setPromptType] = useState<PromptType>('intake')
  const [brief, setBrief] = useState<string>(promptPresets[0].brief)
  const [promptCopied, setPromptCopied] = useState(false)
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'))
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport>(() => new URLSearchParams(location.search).get('viewport') === 'mobile' ? 'mobile' : 'desktop')
  const currentProjectRef = useRef(currentProject)
  const projectRef = useRef(project)
  const adminIframeRef = useRef<HTMLIFrameElement>(null)
  const buildDialogRef = useRef<HTMLDialogElement>(null)
  const previewDeploymentRef = useRef<Promise<PreviewDeployment> | null>(null)
  const mutationReplayRef = useRef<{ key: string; revision: number; response: unknown } | undefined>(undefined)
  const closeMenus = useCallback(() => {
    document.querySelectorAll<HTMLDetailsElement>('[data-toolbar-menu][open]').forEach((menu) => { menu.open = false })
  }, [])

  const syncUiFromUrl = useCallback(() => {
    const search = new URLSearchParams(location.search)
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

  const toggleTheme = () => {
    const next = !darkMode
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('mantle-builder-theme', next ? 'dark' : 'light')
    setDarkMode(next)
  }

  const installPreviewDeployment = useCallback((state: ReturnType<typeof createProjectState>, record: ProjectRecord) => {
    const deployment = createPreviewDeployment(state.activePlan, { id: record.id, name: record.name }, location.origin)
    previewDeploymentRef.current = deployment
    void deployment.catch((error) => console.error('Sandbox deployment failed.', error))
  }, [])

  const activateProject = useCallback((record: ProjectRecord) => {
    const state = createProjectState(record.manifest)
    currentProjectRef.current = record
    projectRef.current = state
    installPreviewDeployment(state, record)
    setCurrentProject(record)
    setProject(state)
    selectProjectId(record.id)
    mutationReplayRef.current = undefined
  }, [installPreviewDeployment])

  useEffect(() => {
    let cancelled = false
    void listProjects().then(async (stored) => {
      const available = stored.length > 0 ? stored : [currentProjectRef.current]
      if (stored.length === 0) await saveProject(available[0]!)
      if (cancelled) return
      const selected = available.find(({ id }) => id === selectedProjectId()) ?? available[0]!
      setProjects(available)
      activateProject(selected)
      setProjectsReady(true)
    }).catch((error) => {
      if (cancelled) return
      setStorageError(error instanceof Error ? error.message : String(error))
      setProjectsReady(true)
    })
    return () => { cancelled = true }
  }, [activateProject])

  const persistActiveProject = useCallback(async (state: ReturnType<typeof createProjectState>, name: string) => {
    const record: ProjectRecord = {
      ...currentProjectRef.current,
      name,
      manifest: structuredClone(state.activeDocument),
      updatedAt: Date.now(),
    }
    try {
      await saveProject(record)
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error))
      throw error
    }
    currentProjectRef.current = record
    setCurrentProject(record)
    setProjects((current) => [record, ...current.filter(({ id }) => id !== record.id)].sort((left, right) => right.updatedAt - left.updatedAt))
    setStorageError('')
  }, [])

  const commitPatch = useCallback(async (baseRevision: number, patch: readonly Operation[], projectName: string) => {
    const result = applyProjectPatch(projectRef.current, baseRevision, patch)
    if (result.activated) await persistActiveProject(result.state, projectName)
    projectRef.current = result.state
    if (result.activated) installPreviewDeployment(result.state, currentProjectRef.current)
    setProject(result.state)
    return {
      ...projectStateSummary(result.state),
      activated: result.activated,
      project: { id: currentProjectRef.current.id, name: currentProjectRef.current.name },
    }
  }, [installPreviewDeployment, persistActiveProject])

  const runMutation = useCallback(async (key: string, mutate: () => Promise<unknown>) => {
    const replay = mutationReplayRef.current
    if (replay?.key === key && replay.revision === projectRef.current.draftRevision) return replay.response
    const response = await mutate()
    mutationReplayRef.current = { key, revision: projectRef.current.draftRevision, response }
    return response
  }, [])

  const createNewProject = useCallback(async () => {
    try {
      const record = createProjectRecord()
      await saveProject(record)
      setProjects((current) => [record, ...current])
      setStorageError('')
      activateProject(record)
      closeMenus()
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error))
    }
  }, [activateProject, closeMenus])

  const deleteProject = useCallback(async (record: ProjectRecord) => {
    try {
      let remaining = projects.filter(({ id }) => id !== record.id)
      if (remaining.length === 0) {
        const replacement = createProjectRecord()
        await saveProject(replacement)
        remaining = [replacement]
      }
      await removeProject(record.id)
      setProjects(remaining)
      setStorageError('')
      if (record.id === currentProjectRef.current.id) activateProject(remaining[0]!)
      closeMenus()
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error))
    }
  }, [activateProject, closeMenus, projects])

  const invokePreviewTool = useCallback(async (name: string, input: Record<string, unknown>, signal?: AbortSignal) => {
    const deployment = previewDeploymentRef.current
    if (!deployment) throw new Error('Sandbox runtime is not ready.')
    return (await deployment).invoke(name, input, signal)
  }, [])

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== adminIframeRef.current?.contentWindow || !isHostApiMessage(event.data)) return
      const port = event.ports[0]
      if (!port) return
      try {
        const deployment = previewDeploymentRef.current
        if (!deployment) throw new Error('Sandbox runtime is not ready.')
        const response = await (await deployment).fetch(readHostApiRequest(event.data.request))
        const body = await response.arrayBuffer()
        port.postMessage({ ok: true, status: response.status, headers: [...response.headers], body }, [body])
      } catch (error) {
        port.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Admin API request failed.' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!projectsReady) return
    let binding: WebMcpBinding | undefined
    let disposed = false
    void bindWebMcp({
      capabilities: hostCapabilities,
      invoke: async (capability, input, signal) => {
        if (capability.name === 'builder_get_started') {
          const deployment = previewDeploymentRef.current
          if (deployment) await deployment
          const reference = await fetch('/_mantle/design-atoms.md', { signal })
          if (!reference.ok) throw new Error('Mantle Manifest reference is unavailable.')
          return getStarted(
            projectRef.current,
            { ready: deployment !== null, revision: projectRef.current.activeRevision },
            await reference.text(),
            { id: currentProjectRef.current.id, name: currentProjectRef.current.name },
          )
        }
        if (capability.name === 'builder_apply_starter') {
          if (typeof input.starter !== 'string' || !starterNames.includes(input.starter as StarterName)) throw new TypeError('Choose a starter returned by builder_get_started.')
          if (!Number.isInteger(input.baseRevision)) throw new TypeError('baseRevision must be an integer.')
          const projectName = readProjectName(input.projectName)
          return runMutation(`${capability.name}:${JSON.stringify(input)}`, async () => {
            const result = applyStarter(projectRef.current, input.starter as StarterName, Number(input.baseRevision), input.replace === true)
            if (result.activated) await persistActiveProject(result.state, projectName)
            projectRef.current = result.state
            if (result.activated) installPreviewDeployment(result.state, currentProjectRef.current)
            setProject(result.state)
            return {
              ...result.response,
              project: { id: currentProjectRef.current.id, name: currentProjectRef.current.name },
            }
          })
        }
        if (capability.name === 'builder_apply_manifest_patch') {
          if (!Number.isInteger(input.baseRevision)) throw new TypeError('baseRevision must be an integer.')
          const projectName = readProjectName(input.projectName)
          return runMutation(`${capability.name}:${JSON.stringify(input)}`, () => commitPatch(Number(input.baseRevision), readPatch(input.patch), projectName))
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
  }, [commitPatch, installPreviewDeployment, invokePreviewTool, persistActiveProject, projectsReady, runMutation])

  const copyStartingPrompt = async () => {
    const prompt = promptType === 'blank'
      ? `Use the WebMCP tools on this page to design a Mantle service with me.\n\n1. Call builder_get_started first to learn the current Mantle grammar and project state.\n2. Interview me about its actors, data, operations, permissions, and HTTP, MCP, or WebMCP entry points.\n3. Summarize the proposed Schema, View, Procedure, and Trigger model and wait for my confirmation.\n4. Do not call builder_apply_starter. After confirmation, choose a concise projectName and create the complete model from the empty document in one builder_apply_manifest_patch call.\n5. Repair validation errors using that projectName, the returned draftRevision, and diagnostics; then test a public capability with builder_call_preview_tool.\n\nStarting context:\n${brief.trim()}`
      : `Use the WebMCP tools on this page to build the service below.\n\n1. Call builder_get_started first.\n2. Choose a concise projectName, then call builder_apply_starter with it, starter "${promptType}", and the returned project draftRevision so the host loads its premade Manifest. Do not recreate the starter.\n3. Learn from the returned Manifest, then customize it with builder_apply_manifest_patch using the same projectName.\n4. Repair validation errors with the returned draftRevision and diagnostics.\n5. Test a projected public capability with builder_call_preview_tool.\n\nService brief:\n${brief.trim()}`
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
            <FileJson2 className="size-4" /> <span className="max-w-48 truncate">{currentProject.name}</span> <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute left-0 top-10 z-60 w-72 rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl">
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {projects.map((record) => (
                <div key={record.id} className={`flex items-center rounded-lg ${record.id === currentProject.id ? 'bg-muted' : ''}`}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                    onClick={() => { activateProject(record); closeMenus() }}
                  >
                    <span className="block truncate text-sm font-medium">{record.name}</span>
                    <span className="block text-xs text-muted-foreground">{new Date(record.updatedAt).toLocaleString()}</span>
                  </button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleteCandidate(record)} aria-label={`Delete ${record.name}`} title={`Delete ${record.name}`}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2 w-full" disabled={!projectsReady} onClick={() => void createNewProject()}>
              <Plus /> New project
            </Button>
            {storageError && <p className="mt-2 px-1 text-xs text-destructive">Autosave unavailable: {storageError}</p>}
          </div>
        </details>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label={darkMode ? 'Use light theme' : 'Use dark theme'} title={darkMode ? 'Use light theme' : 'Use dark theme'}>
            {darkMode ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <div className="toolbar-menu-backdrop fixed inset-x-0 bottom-0 top-14 z-40" aria-hidden="true" />

      <main className="fixed inset-x-0 bottom-0 top-14 z-10 flex min-w-0">
        <section className={`relative min-w-0 flex-1 ${hasProject ? 'flex flex-col bg-muted/35' : 'bg-transparent'}`}>
          {hasProject && <div className="min-h-0 flex-1 overflow-auto bg-muted/35 p-2 sm:p-3">
            <div className={`mx-auto flex h-full flex-col overflow-hidden rounded-2xl border border-primary/35 bg-secondary p-1.5 text-secondary-foreground shadow-2xl shadow-primary/10 transition-[width] duration-200 motion-reduce:transition-none ${previewViewport === 'mobile' ? 'w-[min(402px,100%)]' : 'w-full'}`}>
              <div className="flex h-9 shrink-0 items-center gap-2 px-2">
                <span className="text-xs font-semibold">Preview</span>
                <span className="text-xs text-muted-foreground">Admin</span>
                <div className="ml-auto flex items-center rounded-lg bg-background/35 p-0.5" role="group" aria-label="Preview viewport">
                  <Button variant="ghost" size="sm" className={previewViewport === 'desktop' ? 'bg-background text-foreground shadow-sm hover:bg-background' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'} aria-pressed={previewViewport === 'desktop'} onClick={() => setPreviewViewport('desktop')}>
                  <Monitor /> <span className="hidden sm:inline">Desktop</span>
                  </Button>
                  <Button variant="ghost" size="sm" className={previewViewport === 'mobile' ? 'bg-background text-foreground shadow-sm hover:bg-background' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'} aria-pressed={previewViewport === 'mobile'} onClick={() => setPreviewViewport('mobile')}>
                  <Smartphone /> <span className="hidden sm:inline">Mobile</span>
                  </Button>
                </div>
              </div>
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-background">
                <iframe
                  key={`${currentProject.id}:${project.activeRevision}`}
                  ref={adminIframeRef}
                  src="/_mantle/admin/index.html"
                  title="Mantle Admin preview"
                  className="absolute inset-0 h-full w-full border-0 bg-background"
                />
              </div>
            </div>
          </div>}
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
        </section>
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

      <AlertDialog open={deleteCandidate !== null} onOpenChange={(open) => { if (!open) setDeleteCandidate(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteCandidate?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the saved Manifest from this browser. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteCandidate) void deleteProject(deleteCandidate) }}>Delete project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

interface HostApiMessage {
  protocolVersion: 1
  type: 'mantle:host-api:request'
  request: {
    url: string
    method: string
    headers: [string, string][]
    body: ArrayBuffer | null
  }
}

function isHostApiMessage(value: unknown): value is HostApiMessage {
  if (!isMessage(value) || value.protocolVersion !== 1 || value.type !== 'mantle:host-api:request' || !isMessage(value.request)) return false
  const request = value.request
  return typeof request.url === 'string'
    && typeof request.method === 'string'
    && Array.isArray(request.headers)
    && request.headers.every((header) => Array.isArray(header) && header.length === 2 && header.every((part) => typeof part === 'string'))
    && (request.body === null || request.body instanceof ArrayBuffer)
}

function readHostApiRequest(request: HostApiMessage['request']): Request {
  const url = new URL(request.url)
  if (url.origin !== location.origin || (!url.pathname.startsWith('/admin/api/') && !url.pathname.startsWith('/api/auth/'))) {
    throw new TypeError('Admin iframe requested an unsupported host route.')
  }
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body } : {}),
  })
}

function readProjectName(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('projectName must be a string.')
  const name = value.trim()
  if (name.length === 0 || name.length > 80) throw new TypeError('projectName must be between 1 and 80 characters.')
  return name
}
