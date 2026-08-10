/**
 * Der Kalendertag „heute" aus Sicht einer Filiale — einziger Begriff von „heute"
 * im Rotationspfad des Edge (Boot, Nightly-Worker, Lazy-Rotation im Order-Hook).
 *
 * Warum nicht `new Date().toISOString().slice(0, 10)`: das ist der **UTC**-Tag.
 * In CEST (UTC+2) wechselt er um 02:00 Ortszeit. Ein Nachtbetrieb 18:00 → 04:00
 * wurde dadurch sporadisch auf zwei Geschaeftstage aufgeteilt — naemlich immer
 * dann, wenn in genau diesem Moment zufaellig keine Bestellung offen war
 * (`hasActiveOrders === false`, sonst greift der Block-Zweig). Dieselbe Klasse
 * Zeitzonen-Bruch, die panary-cloud ADR 0047 fuer die **Sperre** beseitigt hat,
 * nur an der **Rotation** statt am Gate.
 *
 * Die Rotation bleibt bewusst kalendertagsbasiert — „ein neuer Tag bekommt einen
 * neuen Geschaeftstag" ist ein Kalenderbegriff, und ADR 0047 hat das ausdruecklich
 * so stehen lassen. Geaendert hat sich nur, **wessen** Kalender gilt: der der
 * Filiale statt der von UTC.
 *
 * Semantisch identisch zu `businessDateForTimezone` in panary-cloud
 * (`apps/api-cloud/src/services/businessdays/business-day-date.ts`) — beide Seiten
 * lesen dasselbe Feld (`settings.generalSettings.timezone`) und muessen zum selben
 * `date` kommen, weil der Geschaeftstag ueber den Sync reist.
 *
 * Umgesetzt ist es hier anders als dort: `Intl.DateTimeFormat.formatToParts` statt
 * des `new Date(now.toLocaleString('en-US', …))`-Roundtrips. Der Roundtrip haengt an
 * der Zeitzone des **Servers** und daran, dass `new Date(string)` ein en-US-Format
 * parst; beides ist implementierungsnah. `workers/scheduled-slot.ts` hat dieselbe
 * Entscheidung schon getroffen (dort mit Uhrzeiten, wo der Roundtrip zusaetzlich an
 * DST-Uebergaengen danebenlag) — der Edge kennt also nicht erst seit hier eine
 * Zeitzone, er hatte sie nur im Rotationspfad noch nicht.
 */

/** Fallback, wenn die Filiale keine oder eine unbrauchbare Zeitzone traegt. */
export const DEFAULT_BUSINESS_TIMEZONE = 'Europe/Berlin'

/**
 * Minimale Sicht auf eine Location. Der volle `Location`-Typ aus
 * `@panary/locations/domain` ist strukturell zuweisbar; der Boot-Pfad baut sich
 * das Objekt aus der JSON-Spalte selbst.
 */
export interface LocationTimezoneSource {
  settings?: { generalSettings?: { timezone?: string } } | null
}

const zonedCalendarDate = (instant: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)

  const out: Record<string, string> = {}
  for (const { type, value } of parts) {
    if (type !== 'literal') out[type] = value
  }
  return `${out.year}-${out.month}-${out.day}`
}

/** Kalendertag von `now` in `timezone`, als `YYYY-MM-DD`. */
export function businessDateForTimezone(now: Date, timezone?: string | null): string {
  const tz = timezone || DEFAULT_BUSINESS_TIMEZONE
  try {
    return zonedCalendarDate(now, tz)
  } catch {
    // Unbekannte Zone (Tippfehler ueber die Settings-UI) wirft `RangeError`. Das
    // darf die Rotation nicht anhalten: ein Geschaeftstag, der nicht wechselt,
    // sperrt am naechsten Morgen den Bestellbetrieb, und ein `reopen` gibt es
    // nicht (Risiko-Asymmetrie aus panary-cloud ADR 0032). Gleicher Fallback wie
    // cloud-seitig.
    return zonedCalendarDate(now, DEFAULT_BUSINESS_TIMEZONE)
  }
}

/** Kalendertag von `now` in der Zeitzone der Filiale. */
export function businessDateForLocation(
  location: LocationTimezoneSource | null | undefined,
  now: Date = new Date(),
): string {
  return businessDateForTimezone(now, location?.settings?.generalSettings?.timezone)
}
