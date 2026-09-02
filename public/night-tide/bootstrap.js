const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const finePointer = matchMedia('(hover: hover) and (pointer: fine)')
let simulation
let idleTimer = 0
let cleanupPointerListeners
let run = 0

function stop() {
  run += 1
  clearTimeout(idleTimer)
  cleanupPointerListeners?.()
  cleanupPointerListeners = undefined
  simulation?.destroy()
  simulation = undefined
  document.querySelector('.night-tide')?.removeAttribute('data-ready')
}

async function start() {
  stop()
  const canvas = document.querySelector('.night-tide')
  if (!canvas || !document.documentElement.classList.contains('dark') || reducedMotion.matches || !finePointer.matches) return

  const token = run
  const { initFluidSim } = await import('./fluid-sim.js')
  if (token !== run || !document.documentElement.classList.contains('dark')) return

  simulation = initFluidSim(canvas, {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 1.85,
    VELOCITY_DISSIPATION: 0.72,
    PRESSURE: 0.62,
    CURL: 2.5,
    SPLAT_RADIUS: 0.009,
    SPLAT_FORCE: 1650,
    SHADING: true,
    BLOOM: true,
    BLOOM_ITERATIONS: 5,
    BLOOM_RESOLUTION: 128,
    BLOOM_INTENSITY: 0.55,
    BLOOM_THRESHOLD: 0.18,
    BLOOM_SOFT_KNEE: 0.85,
    SUNRAYS: false,
    TRANSPARENT: true,
  })
  canvas.dataset.ready = 'true'

  const wake = () => {
    simulation?.resume()
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => simulation?.pause(), 3_000)
  }
  addEventListener('pointermove', wake, { passive: true })
  addEventListener('pointerdown', wake, { passive: true })
  cleanupPointerListeners = () => {
    removeEventListener('pointermove', wake)
    removeEventListener('pointerdown', wake)
  }
  wake()
}

const restart = () => void start().catch((error) => console.warn('[mantle] Night Tide unavailable', error))
new MutationObserver(restart).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

const root = document.querySelector('#root')
if (root?.querySelector('.night-tide')) restart()
else {
  const canvasObserver = new MutationObserver(() => {
    if (!root?.querySelector('.night-tide')) return
    canvasObserver.disconnect()
    restart()
  })
  if (root) canvasObserver.observe(root, { childList: true, subtree: true })
}
