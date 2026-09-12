/**
 * Wanduhrzeit-Bestandteile eines Instants in einer IANA-Zeitzone — die eine
 * Projektion „UTC-Instant → Ortszeit" im Edge.
 *
 * Die Alternative waere der Roundtrip `new Date(instant.toLocaleString('en-US',
 * { timeZone }))`. Der haengt an der Zeitzone des **Servers** und daran, dass
 * `new Date(string)` ein en-US-Format parst; beides ist implementierungsnah.
 * Sichtbar wird das, sobald die Wanduhrzeit in der Server-Zone nicht existiert:
 * Laeuft der Prozess in `Europe/Berlin` und liegt der Termin am 29.03.2026 um
 * 02:30 Ortszeit der Filiale (`Asia/Dubai`, UTC+4, keine Sommerzeit), parst der
 * Roundtrip in die Spring-Forward-Luecke und liefert 03:30 — eine Stunde daneben,
 * ohne Fehler.
 *
 * Die Funktion lag bis dahin zweimal im Edge: in `workers/scheduled-slot.ts`
 * (dort fiel der DST-Fehler zuerst auf) und, auf den Kalendertag reduziert, in
 * `business-day-date.ts`. `services/pre-orders/validate-opening-hours.hook.ts`
 * war die letzte Stelle, die noch den Roundtrip benutzte (panary/panary-core#279)
 * — statt einer dritten Kopie teilen sich jetzt alle drei diese hier.
 */

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * Zerlegt `instant` in die Wanduhrzeit-Bestandteile von `timeZone`.
 *
 * Wirft `RangeError`, wenn `timeZone` keine bekannte IANA-Zone ist — jeder
 * Aufrufer entscheidet selbst, ob er das als Fallback behandelt (Rotation,
 * Oeffnungszeiten) oder als unbrauchbare Konfiguration (Sync-Zeitplan).
 */
export const zonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // `hourCycle: 'h23'` statt `hour12: false`: letzteres liefert je nach
    // ICU-Version „24" fuer Mitternacht.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const out: Record<string, number> = {}
  for (const { type, value } of parts) {
    if (type !== 'literal') out[type] = Number(value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  }
}
