/* eslint-disable @typescript-eslint/no-explicit-any --
 * Greift auf verschachtelte Location-Settings (`settings.openingHoursSettings`,
 * `settings.generalSettings.timezone`) und den `opening-hour-exceptions`-Service
 * zu — gleiche Baseline wie die Cloud-Fassung dieses Hooks. */

import { BadRequest } from '@feathersjs/errors'
import { getOpeningHoursForDate } from '@panary/locations/domain'
import type { HourException } from '@panary/locations/domain'
import { logger } from '@panary/shared-backend'

import { DEFAULT_BUSINESS_TIMEZONE } from '../../utils/business-day-date'
import { zonedParts } from '../../utils/zoned-parts'
import type { HookContext } from '../../declarations'

/**
 * Öffnungszeiten-Validierung für Vorbestellungen.
 *
 * Hat die Filiale Öffnungszeiten aktiviert, muss `scheduledFor` innerhalb der
 * regulären Zeiten (inkl. tagesgenauer Ausnahmen) liegen — sonst 400. No-Op,
 * wenn `scheduledFor` fehlt, keine Filiale auflösbar ist oder die
 * Öffnungszeiten deaktiviert sind.
 *
 * ⚠️ Zeitzone: Öffnungszeiten sind Filial-lokale Wandzeiten ("10:00"–"22:00"),
 * `scheduledFor` ist ein UTC-Instant. Ein naives `new Date(scheduledFor).getHours()`
 * läge um den Zonen-Offset daneben (11:00 Berlin = 09:00 UTC → fälschlich
 * „09:00 < 10:00 → geschlossen"), weil der Edge-Container ohne `TZ` läuft, also
 * in UTC. Der Instant wird deshalb über `zonedParts` in die Filialzeit projiziert
 * und ALLE Vergleiche (Datum, Wochentag, Uhrzeit) auf dieser Wandzeit gemacht.
 *
 * Die Projektion lief bis panary/panary-core#279 über den Roundtrip
 * `new Date(instant.toLocaleString('en-US', { timeZone }))`. Der ist von der Zone
 * des Server-Prozesses abhängig und fällt in deren Sommerzeit-Lücke um eine Stunde
 * daneben — in Prod latent (Container = UTC), auf einem Entwicklungsrechner aktiv.
 * Begründung und Messung: `utils/zoned-parts.ts`.
 *
 * Läuft in `before.create` NACH validateData/resolveData (tenantId/locationId sind
 * dann gestempelt) und VOR den JSON-Feld-Hooks.
 */
export const validatePreOrderOpeningHours = async (context: HookContext): Promise<HookContext> => {
  const data = context.data as { scheduledFor?: string; locationId?: string | null; tenantId?: string } | undefined
  if (!data?.scheduledFor) return context

  const user = context.params?.user as { locationId?: string | null } | undefined
  const locationId = data.locationId || user?.locationId
  if (!locationId) return context

  const location = await (context.app.service('locations') as any).get(locationId, { provider: undefined })
  const ohs = (location as any)?.settings?.openingHoursSettings
  if (!ohs?.enabled) return context

  const tz = (location as any)?.settings?.generalSettings?.timezone || DEFAULT_BUSINESS_TIMEZONE
  const wall = wallClockInZone(new Date(data.scheduledFor), tz, locationId)

  // Tagesgenaue Ausnahmen laden (Feiertage, Sonderöffnungszeiten) — Datum in
  // Filialzeit, sonst kippt der Tag am UTC-Mitternachtsrand, UND filialgenau:
  // Ausnahmen werden pro Filiale materialisiert (Cloud: `materializeForLocation`),
  // an einem Datum trägt also jede Filiale ihre eigene Zeile. Ohne `locationId` in
  // der Query griffe die zuerst gelieferte davon — `getOpeningHoursForDate` nimmt
  // die ERSTE Zeile mit passendem Datum, und ohne `$sort` ist die Reihenfolge nicht
  // zugesichert (panary/panary-core#286).
  //
  // Hart gefiltert, nicht `{ $in: [locationId, null] }`: Tenant-weite Ausnahmen kann
  // es nicht geben. `baseSchema.locationId` ist ein Pflicht-`uuid` (über die ganze
  // Historie der Datei), jeder Schreibpfad läuft durch `validateData` — auch der
  // Sync-Pull-Apply mit `provider: undefined` —, und erzeugt werden die Zeilen
  // ausschließlich pro Filiale.
  //
  // `paginate: false`, weil die vollständige Tagesmenge gebraucht wird: Der Service
  // reicht `paginate` aus `config/default.json` an den Adapter durch (Edge:
  // `default` 50), und ohne das Flag schneidet Feathers still bei diesem Wert ab.
  // Gleiche Fassung wie der Cloud-Hook (panary/panary-core#282).
  const excResult = (await (context.app.service('opening-hour-exceptions') as any).find({
    query: { date: wall.dateStr, tenantId: data.tenantId, locationId },
    paginate: false,
    provider: undefined,
  })) as any
  const loaded = (Array.isArray(excResult) ? excResult : excResult.data || []) as LocationScopedException[]
  const exceptions = ownLocationExceptions(loaded, locationId)

  const hours = getOpeningHoursForDate(wall.calendarDate, ohs.regular || [], exceptions)
  if (hours.closed) {
    throw new BadRequest('Vorbestellung nicht möglich — der Betrieb ist an diesem Tag geschlossen.')
  }

  if (hours.open && hours.close) {
    if (wall.timeStr < hours.open || wall.timeStr > hours.close) {
      throw new BadRequest(
        `Vorbestellung nicht möglich — die Öffnungszeiten sind ${hours.open} bis ${hours.close} Uhr.`,
      )
    }
  }

  return context
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * Verwirft Ausnahmen, die nicht zur Filiale gehören.
 *
 * Redundant zum `locationId`-Filter der Query — und bewusst so: Die Auswahl trifft
 * `getOpeningHoursForDate` über `exceptions.find(e => e.date === dateStr)`, hing also
 * an der Reihenfolge der DB-Rückgabe. Der Nachfilter macht die Entscheidung von
 * beidem unabhängig: von der Reihenfolge und davon, dass der Query-Filter erhalten
 * bleibt. Fällt er künftig weg, bleibt die Prüfung korrekt statt still beliebig.
 *
 * Er ist deshalb auch der Kanarienvogel: Musste er etwas verwerfen, hat die Query
 * nicht gegriffen — das gehört ins Log, nicht stillschweigend behoben.
 */
/**
 * Der Domain-Typ kennt die Filiale nicht — `getOpeningHoursForDate` braucht sie auch
 * nicht, die Auswahl davor schon.
 */
type LocationScopedException = HourException & { locationId?: string | null }

const ownLocationExceptions = (exceptions: LocationScopedException[], locationId: string): HourException[] => {
  const own = exceptions.filter(e => e.locationId === locationId)
  if (own.length === exceptions.length) return own

  logger.warn({
    message: 'Öffnungszeiten-Ausnahmen fremder Filialen verworfen — der Filial-Filter der Query hat nicht gegriffen',
    event: 'pre-orders.opening-hours.foreign-exceptions-skipped',
    locationId,
    loaded: exceptions.length,
    kept: own.length,
  })

  return own
}

interface WallClock {
  /** Kalendertag in Filialzeit als `YYYY-MM-DD` (Query-Schlüssel der Ausnahmen). */
  dateStr: string
  /** Uhrzeit in Filialzeit als `HH:mm` — direkt mit `open`/`close` vergleichbar. */
  timeStr: string
  /**
   * Derselbe Kalendertag als `Date` für `getOpeningHoursForDate`.
   *
   * Der Domain-Helfer liest Datum und Wochentag über die LOKALEN Getter
   * (`formatDateISO`, `getDay()`), kennt also nur die Zone des Prozesses. Er
   * bekommt deshalb ein `Date`, das in genau dieser Zone den Filial-Kalendertag
   * trägt — auf **12:00** verankert, nicht auf Mitternacht: eine Zeitumstellung
   * des Servers würde den Tag sonst nach hinten kippen lassen (z. B.
   * `America/Santiago`, Sprung um 00:00). Die Uhrzeit dieses Objekts wird nicht
   * gelesen; für den Öffnungszeiten-Vergleich gilt `timeStr`.
   */
  calendarDate: Date
}

const wallClockInZone = (instant: Date, timeZone: string, locationId: string): WallClock => {
  const parts = (() => {
    try {
      return zonedParts(instant, timeZone)
    } catch {
      // Unbekannte Zone (Tippfehler über die Settings-UI) wirft `RangeError`. Das
      // darf keine 500er auf jede Vorbestellung dieser Filiale erzeugen — gleicher
      // Fallback wie im Rotationspfad (`business-day-date.ts`), aber laut, weil
      // die Prüfung dann gegen eine fremde Zone läuft.
      logger.warn({
        message: 'Unbekannte Zeitzone der Filiale — Öffnungszeiten werden gegen den Standard geprüft',
        event: 'pre-orders.opening-hours.timezone-fallback',
        locationId,
        timezone: timeZone,
        fallback: DEFAULT_BUSINESS_TIMEZONE,
      })
      return zonedParts(instant, DEFAULT_BUSINESS_TIMEZONE)
    }
  })()

  return {
    dateStr: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
    timeStr: `${pad2(parts.hour)}:${pad2(parts.minute)}`,
    calendarDate: new Date(parts.year, parts.month - 1, parts.day, 12),
  }
}
