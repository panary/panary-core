// Lückenloser, monoton steigender Fiskal-Zähler pro (tenantId, locationId) —
// die KassenSichV-Vorgangsnummer (`transactionNumber`), BEWUSST getrennt von der
// Bon-/Anzeigenummer `order.dailySequenceNumber` (die zeitbasiert und nicht
// lückenlos ist). Wird VOR `tsePort.startTransaction` vergeben.
//
// Persistenz ist umgebungs-lokal und NICHT gesynct: eine Location signiert genau
// an einer Stelle (Edge wenn gepairt, sonst cloud-direkt), daher lebt der
// autoritative Zähler dort, wo signiert wird. Edge: SQLite-Tabelle
// `fiscal-counters`; Cloud: Mongo-Collection `fiscal-counters`. Atomare Vergabe
// über einen In-Process-Mutex + die Feathers-Adapter-API (kein Raw-Write).
// Siehe ADR fiskalisierung-architektur-adr.md.
import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

/**
 * Deterministischer Primärschlüssel des Zähler-Datensatzes. Bewusst aus
 * (tenantId, locationId) zusammengesetzt → idempotenter get/upsert ohne separate
 * Query, und der Datensatz ist von Natur aus location-gescopt.
 */
export const fiscalCounterId = (tenantId: string, locationId: string): string => `${tenantId}:${locationId}`

/**
 * Nächster Zählerwert. Start bei 0 (kein Datensatz) → erste Vergabe = 1.
 * Lückenlos und monoton; der Aufrufer persistiert das Ergebnis atomar
 * (Mutex) bevor er den nächsten Wert vergibt.
 */
export const nextFiscalCounterValue = (lastValue: number | undefined): number => (lastValue ?? 0) + 1

export const fiscalCounterSchema = Type.Object(
  {
    _id: Type.String({ minLength: 1, maxLength: 160 }),
    tenantId: Type.String({ minLength: 1, maxLength: 80 }),
    locationId: Type.String({ minLength: 1, maxLength: 80 }),
    // Zuletzt vergebener Wert; der nächste Vorgang erhält lastValue + 1.
    lastValue: Type.Integer({ minimum: 0, default: 0 }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'FiscalCounter', additionalProperties: false },
)
export type FiscalCounter = Static<typeof fiscalCounterSchema>

export const fiscalCounterPatchSchema = Type.Partial(Type.Pick(fiscalCounterSchema, ['lastValue']), {
  $id: 'FiscalCounterPatch',
})
export type FiscalCounterPatch = Static<typeof fiscalCounterPatchSchema>

export const fiscalCounterQueryProperties = Type.Pick(fiscalCounterSchema, ['_id', 'tenantId', 'locationId'])
export const fiscalCounterQuerySchema = Type.Intersect(
  [querySyntax(fiscalCounterQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type FiscalCounterQuery = Static<typeof fiscalCounterQuerySchema>
