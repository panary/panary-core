/**
 * Slot-Berechnung fuer den Sync-Modus `scheduled`.
 *
 * Als pure function aus `cloud-sync-scheduler.worker.ts` extrahiert (Praezedenz:
 * `libs/domains/sync/domain/src/lib/backoff-schedule.ts`), damit Vitest die
 * Zeitlogik hermetisch testen kann — die alte Fassung war modul-privat und
 * dadurch ungetestet, was drei Fehler jahrelang unentdeckt liess:
 *
 * 1. **Bootstrap-Deadlock.** Die Vorgaenger-Funktion signalisierte „jetzt
 *    feuern" ausschliesslich ueber einen Catch-up-Zweig, der ein bereits
 *    gesetztes `lastScheduledSyncAt` voraussetzte. Geschrieben wurde das Feld
 *    aber nur *innerhalb* genau dieses Zweigs. Ohne Vorbelegung war er
 *    unerreichbar — der Modus hat nie einen einzigen Sync ausgeloest.
 * 2. **Ueberschiessen.** Der Aufrufer hat einen 60-Sekunden-Timer-Floor. Lag
 *    ein Slot naeher als 60 s, wachte der Tick garantiert *nach* dem Slot auf,
 *    und die strikte Pruefung `slot > jetzt` verwarf ihn dann.
 * 3. **Zeitzonen-Roundtrip.** `new Date(now.toLocaleString('en-US', { timeZone }))`
 *    schnitt auf Sekunden ab und bildete DST-Uebergaenge nicht ab.
 *
 * Gegenmittel hier: Slots werden als absolute Zeitpunkte berechnet (echte
 * Zonen-Offset-Rechnung ueber `Intl.DateTimeFormat`), ein faelliger Slot wird
 * innerhalb eines Nachhol-Fensters auch dann noch erkannt, wenn er bereits
 * vorbei ist, und `lastRunAt` dient nur noch der Doppelfeuer-Sperre — nicht
 * mehr als Voraussetzung fuers Feuern.
 */

/**
 * Wie weit ein bereits vergangener Slot noch nachgeholt wird.
 *
 * Deckt eine ueber Nacht ausgeschaltete Kasse ab (typischer Fall: Slot 02:00,
 * Geraet laeuft erst ab 09:00 wieder). Bewusst nicht groesser: nach mehreren
 * Tagen Stillstand soll genau ein Nachhol-Lauf passieren, nicht einer pro
 * verpasstem Tag — dafuer sorgt zusaetzlich die `lastRunAt`-Sperre.
 */
const SLOT_CATCHUP_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * Toleranz, mit der ein Slot als „jetzt faellig" gilt, obwohl der Zeitpunkt
 * rechnerisch noch Millisekunden in der Zukunft liegt. Faengt Timer-Jitter ab,
 * damit ein knapp zu frueh aufgewachter Tick den Slot nicht verwirft und in
 * eine weitere Warterunde laeuft (die ihn dann ueberschiessen wuerde).
 */
const SLOT_EARLY_GRACE_MS = 1_000

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export interface ScheduledSlotDecision {
  /** Ein Slot ist faellig — der Aufrufer soll jetzt einen Sync-Cycle fahren. */
  due: boolean
  /**
   * Der Slot, der `due` ausgeloest hat, als ISO-String. Gehoert nach dem Lauf
   * in `lastScheduledSyncAt` — nicht `Date.now()`, sonst verschiebt sich die
   * Doppelfeuer-Sperre mit jeder Laufzeit-Verzoegerung nach hinten.
   */
  dueSlotAt?: string
  /** Millisekunden bis zum naechsten kuenftigen Slot. */
  waitMs: number
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const zonedParts = (instant: Date, timeZone: string): ZonedParts => {
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

/** Offset der Zone zum Zeitpunkt `instant` in Millisekunden (oestlich von UTC positiv). */
const zoneOffsetMs = (instant: Date, timeZone: string): number => {
  const p = zonedParts(instant, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // Auf volle Sekunden abschneiden: `formatToParts` liefert keine Millisekunden,
  // sonst wanderte der Sub-Sekunden-Anteil in den Offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * Absoluter Zeitpunkt fuer die Wanduhrzeit `y-m-d h:min` in `timeZone`.
 *
 * Zwei Durchlaeufe, weil der erste Offset noch vom falsch geratenen Zeitpunkt
 * stammt und an DST-Grenzen bis zu einer Stunde danebenliegt. Nicht existente
 * Wanduhrzeiten (Spring-Forward-Luecke) landen auf dem Rand der Luecke,
 * mehrdeutige (Fall-Back) auf einer der beiden Auspraegungen — beides
 * akzeptabel, weil ein Sync-Slot keine exakte Sekunde braucht.
 */
const instantForWallClock = (y: number, m: number, d: number, h: number, min: number, timeZone: string): number => {
  const guess = Date.UTC(y, m - 1, d, h, min)
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone)
  instant = guess - zoneOffsetMs(new Date(instant), timeZone)
  return instant
}

/** Kalendertag verschieben; `Date.UTC` normalisiert Monats-/Jahresgrenzen. */
const shiftDate = (y: number, m: number, d: number, deltaDays: number): [number, number, number] => {
  const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()]
}

/**
 * Entscheidet, ob jetzt ein Slot faellig ist und wann der naechste ansteht.
 *
 * Liefert `null`, wenn der Zeitplan unbrauchbar ist (keine gueltige Uhrzeit,
 * unbekannte Zeitzone) — der Aufrufer faellt dann bewusst auf AUTO-Verhalten
 * zurueck, statt stillzustehen.
 */
export const computeScheduledSlot = (
  schedule: { times?: string[]; timezone?: string } | undefined | null,
  now: Date = new Date(),
  lastRunAt?: string | null,
): ScheduledSlotDecision | null => {
  const times = (schedule?.times ?? []).filter(t => typeof t === 'string' && TIME_PATTERN.test(t))
  const timeZone = schedule?.timezone
  if (times.length === 0 || !timeZone) return null

  const today = (() => {
    try {
      return zonedParts(now, timeZone)
    } catch {
      // Unbekannte Zeitzone → RangeError. Als unbrauchbarer Zeitplan behandeln.
      return null
    }
  })()
  if (!today) return null

  // Gestern/heute/morgen, damit ein Slot kurz vor Mitternacht auch nach dem
  // Tageswechsel noch nachgeholt und der erste Slot des Folgetags gefunden wird.
  const candidates: number[] = []
  for (const deltaDays of [-1, 0, 1]) {
    const [y, m, d] = shiftDate(today.year, today.month, today.day, deltaDays)
    for (const time of times) {
      const [h, min] = time.split(':').map(Number)
      candidates.push(instantForWallClock(y, m, d, h, min, timeZone))
    }
  }
  candidates.sort((a, b) => a - b)

  const nowMs = now.getTime()
  const lastRunMs = lastRunAt ? new Date(lastRunAt).getTime() : Number.NaN
  const hasLastRun = Number.isFinite(lastRunMs)

  // Juengster faelliger Slot: bereits erreicht (inkl. Jitter-Toleranz), noch im
  // Nachhol-Fenster und noch nicht gelaufen. Bewusst der juengste und nicht der
  // aelteste — nach einem laengeren Ausfall soll genau ein Lauf nachgeholt
  // werden, nicht einer pro verpasstem Slot.
  let dueSlot: number | undefined
  for (const slot of candidates) {
    const reached = slot - nowMs <= SLOT_EARLY_GRACE_MS
    const withinCatchup = nowMs - slot <= SLOT_CATCHUP_WINDOW_MS
    const alreadyRan = hasLastRun && lastRunMs >= slot
    if (reached && withinCatchup && !alreadyRan) dueSlot = slot
  }

  const nextSlot = candidates.find(slot => slot > nowMs && slot !== dueSlot)

  return {
    due: dueSlot !== undefined,
    ...(dueSlot !== undefined ? { dueSlotAt: new Date(dueSlot).toISOString() } : {}),
    // Fallback nur theoretisch: bei drei Kalendertagen an Kandidaten liegt
    // immer einer in der Zukunft.
    waitMs: nextSlot !== undefined ? nextSlot - nowMs : SLOT_CATCHUP_WINDOW_MS,
  }
}
