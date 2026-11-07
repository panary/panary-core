import { Injectable } from '@angular/core'

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// `withGlobalTauri: true` (tauri.conf.json) stellt `window.__TAURI__.core.invoke`
// bereit — so vermeiden wir eine zusaetzliche @tauri-apps/api-Abhaengigkeit nur
// fuer den invoke-Aufruf.
function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = (
    window as unknown as {
      __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<T> } }
    }
  ).__TAURI__?.core?.invoke
  if (!invoke) return Promise.reject(new Error('Tauri invoke nicht verfuegbar'))
  return invoke(cmd, args)
}

function stringify(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? '\n' + value.stack : ''}`
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function writeNativeLog(level: LogLevel, message: string): void {
  if (!isTauri()) return
  // Logging darf niemals selbst werfen (sonst Loop ueber console.error-Patch).
  void tauriInvoke('js_log', { level, message }).catch(() => undefined)
}

// Modulweit statt je Instanz: `main.ts` installiert vor dem Bootstrap, der Root-Injector baut
// spaeter eine eigene `LogService`-Instanz. Ein Flag je Instanz verkettete den Console-Patch
// dann doppelt, und jede Zeile stuende zweimal in der Datei.
let captureInstalled = false

/**
 * Schreibt einen globalen Fehler nur, wenn ihn kein anderer Listener uebernommen hat.
 *
 * Nach dem Bootstrap reicht `provideBrowserGlobalErrorListeners()` jedes `error`- und
 * `unhandledrejection`-Event an den Angular-`ErrorHandler`, der `console.error('ERROR', …)`
 * ruft — der Console-Patch schreibt das schon mit Stack — und markiert das Event per
 * `preventDefault()`. Eine eigene Zeile waere die Doppelzeile (ADR 0069).
 *
 * Gelesen wird erst per `setTimeout`, also nach dem Dispatch: Dieser Listener haengt seit
 * `main.ts` vor dem von Angular und laeuft zuerst. Ein Microtask reicht nicht, der Browser
 * arbeitet die Microtasks schon nach jedem einzelnen Listener ab.
 */
function writeUnlessHandled(event: Event, line: () => string): void {
  setTimeout(() => {
    if (!event.defaultPrevented) writeNativeLog('error', line())
  }, 0)
}

/**
 * Faengt globale Fehler + console.error/warn/info ab und spiegelt sie in die native Logdatei.
 * Gehoert in `main.ts` VOR `bootstrapApplication`, damit auch Fehler beim Bootstrap und beim
 * Laden der Konfiguration ankommen. Idempotent, nur im Tauri-Kontext aktiv.
 */
export function installGlobalLogCapture(): void {
  if (captureInstalled || !isTauri() || typeof window === 'undefined') return
  captureInstalled = true

  const origError = console.error.bind(console)
  console.error = (...args: unknown[]): void => {
    origError(...args)
    writeNativeLog('error', args.map(stringify).join(' '))
  }
  // Nur `info`: Der Logout-Grund (PosSessionService) ist die einzige Spur, warum eine Sitzung endete.
  const origInfo = console.info.bind(console)
  console.info = (...args: unknown[]): void => {
    origInfo(...args)
    writeNativeLog('info', args.map(stringify).join(' '))
  }
  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]): void => {
    origWarn(...args)
    writeNativeLog('warn', args.map(stringify).join(' '))
  }

  window.addEventListener('error', (e: ErrorEvent) => {
    // Ohne `e.error` (Cross-Origin-Skript) bleibt nur die Meldung, mit ihm der Stack.
    writeUnlessHandled(e, () => `window.onerror: ${stringify(e.error ?? e.message)} @ ${e.filename}:${e.lineno}`)
  })
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    writeUnlessHandled(e, () => `unhandledrejection: ${stringify(e.reason)}`)
  })

  writeNativeLog('info', 'Panary POS gestartet — natives Logging aktiv')
}

/**
 * Bruecke zum nativen Tauri-Log (tauri-plugin-log → Datei mit Rotation).
 *
 * - `error/warn/info/debug`: schreibt eine Zeile in die native Logdatei.
 * - `readLogs()`: liest die Datei fuer die In-App-Ansicht.
 * - `openLogDirectory()`: oeffnet den Log-Ordner im Datei-Explorer (Export).
 * - `installGlobalCapture()`: siehe `installGlobalLogCapture()`.
 *
 * Ausserhalb des Tauri-Kontexts (Browser/Dev, admin) sind alle Aufrufe No-Ops.
 */
@Injectable({ providedIn: 'root' })
export class LogService {
  error(message: string): void {
    writeNativeLog('error', message)
  }
  warn(message: string): void {
    writeNativeLog('warn', message)
  }
  info(message: string): void {
    writeNativeLog('info', message)
  }
  debug(message: string): void {
    writeNativeLog('debug', message)
  }

  /** Liest die native Logdatei (letzte ~200 KB). Leerer String, wenn keine Logs. */
  async readLogs(): Promise<string> {
    if (!isTauri()) return ''
    try {
      return await tauriInvoke<string>('read_logs')
    } catch {
      return ''
    }
  }

  /** Oeffnet das Log-Verzeichnis im Datei-Explorer (fuer „Logs exportieren"). */
  async openLogDirectory(): Promise<void> {
    if (!isTauri()) return
    await tauriInvoke('open_log_dir')
  }

  /** Delegiert an `installGlobalLogCapture()`; idempotent ueber alle Instanzen. */
  installGlobalCapture(): void {
    installGlobalLogCapture()
  }
}
