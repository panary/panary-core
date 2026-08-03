// Entscheidungslogik des Inaktivitaets-Logouts, bewusst als reine Funktion
// ohne Angular-Abhaengigkeit: der Zustandsautomat ist der Teil, der falsch sein
// kann, und laesst sich so ohne TestBed und ohne jsdom pruefen (Vorbild:
// `bundle-flow.ts` im Bestelldialog).

/** Vorwarnzeit, bevor der Logout ausgeloest wird. */
export const POS_IDLE_WARNING_MS = 20_000

/** Taktrate des Countdowns. */
export const POS_IDLE_TICK_MS = 1_000

export type PosIdlePhase =
  /** Auto-Logoff ist fuer diesen Mitarbeiter abgeschaltet. */
  | 'disabled'
  /** Frist laeuft, noch keine Warnung sichtbar. */
  | 'armed'
  /** Countdown-Overlay ist sichtbar. */
  | 'warning'
  /** Frist ausgesetzt (offene Bestellannahme oder offline). */
  | 'frozen'

export interface IdleEvaluationInput {
  /** `user.autoLogOff`, bereits aufgeloest. */
  enabled: boolean
  /** Frist ausgesetzt? Offene Bestellannahme oder fehlende Verbindung. */
  frozen: boolean
  /** Gesamtfrist in Millisekunden. */
  timeoutMs: number
  /** Zeitstempel der letzten Interaktion. */
  lastActivityAt: number
  /** Jetzt. */
  now: number
}

export interface IdleEvaluation {
  phase: PosIdlePhase
  /** Verbleibende Millisekunden bis zum Logout; `0` ausserhalb von `armed`/`warning`. */
  remainingMs: number
  shouldLogout: boolean
}

/**
 * Wann die Warnung erscheint. Bei kurzen Fristen wird die Vorwarnzeit auf die
 * halbe Frist gedeckelt, damit nicht der gesamte Zeitraum aus einem laufenden
 * Countdown besteht — die stille Phase ist der eigentliche Normalzustand.
 */
export const resolveWarningMs = (timeoutMs: number): number => Math.min(POS_IDLE_WARNING_MS, Math.floor(timeoutMs / 2))

export const evaluateIdle = ({
  enabled,
  frozen,
  timeoutMs,
  lastActivityAt,
  now,
}: IdleEvaluationInput): IdleEvaluation => {
  if (!enabled) return { phase: 'disabled', remainingMs: 0, shouldLogout: false }

  // Freeze schlaegt eine bereits laufende Warnung: geht waehrend des Countdowns
  // die Verbindung verloren oder oeffnet jemand die Bestellannahme, verschwindet
  // das Overlay, statt bei einem Wert stehenzubleiben, der nie ausloest.
  if (frozen) return { phase: 'frozen', remainingMs: 0, shouldLogout: false }

  // `Math.max(0, …)` faengt einen Uhr-Ruecksprung ab (NTP-Korrektur, manuelle
  // Zeitaenderung). Ohne ihn wuerde ein Sprung nach hinten sofort ausloggen.
  const elapsed = Math.max(0, now - lastActivityAt)
  const remainingMs = timeoutMs - elapsed

  if (remainingMs <= 0) return { phase: 'warning', remainingMs: 0, shouldLogout: true }

  return {
    phase: remainingMs <= resolveWarningMs(timeoutMs) ? 'warning' : 'armed',
    remainingMs,
    shouldLogout: false,
  }
}
