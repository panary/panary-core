import { Injectable, signal } from '@angular/core'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Muster wie log.service.ts: `withGlobalTauri: true` stellt invoke global bereit.
function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = (
    window as unknown as {
      __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<T> } }
    }
  ).__TAURI__?.core?.invoke
  if (!invoke) return Promise.reject(new Error('Tauri invoke nicht verfuegbar'))
  return invoke(cmd, args)
}

/** Antwort der Kiosk-Commands (`src-tauri/src/kiosk.rs`, `KioskStatus`). */
export interface KioskStatus {
  /** Vollbild ohne Rahmen, Schliessen gesperrt. */
  readonly active: boolean
  /** Geraete-Schalter „Kiosk-Modus auf diesem Geraet". */
  readonly enabled: boolean
  readonly paired: boolean
  /** Debug-Builds und `tauri dev` bleiben immer ein normales Fenster. */
  readonly releaseBuild: boolean
  /** Fenstermodus bis zum naechsten Start. */
  readonly windowMode: boolean
}

/**
 * Bruecke zum Kiosk-Modus der Tauri-Shell (panary/panary-core#1188).
 *
 * Die Commands pruefen selbst keine PIN: Jeder Aufruf ausser `reportPaired` gehoert
 * hinter den PIN-Dialog der POS-Einstellungen. Ausserhalb von Tauri (Browser, Capacitor)
 * tun alle Aufrufe nichts.
 */
@Injectable({ providedIn: 'root' })
export class KioskService {
  readonly #status = signal<KioskStatus | null>(null)

  /** Letzter bekannter Zustand; `null` ausserhalb von Tauri oder vor dem ersten Abruf. */
  readonly status = this.#status.asReadonly()

  isAvailable(): boolean {
    return isTauri()
  }

  /**
   * Meldet beim App-Start, ob das Geraet gekoppelt ist. Die Kopplung liegt im
   * localStorage, den Rust nicht lesen kann; Rust merkt sie sich fuer den naechsten
   * Start. Pairing und Entkoppeln laden die App neu und melden damit erneut.
   */
  async reportPaired(paired: boolean): Promise<void> {
    await this.#call('kiosk_report_paired', { paired })
  }

  async refresh(): Promise<void> {
    await this.#call('kiosk_status')
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.#call('kiosk_set_enabled', { enabled })
  }

  async enterWindowMode(): Promise<void> {
    await this.#call('kiosk_window_mode')
  }

  async exit(): Promise<void> {
    if (!isTauri()) return
    await tauriInvoke('kiosk_exit')
  }

  async #call(cmd: string, args?: Record<string, unknown>): Promise<void> {
    if (!isTauri()) return
    this.#status.set(await tauriInvoke<KioskStatus>(cmd, args))
  }
}
