import { logger } from '@panary/shared-backend'
import { DEFAULT_BUSINESS_TIMEZONE, type LocationTimezoneSource } from '../utils/business-day-date'

/**
 * Datum und Uhrzeit für Druckvorlagen — immer in der Zeitzone der Filiale, nie in
 * der des Prozesses.
 *
 * Warum überhaupt: `toLocale*('de-DE')` **ohne** `timeZone` formatiert in der
 * Zeitzone des Node-Prozesses. Der Edge läuft im Container
 * (`node:22-bookworm-slim`, `tools/docker/Dockerfile.edge`) ohne gesetztes `TZ`,
 * also in UTC — der Kassenbon druckte dadurch im Sommer zwei Stunden zu früh
 * (Kundenmeldung 2026-09-12, panary/panary-core#274). Lokal in der Entwicklung
 * (macOS, TZ = Europe/Berlin) fällt das nie auf; genau deshalb hat es den
 * Sichttest überlebt.
 *
 * Warum nicht `TZ` im Container setzen: das kuriert den Bon und verschiebt jede
 * andere zeitzonenfreie Stelle unbemerkt mit. Die Geschäftstag-Logik ist bewusst
 * prozess-TZ-**unabhängig** gebaut (`utils/business-day-date.ts`), und eine zweite
 * Filiale in einer anderen Zone wäre wieder falsch. Die Zeitzone gehört an die
 * Filiale, nicht an den Host.
 *
 * Quelle ist deshalb `settings.generalSettings.timezone` mit **demselben** Fallback
 * wie Geschäftstag, Vorbestell-Slots und Vorbestellungen
 * (`DEFAULT_BUSINESS_TIMEZONE`) — keine zweite Konstante.
 *
 * Die Ausgabeformate sind identisch zu vorher (`15.7.2026`, `14:03`,
 * `15.7.2026, 14:03:05`); geändert hat sich nur, **wessen** Uhr gilt.
 */

type FormatKind = 'date' | 'time' | 'dateTime'

/**
 * Bewusst dieselben Komponenten, die `toLocaleDateString`/`toLocaleTimeString`/
 * `toLocaleString` mit `de-DE` vorher erzeugt haben. `Intl.DateTimeFormat` ohne
 * Optionen liefert nur das Datum — `dateTime` muss die Uhrzeit deshalb explizit
 * anfordern, sonst verschwände sie still von der Storno-Zeile.
 */
const FORMAT_OPTIONS: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  date: { year: 'numeric', month: 'numeric', day: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit' },
  dateTime: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  },
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

/** Zonen, für die schon gewarnt wurde — ein Bon pro Minute soll kein Log fluten. */
const warnedTimeZones = new Set<string>()

const formatterFor = (kind: FormatKind, timeZone: string): Intl.DateTimeFormat => {
  const key = `${kind}|${timeZone}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('de-DE', { timeZone, ...FORMAT_OPTIONS[kind] })
    formatterCache.set(key, formatter)
  }
  return formatter
}

/**
 * Zeitzone prüfen und auf den Default zurückfallen, wenn sie unbrauchbar ist.
 *
 * `Intl.DateTimeFormat` wirft `RangeError` bei einer unbekannten Zone — etwa bei
 * einem Tippfehler in den Filial-Settings. Ein Bon darf daran nicht scheitern: der
 * Kunde stünde ohne Beleg da, und die Ursache läge in einem Settings-Feld, das
 * niemand mit dem Drucker in Verbindung bringt. Also Default und **einmal** loggen.
 */
export function resolvePrintTimeZone(timeZone?: string | null): string {
  const tz = timeZone || DEFAULT_BUSINESS_TIMEZONE
  try {
    formatterFor('date', tz)
    return tz
  } catch {
    if (!warnedTimeZones.has(tz)) {
      warnedTimeZones.add(tz)
      logger.warn({
        message: `Unbekannte Filial-Zeitzone "${tz}" — Druckvorlagen nutzen ${DEFAULT_BUSINESS_TIMEZONE}`,
        event: 'print.invalid_timezone',
        timezone: tz,
        fallback: DEFAULT_BUSINESS_TIMEZONE,
      })
    }
    return DEFAULT_BUSINESS_TIMEZONE
  }
}

/** Zeitzone einer Filiale für den Druck — gleiche Quelle wie der Geschäftstag. */
export function printTimeZoneForLocation(location: LocationTimezoneSource | null | undefined): string {
  return resolvePrintTimeZone(location?.settings?.generalSettings?.timezone)
}

/** `15.7.2026` in Filialzeit. */
export function formatPrintDate(date: Date, timeZone?: string | null): string {
  return formatterFor('date', resolvePrintTimeZone(timeZone)).format(date)
}

/** `14:03` in Filialzeit. */
export function formatPrintTime(date: Date, timeZone?: string | null): string {
  return formatterFor('time', resolvePrintTimeZone(timeZone)).format(date)
}

/** `15.7.2026, 14:03:05` in Filialzeit. */
export function formatPrintDateTime(date: Date, timeZone?: string | null): string {
  return formatterFor('dateTime', resolvePrintTimeZone(timeZone)).format(date)
}
