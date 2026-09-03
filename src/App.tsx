import { bindWebMcp, type WebMcpBinding } from '@aotter/mantle-web/webmcp'
import type { Operation } from 'fast-json-patch'
import { Bot, Braces, Check, ChevronDown, Copy, Download, FileJson2, Monitor, Moon, Plus, Smartphone, Sparkles, Sun, Trash2, X } from 'lucide-react'
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
import { isTrustedAdminSource, readHostApiRequest } from '@/lib/admin-bridge'
import {
  applyProjectPatch,
  assertActiveTarget,
  createMutationQueue,
  createProjectState,
  initialProjectDocument,
  projectDocumentYaml,
  projectStateSummary,
  readPatch,
  type CandidateResult,
  type ProjectState,
} from '@/lib/project'
import { createProjectHandoff, projectArchiveName } from '@/lib/project-export'
import {
  adminSourceRevision,
  builderCapabilities,
  getStarted,
  mantleVersion,
  presetNames,
  proposePreset,
  publicTools,
  referenceSectionNames,
  runtimeSourceRevision,
  startingPrompt,
  type PresetName,
  type ReferenceSection,
} from '@/lib/builder'
import {
  createProjectRecord,
  listProjects,
  removeProject,
  saveProject,
  selectedProjectId,
  selectProjectId,
  type ProjectRecord,
} from '@/lib/project-store'
import { createPreviewDeployment, previewDeploymentDiagnostics, type PreviewDeployment } from '@/lib/preview-deployment'

const promptPresets = [
  { name: 'intake', label: 'Intake', brief: 'Build a public intake flow that collects structured requests and gives staff a review queue.' },
  { name: 'reservation', label: 'Reservation', brief: 'Build a reservation service with public booking, a member-friendly status view, and a staff queue.' },
  { name: 'transaction', label: 'Transaction', brief: 'Build a small catalog and ordering service with public discovery, checkout, and staff order management.' },
  { name: 'procurement', label: 'Procurement', brief: 'Build a procurement workflow where members submit purchase requisitions and staff review them.' },
  { name: 'blank', label: 'Blank', brief: 'Interview me to learn the actors, data, operations, permissions, and entry points this service needs.' },
] as const satisfies readonly { name: PresetName | 'blank'; label: string; brief: string }[]

type PromptType = (typeof promptPresets)[number]['name']
type PreviewViewport = 'desktop' | 'mobile'

export default function App() {
  const [currentProject, setCurrentProject] = useState(createProjectRecord)
  const [projects, setProjects] = useState<ProjectRecord[]>(() => [currentProject])
  const [project, setProject] = useState(() => createProjectState(initialProjectDocument))
  const [projectsReady, setProjectsReady] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [exportError, setExportError] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectRecord | null>(null)
  const [webMcpSupported, setWebMcpSupported] = useState<boolean | null>(null)
  const [promptType, setPromptType] = useState<PromptType>('intake')
  const [brief, setBrief] = useState<string>(promptPresets[0].brief)
  const [promptCopied, setPromptCopied] = useState(false)
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'))
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport>(() => new URLSearchParams(location.search).get('viewport') === 'mobile' ? 'mobile' : 'desktop')
  const [previewFrameError, setPreviewFrameError] = useState(false)
  const [previewFrameRetry, setPreviewFrameRetry] = useState(0)
  const currentProjectRef = useRef(currentProject)
  const projectRef = useRef(project)
  const adminIframeRef = useRef<HTMLIFrameElement>(null)
  const buildDialogRef = useRef<HTMLDialogElement>(null)
  const previewDeploymentRef = useRef<PreviewDeployment | null>(null)
  const [serializeMutation] = useState(createMutationQueue)
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

  const prepareProject = useCallback(async (record: ProjectRecord) => {
    const state = createProjectState(record.manifest)
    const deployment = await createPreviewDeployment(state.plan, { id: record.id, name: record.name }, location.origin)
    publicTools(state)
    return { record, state, deployment }
  }, [])

  const installProject = useCallback((record: ProjectRecord, state: ProjectState, deployment: PreviewDeployment) => {
    currentProjectRef.current = record
    projectRef.current = state
    previewDeploymentRef.current = deployment
    setCurrentProject(record)
    setProject(state)
    setPreviewFrameError(false)
    selectProjectId(record.id)
  }, [])

  const openProject = useCallback(async (record: ProjectRecord) => {
    try {
      const prepared = await prepareProject(record)
      installProject(prepared.record, prepared.state, prepared.deployment)
      setStorageError('')
      return true
    } catch (error) {
      setStorageError(`Cannot open ${record.name}: ${messageOf(error)}`)
      return false
    }
  }, [installProject, prepareProject])

  useEffect(() => {
    let cancelled = false
    void listProjects().then(async (stored) => {
      if (cancelled) return
      let available = stored.length > 0 ? stored : [currentProjectRef.current]
      setProjects(available)
      // Saved manifests are untrusted: keep every record listed, but only activate one that fully prepares.
      const selected = available.find(({ id }) => id === selectedProjectId())
      const ordered = selected ? [selected, ...available.filter((record) => record !== selected)] : available
      const failures: string[] = []
      let prepared: Awaited<ReturnType<typeof prepareProject>> | undefined
      for (const record of ordered) {
        try {
          prepared = await prepareProject(record)
          break
        } catch (error) {
          failures.push(`${record.name}: ${messageOf(error)}`)
        }
      }
      if (!prepared) {
        const blank = createProjectRecord()
        prepared = await prepareProject(blank)
        available = [blank, ...available]
      }
      if (stored.length === 0 || !stored.some(({ id }) => id === prepared.record.id)) await saveProject(prepared.record)
      if (cancelled) return
      setProjects(available)
      installProject(prepared.record, prepared.state, prepared.deployment)
      if (failures.length > 0) setStorageError(`Skipped saved projects that cannot run in the sandbox — ${failures.join('; ')}`)
      setProjectsReady(true)
    }).catch((error) => {
      if (cancelled) return
      setStorageError(messageOf(error))
      setProjectsReady(true)
    })
    return () => { cancelled = true }
  }, [installProject, prepareProject])

  const persistProject = useCallback(async (target: ProjectRecord, state: ProjectState, name: string) => {
    const record: ProjectRecord = { ...target, name, manifest: structuredClone(state.document), updatedAt: Date.now() }
    try {
      await saveProject(record)
    } catch (error) {
      setStorageError(messageOf(error))
      throw error
    }
    setProjects((current) => [record, ...current.filter(({ id }) => id !== record.id)].sort((left, right) => right.updatedAt - left.updatedAt))
    setStorageError('')
    return record
  }, [])

  const commitCandidate = useCallback(async (result: CandidateResult, projectName: string) => {
    // Capture the target: the user may switch projects while the save is pending.
    const target = currentProjectRef.current
    if (!result.ok) {
      return {
        valid: false,
        activated: false,
        currentRevision: result.currentRevision,
        diagnostics: result.diagnostics,
        project: { id: target.id, name: target.name },
      }
    }
    const state: ProjectState = { ...result.candidate, revision: result.nextRevision }

    // A compiled Manifest can still fail to boot. Prove the preview first, then persist.
    let deployment: PreviewDeployment
    try {
      deployment = await createPreviewDeployment(state.plan, { id: target.id, name: projectName }, location.origin)
      publicTools(state)
    } catch (error) {
      return {
        valid: true,
        activated: false,
        // The candidate's own base revision — projectRef may point at another project after the await.
        currentRevision: result.nextRevision - 1,
        diagnostics: previewDeploymentDiagnostics(error),
        project: { id: target.id, name: target.name },
      }
    }

    // The user may switch or delete the project while deployment preparation is pending.
    assertActiveTarget(
      { id: currentProjectRef.current.id, revision: projectRef.current.revision },
      { projectId: target.id, baseRevision: result.nextRevision - 1 },
    )
    const record = await persistProject(target, state, projectName)
    // If the user selected another project mid-save, the list is updated but the active project stays put.
    const stillActive = currentProjectRef.current.id === target.id
    if (stillActive) {
      installProject(record, state, deployment)
    }
    return {
      ...projectStateSummary(state),
      activated: true,
      active: stillActive,
      project: { id: record.id, name: record.name },
      document: state.document,
      manifestYaml: projectDocumentYaml(state.document),
      previewTools: publicTools(state),
    }
  }, [installProject, persistProject])

  const commitPatch = useCallback((baseRevision: number, patch: readonly Operation[], projectName: string) => (
    commitCandidate(applyProjectPatch(projectRef.current, baseRevision, patch), projectName)
  ), [commitCandidate])

  const createNewProject = useCallback(async () => {
    try {
      const record = createProjectRecord()
      const prepared = await prepareProject(record)
      await saveProject(record)
      setProjects((current) => [record, ...current])
      setStorageError('')
      installProject(prepared.record, prepared.state, prepared.deployment)
      closeMenus()
    } catch (error) {
      setStorageError(messageOf(error))
    }
  }, [closeMenus, installProject, prepareProject])

  const deleteProject = useCallback(async (record: ProjectRecord) => {
    try {
      let remaining = projects.filter(({ id }) => id !== record.id)
      let next: Awaited<ReturnType<typeof prepareProject>> | undefined
      if (record.id === currentProjectRef.current.id) {
        for (const candidate of remaining) {
          try {
            next = await prepareProject(candidate)
            break
          } catch {
            // Preserve corrupt rows so the user can inspect or delete them later.
          }
        }
        if (!next) {
          next = await prepareProject(createProjectRecord())
          remaining = [next.record, ...remaining]
        }
      }
      const replacement = next && !projects.some(({ id }) => id === next.record.id) ? next.record : undefined
      await removeProject(record.id, replacement)
      setProjects(remaining)
      setStorageError('')
      if (next) installProject(next.record, next.state, next.deployment)
      closeMenus()
    } catch (error) {
      setStorageError(messageOf(error))
    }
  }, [closeMenus, installProject, prepareProject, projects])

  const invokePreviewTool = useCallback(async (name: string, input: Record<string, unknown>, signal?: AbortSignal) => {
    const deployment = previewDeploymentRef.current
    if (!deployment) throw new Error('Sandbox runtime is not ready.')
    return deployment.invoke(name, input, signal)
  }, [])

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (!isTrustedAdminSource(event, adminIframeRef.current?.contentWindow ?? null, location.origin)) return
      const port = event.ports[0]
      if (!port) return
      try {
        const deployment = previewDeploymentRef.current
        if (!deployment) throw new Error('Sandbox runtime is not ready.')
        const request = readHostApiRequest(event.data, {
          projectId: currentProjectRef.current.id,
          revision: projectRef.current.revision,
        }, location.origin)
        const response = await deployment.fetch(request)
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
      capabilities: builderCapabilities,
      invoke: async (capability, input, signal) => {
        if (capability.name === 'builder_get_started') {
          // Never reject on a failed preview boot: report it as preview diagnostics instead.
          const deployment = previewDeploymentRef.current
          const bootError = deployment ? null : new Error('The preview runtime has not started for this project yet.')
          const referenceSection = input.referenceSection === undefined
            ? undefined
            : referenceSectionNames.includes(input.referenceSection as ReferenceSection)
              ? input.referenceSection as ReferenceSection
              : (() => { throw new TypeError('Choose a referenceSection returned by builder_get_started.') })()
          let reference: { section: ReferenceSection; content: string } | undefined
          if (referenceSection) {
            const response = await fetch('/_mantle/design-atoms.md', { signal })
            if (!response.ok) throw new Error('Mantle Manifest reference is unavailable.')
            reference = { section: referenceSection, content: await response.text() }
          }
          return getStarted(
            projectRef.current,
            {
              ready: bootError === null,
              revision: projectRef.current.revision,
              ...(bootError === null ? {} : { diagnostics: previewDeploymentDiagnostics(bootError) }),
            },
            { id: currentProjectRef.current.id, name: currentProjectRef.current.name },
            reference,
          )
        }
        if (capability.name === 'builder_apply_preset') {
          // Queued so two concurrent mutations cannot both commit against one revision.
          return serializeMutation(async () => {
            assertActiveTarget({ id: currentProjectRef.current.id, revision: projectRef.current.revision }, input)
            if (typeof input.preset !== 'string' || !presetNames.includes(input.preset as PresetName)) throw new TypeError('Choose a preset returned by builder_get_started.')
            const projectName = readProjectName(input.projectName)
            return { preset: input.preset, ...await commitCandidate(proposePreset(projectRef.current, input.preset as PresetName, input.baseRevision), projectName) }
          })
        }
        if (capability.name === 'builder_apply_manifest_patch') {
          return serializeMutation(async () => {
            assertActiveTarget({ id: currentProjectRef.current.id, revision: projectRef.current.revision }, input)
            const projectName = readProjectName(input.projectName)
            return commitPatch(input.baseRevision, readPatch(input.patch), projectName)
          })
        }
        if (capability.name === 'builder_call_preview_tool') {
          assertActiveTarget({ id: currentProjectRef.current.id, revision: projectRef.current.revision }, input)
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
  }, [commitCandidate, commitPatch, invokePreviewTool, projectsReady, serializeMutation])

  const copyStartingPrompt = async () => {
    try {
      await navigator.clipboard.writeText(startingPrompt(promptType, brief))
      setPromptCopied(true)
    } catch {
      setPromptCopied(false)
    }
  }

  const downloadProject = () => {
    try {
      const activeProject = currentProjectRef.current
      const activeState = projectRef.current
      const handoff = createProjectHandoff({
        projectId: activeProject.id,
        name: activeProject.name,
        revision: activeState.revision,
        document: activeState.document,
      }, { projectId: activeProject.id, revision: activeState.revision })
      const data = handoff.bytes.buffer.slice(handoff.bytes.byteOffset, handoff.bytes.byteOffset + handoff.bytes.byteLength) as ArrayBuffer
      const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url
      link.download = handoff.filename
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setExportError('')
      closeMenus()
    } catch (error) {
      setExportError(messageOf(error))
    }
  }

  const summary = projectStateSummary(project)
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
                    onClick={() => { openProject(record); closeMenus() }}
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
            {hasProject && <div className="mt-2 border-t pt-2">
              <p className="truncate px-1 text-xs font-medium">{projectArchiveName(currentProject.name, currentProject.id)}</p>
              <p className="px-1 text-[11px] leading-4 text-muted-foreground">{currentProject.name} · Mantle {mantleVersion}</p>
              <p className="px-1 text-[11px] leading-4 text-muted-foreground" title={`${runtimeSourceRevision} / ${adminSourceRevision}`}>Sources {runtimeSourceRevision.slice(0, 8)} / {adminSourceRevision.slice(0, 8)}</p>
              <p className="px-1 text-[11px] leading-4 text-muted-foreground">Coding-agent handoff; not a ready-to-run app.</p>
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={downloadProject}>
                <Download /> Download project
              </Button>
            </div>}
            {storageError && <p className="mt-2 px-1 text-xs text-destructive">Autosave unavailable: {storageError}</p>}
            {exportError && <p className="mt-2 px-1 text-xs text-destructive">Download failed: {exportError}</p>}
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
                  key={`${currentProject.id}:${project.revision}:${previewFrameRetry}`}
                  ref={adminIframeRef}
                  src={`/_mantle/admin/index.html?builderProjectId=${encodeURIComponent(currentProject.id)}&builderRevision=${project.revision}`}
                  title="Mantle Admin preview"
                  className="absolute inset-0 h-full w-full border-0 bg-background"
                  onLoad={() => setPreviewFrameError(false)}
                  onError={() => setPreviewFrameError(true)}
                />
                {previewFrameError && <div className="absolute inset-0 grid place-items-center bg-background p-6 text-center">
                  <div>
                    <p className="text-sm font-medium">Admin preview did not load.</p>
                    <Button className="mt-3" size="sm" variant="outline" onClick={() => { setPreviewFrameError(false); setPreviewFrameRetry((value) => value + 1) }}>Retry Admin preview</Button>
                  </div>
                </div>}
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
            <p className="text-xs text-muted-foreground">Revision {summary.revision}</p>
          </div>
          <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Compiled
          </span>
          <Button variant="ghost" size="icon-sm" onClick={closeBuild} aria-label="Close build panel"><X /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-xl border bg-card p-3 text-sm" aria-live="polite">
            Mantle parser, linker, and RuntimePlan compiler passed.
          </div>
          {hasProject ? (
            <pre className="overflow-auto rounded-xl border bg-neutral-950 p-4 text-xs leading-5 text-neutral-200 shadow-inner">
              <code>{projectDocumentYaml(project.document)}</code>
            </pre>
          ) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No Manifest atoms yet.</p>}
        </div>
      </dialog>
    </div>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMessage(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readProjectName(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('projectName must be a string.')
  const name = value.trim()
  if (name.length === 0 || name.length > 80) throw new TypeError('projectName must be between 1 and 80 characters.')
  return name
}
