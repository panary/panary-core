import { describeErrorForLog } from '../utils/log-safe-error'

/** Abstand der verdichteten Erinnerung, solange der Server weg bleibt. */
export const OUTAGE_REMINDER_MS = 10 * 60_000

export interface OutageLogSink {
  warn(message: string): void
  info(message: string): void
}

/**
 * Verdichtet die `connect_error`-Flut eines Verbindungsausfalls (panary/panary-core#1374).
 *
 * Der Socket versucht es mit `reconnectionAttempts: Infinity` etwa alle 5 s erneut. Jede Zeile landet in
 * `panary-pos.log` (`.claude/rules/pos-logging.md` §1), nach gut einem Tag offline bestünde die Datei nur noch
 * daraus. Ein Ausfall ist am Offline-First-POS erwartet und hinterlässt deshalb: eine Zeile beim ersten Fehler
 * (oder bei geänderter Meldung), höchstens eine Erinnerung je `OUTAGE_REMINDER_MS` und eine beim Wiederverbinden.
 */
export class ConnectOutageLog {
  #since: number | null = null
  #attempts = 0
  #lastMessage: string | null = null
  #lastLoggedAt = 0

  constructor(
    private readonly sink: OutageLogSink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  connectError(error: unknown): void {
    const now = this.now()
    // Nur Name, Code und Meldung, nie der Stack (er trägt bei `websocket error` nichts) und nie `data`.
    const message = describeErrorForLog(error)
    this.#attempts++

    if (this.#since === null) {
      this.#since = now
    } else if (message === this.#lastMessage) {
      if (now - this.#lastLoggedAt >= OUTAGE_REMINDER_MS) {
        const minutes = Math.round((now - this.#since) / 60_000)
        this.sink.warn(`[WS] Server weiter nicht erreichbar seit ${minutes} min (${this.#attempts} Versuche): ${message}`)
        this.#lastLoggedAt = now
      }
      return
    }

    this.#lastMessage = message
    this.#lastLoggedAt = now
    this.sink.warn(`[WS] Verbindung fehlgeschlagen: ${message}`)
  }

  connected(): void {
    if (this.#since === null) return
    const seconds = Math.round((this.now() - this.#since) / 1000)
    this.sink.info(`[WS] Wieder verbunden nach ${seconds} s und ${this.#attempts} Versuchen`)
    this.#since = null
    this.#attempts = 0
    this.#lastMessage = null
  }
}
