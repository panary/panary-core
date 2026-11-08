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

/** Android-Wrapper: `Capacitor.isNativePlatform()` und Plugins mit Dateien im Speicher. */
function stubCapacitor(native = true) {
  const files = new Map<string, string>()
  const filesystem = {
    appendFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      files.set(path, (files.get(path) ?? '') + data)
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => ({ data: files.get(path) ?? '' })),
    stat: vi.fn(async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error('fehlt')
      return { size: files.get(path)?.length ?? 0 }
    }),
    rename: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///data/files/${path}` })),
  }
  const share = { share: vi.fn(async () => ({})) }
  vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => native }, addEventListener: vi.fn() })
  const lines = () => (files.get('logs/panary-pos.log') ?? '').split('\n').filter(Boolean)
  return { android: { filesystem, share }, lines }
}

/** Was `createLogFromNative` der Capacitor-Bridge in Debug-Builds bei einem fehlgeschlagenen Aufruf tut. */
function bridgeLogsFailure(plugin: string, method: string, error: unknown): void {
  console.groupCollapsed(`%cresult %c${plugin}.${method} (#7)`, 'color: red', 'font-weight: bold')
  console.error(error)
  console.groupEnd()
}

describe('LogService im Android-Wrapper', () => {
  const original = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    group: console.group,
    groupCollapsed: console.groupCollapsed,
    groupEnd: console.groupEnd,
  }

  beforeEach(() => {
    console.error = vi.fn()
    console.warn = vi.fn()
    console.info = vi.fn()
    console.group = vi.fn()
    console.groupCollapsed = vi.fn()
    console.groupEnd = vi.fn()
  })

  afterEach(() => {
    Object.assign(console, original)
    vi.unstubAllGlobals()
  })

  const withoutTime = (lines: string[]) => lines.map(l => l.replace(/^\[[^\]]*\]\[[^\]]*\]/, ''))

  it('schreibt Bridge-Fehler der Senken-Plugins nicht in die Datei, Fehler danach schon (#1371)', async () => {
    const { android, lines } = stubCapacitor()
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture({ android })

    bridgeLogsFailure('Filesystem', 'stat', { message: "'stat' failed", code: 'OS-PLUG-FILE-0008' })
    bridgeLogsFailure('Share', 'share', { message: 'Share canceled' })
    console.error('Bon nicht gedruckt')
    await new LogService().readLogs()

    expect(withoutTime(lines())).toEqual([
      '[webview][INFO] Panary POS gestartet — natives Logging aktiv',
      '[webview][ERROR] Bon nicht gedruckt',
    ])
  })

  it('schreibt Bridge-Fehler anderer Plugins weiter in die Datei', async () => {
    const { android, lines } = stubCapacitor()
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture({ android })

    bridgeLogsFailure('CapacitorHttp', 'request', { message: 'Timeout' })
    await new LogService().readLogs()

    expect(withoutTime(lines())).toEqual([
      '[webview][INFO] Panary POS gestartet — natives Logging aktiv',
      '[webview][ERROR] {"message":"Timeout"}',
    ])
  })

  it('läuft nicht im Kreis, wenn appendFile dauerhaft scheitert und die Bridge das meldet', async () => {
    const { android } = stubCapacitor()
    android.filesystem.appendFile.mockImplementation(async () => {
      const error = { message: 'No space left on device' }
      bridgeLogsFailure('Filesystem', 'appendFile', error)
      throw error
    })
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture({ android })
    const service = new LogService()

    await service.readLogs()
    await service.readLogs()

    // Startzeile: ein Versuch. Mit Rückkopplung erzeugte jeder Fehlschlag die nächste Zeile.
    expect(android.filesystem.appendFile).toHaveBeenCalledTimes(1)
  })

  it('schreibt Startzeile und Konsole in die Logdatei und liest sie zurück', async () => {
    const { android, lines } = stubCapacitor()
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture({ android })
    console.warn('Edge nicht erreichbar')
    const service = new LogService()

    const text = await service.readLogs()

    expect(lines().map(l => l.replace(/^\[[^\]]*\]\[[^\]]*\]/, ''))).toEqual([
      '[webview][INFO] Panary POS gestartet — natives Logging aktiv',
      '[webview][WARN] Edge nicht erreichbar',
    ])
    expect(text).toMatch(/Edge nicht erreichbar\n$/)
    expect(service.exportMode()).toEqual('share')
  })

  it('lässt debug weg wie unter Tauri', async () => {
    const { android, lines } = stubCapacitor()
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture({ android })
    const service = new LogService()
    service.debug('nur Entwickler')
    service.error('Bon nicht gedruckt')
    await service.readLogs()

    expect(lines().map(l => l.replace(/^\[[^\]]*\]\[[^\]]*\]/, ''))).toEqual([
      '[webview][INFO] Panary POS gestartet — natives Logging aktiv',
      '[webview][ERROR] Bon nicht gedruckt',
    ])
  })

  it('teilt die Datei über „Logs exportieren"', async () => {
    const { android } = stubCapacitor()
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture({ android })

    await new LogService().exportLogs()

    expect(android.share.share).toHaveBeenCalledWith({
      title: 'Panary POS Log',
      files: ['file:///data/files/logs/panary-pos.log'],
    })
  })

  it('bleibt ohne Plugins aus, auch im Wrapper', async () => {
    stubCapacitor()
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture()
    const service = new LogService()

    expect(service.exportMode()).toBeNull()
    expect(await service.readLogs()).toEqual('')
  })

  it('bleibt im Browser aus, auch wenn log-capture.ts die Plugins übergibt', async () => {
    const { android } = stubCapacitor(false)
    const { installGlobalLogCapture, LogService } = await loadModule()
    installGlobalLogCapture({ android })
    console.error('im Browser')
    const service = new LogService()

    expect(service.exportMode()).toBeNull()
    expect(await service.readLogs()).toEqual('')
    expect(android.filesystem.appendFile).not.toHaveBeenCalled()
  })

  it('nimmt unter Tauri den Ordner, nicht die Plugins', async () => {
    const { invoke } = stubTauri()
    const { installGlobalLogCapture, LogService } = await loadModule()
    const { android } = stubCapacitor()
    vi.stubGlobal('window', { ...window, __TAURI_INTERNALS__: {}, __TAURI__: { core: { invoke } } })
    installGlobalLogCapture({ android })
    const service = new LogService()

    await service.exportLogs()

    expect(service.exportMode()).toEqual('folder')
    expect(invoke).toHaveBeenCalledWith('open_log_dir', undefined)
    expect(android.filesystem.appendFile).not.toHaveBeenCalled()
  })
})
