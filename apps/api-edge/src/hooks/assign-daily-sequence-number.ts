import { HookContext, NextFunction } from '@feathersjs/feathers'
import { Mutex } from 'async-mutex'

// Vorgangsnummer je Geschaeftstag (panary/panary-core#537).
//
// Bis 2026-10 war die Nummer `"<Minuten><Sekunden>"` plus ein Kollisionszaehler,
// der die BASIS zaehlte statt des Kandidaten: Ab der dritten Bestellung derselben
// Sekunde kam wieder dieselbe Nummer heraus (gemessen: 4 x `9221`). Dazu wiederholte
// sich der Wert stuendlich, und die Zaehl-Query lief ueber alle Mandanten und Tage.
//
// Jetzt: `MAX(dailySequenceNumber) + 1` im Geschaeftstag. `businessDayId` ist eine
// uuid und gehoert genau einer Filiale eines Mandanten — der Schluessel ist damit
// zugleich (tenantId, locationId, businessDayId). Erzwungen wird die Eindeutigkeit
// zusaetzlich vom Teil-Unique-Index der Migration `20261004100000`.
//
// Der Mutex allein reicht nicht: Er endet mit diesem Hook, der Insert kommt erst
// nach weiteren Hooks. Zwei Bestellungen koennten sonst dasselbe MAX lesen, bevor
// die erste gespeichert ist. `lastAssigned` merkt sich deshalb die zuletzt
// vergebene Nummer je Geschaeftstag; der Edge ist single-process, wie beim
// Fiskal-Zaehler (`fiscal-counters.ts`). Scheitert ein Create nach diesem Hook,
// bleibt eine Luecke — die Nummer ist eine Abholnummer, die lueckenlose
// KassenSichV-Vorgangsnummer kommt aus dem Fiskal-Zaehler.

const mutex = new Mutex()

/** Zuletzt vergebene Nummer je `businessDayId` — nur ein Tag ist je Filiale offen. */
const lastAssigned = new Map<string, number>()
const MAX_TRACKED_BUSINESS_DAYS = 16

/** Naechste Nummer aus dem gespeicherten Maximum und der zuletzt vergebenen. */
export function nextDailySequenceNumber(storedMax: number | null | undefined, assigned: number | undefined): number {
  const base = Math.max(Number(storedMax) || 0, assigned ?? 0)
  return base + 1
}

/** Nur fuer Tests: vergisst die prozesslokal vergebenen Nummern (simuliert einen Neustart). */
export function resetDailySequenceMemory(): void {
  lastAssigned.clear()
}

export function assignDailySequenceNumber() {
  return async (context: HookContext, _next?: NextFunction): Promise<any> => {
    const next = typeof _next === 'function' ? _next : async () => context
    await mutex.runExclusive(async () => {
      context.data.dailySequenceNumber = await allocate(context)
    })

    return next()
  }
}

async function allocate(context: HookContext): Promise<number> {
  const { businessDayId, tenantId, locationId } = context.data as {
    businessDayId?: string | null
    tenantId?: string | null
    locationId?: string | null
  }

  // `restrictOrderToBusinessDay` laeuft davor und setzt den Geschaeftstag immer.
  // Fehlt er trotzdem, gibt es keinen Tag, in dem die Nummer eindeutig sein
  // koennte — dann lieber laut scheitern als eine Nummer erfinden.
  if (!businessDayId) throw new Error('assignDailySequenceNumber: businessDayId fehlt — Hook-Reihenfolge pruefen')

  const query: Record<string, unknown> = {
    businessDayId,
    $sort: { dailySequenceNumber: -1 },
    $limit: 1,
    $select: ['_id', 'dailySequenceNumber'],
  }
  // Mandant und Filiale zusaetzlich, wenn gestempelt — schadet nie, schuetzt vor
  // einer (theoretisch) wiederverwendeten Geschaeftstag-ID.
  if (tenantId) query['tenantId'] = tenantId
  if (locationId) query['locationId'] = locationId

  const result = (await context.app.service('orders').find({ query, provider: undefined })) as
    { data: Array<{ dailySequenceNumber?: number }> } | Array<{ dailySequenceNumber?: number }>
  const rows = Array.isArray(result) ? result : result.data

  const value = nextDailySequenceNumber(rows[0]?.dailySequenceNumber, lastAssigned.get(businessDayId))
  remember(businessDayId, value)
  return value
}

function remember(businessDayId: string, value: number): void {
  lastAssigned.delete(businessDayId)
  lastAssigned.set(businessDayId, value)
  // Map haelt die Einfuege-Reihenfolge: der erste Schluessel ist der aelteste Tag.
  while (lastAssigned.size > MAX_TRACKED_BUSINESS_DAYS) {
    const oldest = lastAssigned.keys().next().value
    if (oldest === undefined) break
    lastAssigned.delete(oldest)
  }
}
