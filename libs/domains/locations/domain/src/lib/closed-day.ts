import { ClosedDayPolicy, type ClosedDayPolicyValue } from './location.schema'
import type { HourException, RegularHour } from './opening-hours.util'

/**
 * Ruhetag-Erkennung für das Order-Gate und die Auto-Rotation (panary/panary-core#1133,
 * ADR 0062). Edge und Cloud rufen denselben Helfer auf, damit beide Gates am selben
 * Kalendertag dasselbe Urteil fällen.
 *
 * Bewusst getrennt von `getOpeningHoursForDate`: Der Vorbestellungs-Pfad darf streng
 * sein, ein Gate vor dem Verkauf nicht. Zwei Abweichungen deshalb:
 * - Öffnungszeiten deaktiviert → `unknown`, nie `closed`.
 * - Fehlt der Wochentag in `regular`, ist das ein Pflegefehler und kein gepflegter
 *   Ruhetag → `unknown`. `getOpeningHoursForDate` liest ihn als geschlossen; für ein
 *   Gate hieße das, Filialen zu sperren, die nie „geschlossen" eingetragen haben.
 */

/** Fallback, wenn die Filiale keine oder eine unbrauchbare Zeitzone trägt (wie am Edge). */
export const DEFAULT_LOCATION_TIMEZONE = 'Europe/Berlin'

export type ClosedDayState = 'closed' | 'open' | 'unknown'

export type ClosedDayReason =
  /** `openingHoursSettings.enabled` ist nicht `true`. */
  | 'opening-hours-disabled'
  /** Eine filialgenaue Ausnahme für das Datum entscheidet (Vorrang vor dem Wochentag). */
  | 'exception'
  /** Der reguläre Wochentag entscheidet. */
  | 'regular'
  /** Der Wochentag fehlt in `regular` — Pflegefehler, kein Ruhetag. */
  | 'weekday-missing'

export interface ClosedDayStatus {
  state: ClosedDayState
  /** Kalendertag in Filialzeit, `YYYY-MM-DD`. */
  date: string
  reason: ClosedDayReason
}

/**
 * Minimale Sicht auf eine Location. Der volle `Location`-Typ ist strukturell
 * zuweisbar; die Cloud kann ein eigenes Projektionsobjekt übergeben.
 */
export interface ClosedDayLocation {
  _id?: string
  settings?: {
    generalSettings?: { timezone?: string | null } | null
    openingHoursSettings?: {
      enabled?: boolean
      regular?: RegularHour[]
      closedDayPolicy?: string | null
    } | null
  } | null
}

/** Ausnahme mit Filialbezug — so liefern sie Edge- und Cloud-Service. */
export type LocationScopedHourException = HourException & { locationId?: string | null }

const pad2 = (n: number): string => String(n).padStart(2, '0')

const zonedYmd = (instant: Date, timeZone: string): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const out: Record<string, number> = {}
  for (const { type, value } of parts) {
    if (type !== 'literal') out[type] = Number(value)
  }
  return { year: out['year'], month: out['month'], day: out['day'] }
}

/**
 * Kalendertag von `now` in der Zeitzone der Filiale (`YYYY-MM-DD`). Unbekannte Zone →
 * Standardzone statt Fehler: Ein Tippfehler in den Einstellungen darf kein Gate werfen.
 * Semantisch identisch zu `businessDateForLocation` am Edge.
 */
export function locationCalendarDate(location: ClosedDayLocation | null | undefined, now: Date = new Date()): string {
  const tz = location?.settings?.generalSettings?.timezone || DEFAULT_LOCATION_TIMEZONE
  let ymd: { year: number; month: number; day: number }
  try {
    ymd = zonedYmd(now, tz)
  } catch {
    ymd = zonedYmd(now, DEFAULT_LOCATION_TIMEZONE)
  }
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`
}

/** Wochentag (0=So … 6=Sa) eines Kalenderdatums — unabhängig von der Zeitzone des Prozesses. */
const weekdayOf = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Ist die Filiale an ihrem heutigen Kalendertag laut Öffnungszeiten geschlossen?
 *
 * `exceptions` darf mehr enthalten als das heutige Datum und darf Zeilen fremder
 * Filialen enthalten — beides wird hier verworfen, die Auswahl hängt also nicht an der
 * Reihenfolge der DB-Rückgabe (panary/panary-core#286).
 */
export function closedDayStatus(
  location: ClosedDayLocation | null | undefined,
  exceptions: readonly LocationScopedHourException[],
  now: Date = new Date(),
): ClosedDayStatus {
  const date = locationCalendarDate(location, now)
  const ohs = location?.settings?.openingHoursSettings
  if (ohs?.enabled !== true) return { state: 'unknown', date, reason: 'opening-hours-disabled' }

  const locationId = location?._id
  const exception = exceptions.find(
    e => e.date === date && (!locationId || !e.locationId || e.locationId === locationId),
  )
  if (exception) return { state: exception.closed ? 'closed' : 'open', date, reason: 'exception' }

  const regular = (ohs.regular ?? []).find(r => r.day === weekdayOf(date))
  if (!regular) return { state: 'unknown', date, reason: 'weekday-missing' }

  return { state: regular.closed ? 'closed' : 'open', date, reason: 'regular' }
}

/** Kurzform für Aufrufer, die nur das Urteil brauchen. `unknown` zählt als offen. */
export function isClosedOn(
  location: ClosedDayLocation | null | undefined,
  exceptions: readonly LocationScopedHourException[],
  now: Date = new Date(),
): boolean {
  return closedDayStatus(location, exceptions, now).state === 'closed'
}

/** Ruhetag-Regel des Standorts; fehlt sie oder ist sie unbekannt, gilt `manager-approval`. */
export function resolveClosedDayPolicy(location: ClosedDayLocation | null | undefined): ClosedDayPolicyValue {
  return location?.settings?.openingHoursSettings?.closedDayPolicy === ClosedDayPolicy.BLOCK
    ? ClosedDayPolicy.BLOCK
    : ClosedDayPolicy.MANAGER_APPROVAL
}

/**
 * Rollen, deren PIN einen Ruhetag freigeben darf. Als Literale statt über
 * `@panary/users/domain`, damit die locations-Lib keine weitere Lib-Abhängigkeit
 * bekommt; die Werte sind `UserSystemRole.TENANT_MANAGER` und `.TENANT_OWNER`.
 */
export const CLOSED_DAY_APPROVER_ROLES: Record<ClosedDayPolicyValue, readonly string[]> = {
  [ClosedDayPolicy.MANAGER_APPROVAL]: ['tenant:manager', 'tenant:owner'],
  [ClosedDayPolicy.BLOCK]: ['tenant:owner'],
}

/** Darf eine Freigabe mit dieser Rolle unter dieser Regel den Ruhetag öffnen? */
export function canApproveClosedDay(policy: ClosedDayPolicyValue, role: string | null | undefined): boolean {
  return !!role && CLOSED_DAY_APPROVER_ROLES[policy].includes(role)
}
