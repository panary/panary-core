import { Injectable } from '@angular/core'
import { AndroidLogSink, formatAndroidLogLine, type AndroidLogPlugins } from './android-log-sink'

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Wie `HubDiscoveryService`: ohne `@capacitor/core`-Import in der Lib.
function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  return !!w.Capacitor?.isNativePlatform?.()
}

/** Logdatei des Android-Wrappers; gesetzt von `installGlobalLogCapture`, modulweit wie `captureInstalled`. */
let androidSink: AndroidLogSink | null = null

/**
 * Ergebnisgruppe, die die Capacitor-Bridge in Debug-Builds um jeden Plugin-Aufruf legt
 * (`native-bridge.js`, `createLogFromNative`): `groupCollapsed('%cresult %c<Plugin>.<Methode> (#id)')`,
 * bei Fehlschlag `console.error(result.error)`, dann `groupEnd()`. Gilt nur fuer die Plugins der Senke.
 */
const SINK_BRIDGE_RESULT = /^%cresult %c(Filesystem|Share)\./

/**
 * Je offener Konsolengruppe: Ist sie eine Ergebnisgruppe der Senken-Plugins? Entscheidend ist nur die
 * innerste: Die Bridge ruft `console.error` direkt darin; eine nie geschlossene Gruppe weiter aussen
 * verschluckt so keine spaeteren Fehler.
 */
const consoleGroups: boolean[] = []
const insideSinkBridgeResult = (): boolean => consoleGroups[consoleGroups.length - 1] === true

/**
 * Haelt die Bridge-Meldungen der Senke aus der Datei (panary/panary-core#1371). Sonst stuende jeder
 * erwartete Fehlschlag darin (`stat` vor dem ersten Schreiben, `Share canceled`), und ein dauerhaft
 * scheiterndes `appendFile` schriebe ueber sein eigenes `console.error` ohne Ende weiter.
 */
function trackBridgeResultGroups(): void {
  const origGroupCollapsed = console.groupCollapsed.bind(console)
  console.groupCollapsed = (...args: unknown[]): void => {
    consoleGroups.push(typeof args[0] === 'string' && SINK_BRIDGE_RESULT.test(args[0]))
    origGroupCollapsed(...args)
  }
  const origGroup = console.group.bind(console)
  console.group = (...args: unknown[]): void => {
    consoleGroups.push(false)
    origGroup(...args)
  }
  const origGroupEnd = console.groupEnd.bind(console)
  console.groupEnd = (): void => {
    consoleGroups.pop()
    origGroupEnd()
  }
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
  if (isTauri()) {
    // Logging darf niemals selbst werfen (sonst Loop ueber console.error-Patch).
    void tauriInvoke('js_log', { level, message }).catch(() => undefined)
    return
  }
  // `debug`/`trace` fallen weg wie unter Tauri (`LevelFilter::Info`).
  if (androidSink && (level === 'error' || level === 'warn' || level === 'info')) {
    androidSink.write(formatAndroidLogLine(level, message))
  }
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

export interface LogCaptureOptions {
  /** Plugins fuer die Logdatei im Capacitor-Android-Wrapper; ohne sie bleibt der Mitschnitt dort aus. */
  android?: AndroidLogPlugins
}

/**
 * Faengt globale Fehler + console.error/warn/info ab und spiegelt sie in die native Logdatei.
 * Gehoert in `main.ts` VOR `bootstrapApplication`, damit auch Fehler beim Bootstrap und beim
 * Laden der Konfiguration ankommen. Idempotent, aktiv unter Tauri und im Android-Wrapper.
 */
export function installGlobalLogCapture(options: LogCaptureOptions = {}): void {
  if (captureInstalled || typeof window === 'undefined') return
  if (!isTauri()) {
    if (!isCapacitor() || !options.android) return
    androidSink = new AndroidLogSink(options.android)
    trackBridgeResultGroups()
  }
  captureInstalled = true

  const origError = console.error.bind(console)
  console.error = (...args: unknown[]): void => {
    origError(...args)
    if (insideSinkBridgeResult()) return
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

/** Wie die Logdatei das Geraet verlaesst: Ordner oeffnen (Tauri) oder Teilen-Menue (Android). */
export type LogExportMode = 'folder' | 'share'

/**
 * Bruecke zur nativen Logdatei: unter Tauri `tauri-plugin-log`, im Android-Wrapper `AndroidLogSink`
 * (beide mit Rotation).
 *
 * - `error/warn/info/debug`: schreibt eine Zeile in die native Logdatei.
 * - `readLogs()`: liest die Datei fuer die In-App-Ansicht.
 * - `exportLogs()`: oeffnet den Log-Ordner (Tauri) bzw. das Teilen-Menue (Android).
 * - `installGlobalCapture()`: siehe `installGlobalLogCapture()`.
 *
 * Ohne Logdatei (Browser/Dev, admin, Android ohne Mitschnitt) sind alle Aufrufe No-Ops.
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

  /** `null`: keine Logdatei auf diesem Geraet, der Bereich „Diagnose & Logs" bleibt aus. */
  exportMode(): LogExportMode | null {
    if (isTauri()) return 'folder'
    return androidSink ? 'share' : null
  }

  /** Liest die native Logdatei (letzte ~200 KB). Leerer String, wenn keine Logs. */
  async readLogs(): Promise<string> {
    if (!isTauri()) return androidSink ? androidSink.read() : ''
    try {
      return await tauriInvoke<string>('read_logs')
    } catch {
      return ''
    }
  }

  /** „Logs exportieren": Log-Ordner im Datei-Explorer (Tauri) bzw. Teilen-Menue mit der Datei (Android). */
  async exportLogs(): Promise<void> {
    if (isTauri()) {
      await tauriInvoke('open_log_dir')
      return
    }
    await androidSink?.share()
  }

  /** Delegiert an `installGlobalLogCapture()`; idempotent ueber alle Instanzen. */
  installGlobalCapture(options?: LogCaptureOptions): void {
    installGlobalLogCapture(options)
  }
}
