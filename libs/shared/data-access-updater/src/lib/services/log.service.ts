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

/**
 * Bruecke zum nativen Tauri-Log (tauri-plugin-log → Datei mit Rotation).
 *
 * - `error/warn/info/debug`: schreibt eine Zeile in die native Logdatei.
 * - `readLogs()`: liest die Datei fuer die In-App-Ansicht.
 * - `openLogDirectory()`: oeffnet den Log-Ordner im Datei-Explorer (Export).
 * - `installGlobalCapture()`: spiegelt console.error/warn + globale Fehler in die
 *   Datei, damit Feld-Fehler (z. B. „Failed to fetch") ohne DevTools auffindbar sind.
 *
 * Ausserhalb des Tauri-Kontexts (Browser/Dev, admin) sind alle Aufrufe No-Ops.
 */
@Injectable({ providedIn: 'root' })
export class LogService {
  #captureInstalled = false

  error(message: string): void {
    this.#write('error', message)
  }
  warn(message: string): void {
    this.#write('warn', message)
  }
  info(message: string): void {
    this.#write('info', message)
  }
  debug(message: string): void {
    this.#write('debug', message)
  }

  #write(level: LogLevel, message: string): void {
    if (!isTauri()) return
    // Logging darf niemals selbst werfen (sonst Loop ueber console.error-Patch).
    void tauriInvoke('js_log', { level, message }).catch(() => undefined)
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

  /**
   * Faengt globale Fehler + console.error/warn ab und spiegelt sie in die native
   * Logdatei. Einmalig beim App-Start aufrufen — nur im Tauri-Kontext aktiv.
   */
  installGlobalCapture(): void {
    if (this.#captureInstalled || !isTauri() || typeof window === 'undefined') return
    this.#captureInstalled = true

    const origError = console.error.bind(console)
    console.error = (...args: unknown[]): void => {
      origError(...args)
      this.#write('error', args.map(stringify).join(' '))
    }
    const origWarn = console.warn.bind(console)
    console.warn = (...args: unknown[]): void => {
      origWarn(...args)
      this.#write('warn', args.map(stringify).join(' '))
    }

    window.addEventListener('error', (e: ErrorEvent) => {
      this.#write('error', `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}`)
    })
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      this.#write('error', `unhandledrejection: ${stringify(e.reason)}`)
    })

    this.info('Panary POS gestartet — natives Logging aktiv')
  }
}
