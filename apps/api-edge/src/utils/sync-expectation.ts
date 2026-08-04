/**
 * Wann ist der naechste automatische Datenabgleich faellig?
 *
 * Hintergrund: Das Sync-Alter-Badge in POS und Admin verglich `lastSyncAt`
 * gegen feste Schwellen (5 min warn / 30 min crit). Die stammen aus der
 * Annahme „Modus `auto` mit Default-Intervall" und sind in jedem anderen
 * Betriebsmodus ein Dauer-Fehlalarm:
 *
 *  - `scheduled` mit einem Slot um 22:00 → das Banner steht den ganzen Tag,
 *    obwohl der Edge exakt das tut, was der Betreiber eingestellt hat.
 *  - `auto` mit einem bewusst gesetzten 60-Minuten-Intervall → dasselbe.
 *  - `manual` / `disabled` → es gibt gar keinen automatischen Abgleich, ein
 *    „veraltet"-Hinweis ist dort per Definition sinnlos.
 *
 * Statt die Modus-Logik in beide Clients zu kopieren (und dort Zeitplan +
 * IANA-Zone erneut auszuwerten), rechnet der Edge sie einmal aus und liefert
 * ueber `/health` einen einzigen absoluten Zeitpunkt. Der Client muss dann nur
 * noch „ist dieser Zeitpunkt ueberfaellig?" beantworten.
 *
 * `null` heisst ausdruecklich: **keine Erwartung** — kein automatischer
 * Abgleich eingeplant, also auch kein Alters-Banner.
 */

import { SyncMode, SYNC_INTERVAL_DEFAULT_SEC } from '@panary/cloud-connection/domain'

import { computeScheduledSlot } from '../workers/scheduled-slot'

/** Der Ausschnitt der `cloud-connection`, den die Berechnung braucht. */
export interface SyncExpectationInput {
  syncMode?: string | null
  syncIntervalSec?: number | null
  syncSchedule?: { times?: string[]; timezone?: string } | null
  lastScheduledSyncAt?: string | null
  lastSyncAt?: string | null
}

export interface SyncExpectation {
  /** Effektiver Modus (leer/unbekannt → `auto`, wie im Scheduler-`default`-Zweig). */
  mode: SyncMode
  /** ISO-Zeitpunkt des naechsten erwarteten Abgleichs, oder `null` = keine Erwartung. */
  nextExpectedSyncAt: string | null
}

/**
 * Normalisiert den gespeicherten Modus. Unbekannte Werte (Altbestand,
 * manueller DB-Eingriff, Downgrade nach einem kuenftigen Modus) werden wie im
 * Scheduler als `auto` behandelt — die Anzeige muss dieselbe Auslegung treffen
 * wie der Worker, sonst widersprechen sich Banner und tatsaechliches Verhalten.
 */
const normalizeMode = (raw: string | null | undefined): SyncMode => {
  const known = Object.values(SyncMode) as string[]
  return known.includes(raw ?? '') ? (raw as SyncMode) : SyncMode.AUTO
}

/**
 * AUTO: naechster Abgleich = letzter Abgleich + Intervall. Ohne bekannten
 * letzten Abgleich (frisch gepairt, noch nie gelaufen) wird ab jetzt gerechnet
 * — ein gerade gepairter Edge soll nicht sofort als „ueberfaellig" gelten.
 */
const intervalExpectation = (connection: SyncExpectationInput, now: Date): string => {
  const intervalSec = connection.syncIntervalSec ?? SYNC_INTERVAL_DEFAULT_SEC
  const lastMs = connection.lastSyncAt ? Date.parse(connection.lastSyncAt) : Number.NaN
  const baseMs = Number.isFinite(lastMs) ? lastMs : now.getTime()
  return new Date(baseMs + intervalSec * 1000).toISOString()
}

export const computeSyncExpectation = (
  connection: SyncExpectationInput | null | undefined,
  now: Date = new Date(),
): SyncExpectation => {
  const mode = normalizeMode(connection?.syncMode)
  if (!connection) return { mode, nextExpectedSyncAt: null }

  // Kein automatischer Abgleich eingeplant — der Betreiber synct von Hand bzw.
  // gar nicht. Ein veralteter Stand ist hier der Normalzustand, keine Stoerung.
  if (mode === SyncMode.MANUAL || mode === SyncMode.DISABLED) {
    return { mode, nextExpectedSyncAt: null }
  }

  if (mode === SyncMode.SCHEDULED) {
    const slot = computeScheduledSlot(connection.syncSchedule ?? undefined, now, connection.lastScheduledSyncAt)
    // Unbrauchbarer Zeitplan (keine Uhrzeit, unbekannte Zone): der Scheduler
    // faellt in genau diesem Fall auf AUTO-Verhalten zurueck — die Erwartung
    // muss das mitmachen, sonst meldet die UI „alles planmaessig", waehrend der
    // Edge in Wahrheit im Minutentakt syncen sollte.
    if (!slot) return { mode, nextExpectedSyncAt: intervalExpectation(connection, now) }
    // Ein faelliger Slot wird im laufenden Tick abgearbeitet; erwartet wird
    // dann trotzdem JETZT — sonst verschluckt die Anzeige einen Slot, der
    // dauerhaft nicht feuert (z. B. weil der Worker haengt).
    if (slot.due) return { mode, nextExpectedSyncAt: new Date(now.getTime()).toISOString() }
    return { mode, nextExpectedSyncAt: new Date(now.getTime() + slot.waitMs).toISOString() }
  }

  return { mode, nextExpectedSyncAt: intervalExpectation(connection, now) }
}
