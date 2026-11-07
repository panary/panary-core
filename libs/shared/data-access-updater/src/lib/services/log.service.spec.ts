import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<void>
type Listener = (e: Event) => void

/**
 * Minimales `window` mit echtem Listener-Dispatch: Die Specs brauchen die Reihenfolge der Listener
 * und `defaultPrevented`, wie sie der Browser liefert — ein `addEventListener: vi.fn()` sähe beides nicht.
 */
function stubTauri() {
  const invoke = vi.fn<Invoke>(() => Promise.resolve())
  const listeners = new Map<string, Listener[]>()
  const win = {
    __TAURI_INTERNALS__: {},
    __TAURI__: { core: { invoke } },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  }
  vi.stubGlobal('window', win)
  const dispatch = (type: string, init: Record<string, unknown>): Event => {
    const event = Object.assign(new Event(type, { cancelable: true }), init)
    for (const fn of listeners.get(type) ?? []) fn(event)
    return event
  }
  /** Was `provideBrowserGlobalErrorListeners()` tut: an den ErrorHandler, dann `preventDefault()`. */
  const addAngularListeners = () => {
    win.addEventListener('error', e => {
      console.error('ERROR', (e as ErrorEvent).error)
      e.preventDefault()
    })
    win.addEventListener('unhandledrejection', e => {
      console.error('ERROR', (e as PromiseRejectionEvent).reason)
      e.preventDefault()
    })
  }
  return { invoke, dispatch, addAngularListeners }
}

const errorLines = (invoke: ReturnType<typeof stubTauri>['invoke']) =>
  invoke.mock.calls.filter(([, a]) => a?.['level'] === 'error').map(([, a]) => String(a?.['message']))

// Der Mitschnitt ist modulweit idempotent, also bekommt jeder Test ein frisch geladenes Modul.
async function loadModule() {
  vi.resetModules()
  return import('./log.service')
}

describe('installGlobalLogCapture', () => {
  const original = { error: console.error, warn: console.warn, info: console.info }

  beforeEach(() => {
    vi.useFakeTimers()
    // Die Konsole des Testlaufs nicht mit den absichtlich erzeugten Fehlern füllen.
    console.error = vi.fn()
    console.warn = vi.fn()
    console.info = vi.fn()
  })

  afterEach(() => {
    Object.assign(console, original)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('spiegelt console.info als info in die native Logdatei', async () => {
    const { invoke } = stubTauri()
    const { LogService } = await loadModule()
    new LogService().installGlobalCapture()
    console.info('[PosSessionService] Mitarbeiter-Sitzung beendet. Grund:', 'idle')

    expect(invoke).toHaveBeenCalledWith('js_log', {
      level: 'info',
      message: '[PosSessionService] Mitarbeiter-Sitzung beendet. Grund: idle',
    })
  })

  it('patcht die Konsole nur einmal, auch über main.ts und eine zweite LogService-Instanz', async () => {
    const { invoke } = stubTauri()
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture()
    new LogService().installGlobalCapture()
    new LogService().installGlobalCapture()

    console.error('einmal')

    expect(errorLines(invoke)).toEqual(['einmal'])
    const started = invoke.mock.calls.filter(([, a]) => String(a?.['message']).startsWith('Panary POS gestartet'))
    expect(started).toHaveLength(1)
  })

  it('schreibt einen Fehler vor dem Bootstrap (kein Angular-Listener) mit Stack', async () => {
    const { invoke, dispatch } = stubTauri()
    const { installGlobalLogCapture } = await loadModule()
    installGlobalLogCapture()

    const error = new Error('Konfiguration kaputt')
    dispatch('error', { error, message: error.message, filename: 'main.js', lineno: 12 })
    vi.runAllTimers()

    const lines = errorLines(invoke)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^window\.onerror: Error: Konfiguration kaputt\n.*@ main\.js:12$/s)
  })

  it('schreibt nach dem Bootstrap einen Fehler genau einmal, über den Angular-ErrorHandler', async () => {
    const { invoke, dispatch, addAngularListeners } = stubTauri()
    const { installGlobalLogCapture } = await loadModule()
    installGlobalLogCapture()
    // Angular hängt seine Listener erst beim Bootstrap an, also nach dem eigenen aus main.ts.
    addAngularListeners()

    const error = new Error('Klick kaputt')
    dispatch('error', { error, message: error.message, filename: 'main.js', lineno: 99 })
    vi.runAllTimers()

    const lines = errorLines(invoke)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^ERROR Error: Klick kaputt\n/)
  })

  it('schreibt eine unbehandelte Ablehnung nach dem Bootstrap genau einmal', async () => {
    const { invoke, dispatch, addAngularListeners } = stubTauri()
    const { installGlobalLogCapture } = await loadModule()
    installGlobalLogCapture()
    addAngularListeners()

    dispatch('unhandledrejection', { reason: new Error('Socket weg') })
    vi.runAllTimers()

    expect(errorLines(invoke)).toEqual([expect.stringMatching(/^ERROR Error: Socket weg\n/)])
  })

  it('schreibt eine unbehandelte Ablehnung vor dem Bootstrap selbst', async () => {
    const { invoke, dispatch } = stubTauri()
    const { installGlobalLogCapture } = await loadModule()
    installGlobalLogCapture()

    dispatch('unhandledrejection', { reason: new Error('Konfig nicht geladen') })
    vi.runAllTimers()

    expect(errorLines(invoke)).toEqual([expect.stringMatching(/^unhandledrejection: Error: Konfig nicht geladen\n/)])
  })

  it('schreibt einen Cross-Origin-Fehler ohne error-Objekt mit der Meldung', async () => {
    const { invoke, dispatch } = stubTauri()
    const { installGlobalLogCapture } = await loadModule()
    installGlobalLogCapture()

    dispatch('error', { error: null, message: 'Script error.', filename: '', lineno: 0 })
    vi.runAllTimers()

    expect(errorLines(invoke)).toEqual(['window.onerror: Script error. @ :0'])
  })
})
