import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'

/**
 * Kassen-Session (Schublade / „Tasche") für den Multi-Kassen-Tagesabschluss.
 *
 * Mehrere Sessions pro Geschäftstag, von unterschiedlichen Benutzern eröffnet.
 * Jede wird am Tagesende per Stückelungs-Zähler (Kleingeldzähler) gezählt und
 * geschlossen. Der Cloud-Report aggregiert über alle Sessions eines Tages.
 *
 * Edge-nativ + synchronisiert: Bargeld wird physisch am POS gehandhabt, daher
 * lebt die Kasse im Edge (offline-first) und wird in die Cloud gesynct. Das
 * Schema ist Single Source of Truth in panary-core und wird von panary-cloud
 * (operations/domain) re-exportiert. `deviceId` ist optionales Audit-Feld.
 */

/**
 * Münz-/Schein-Stückelungen in CENTS, absteigend. 7 Scheine (500 €…5 €) +
 * 8 Münzen (2 €…1 ct) — portiert aus der Legacy-App (cash-count.store.ts).
 */
export const CASH_DENOMINATIONS_CENTS = [
  50000, 20000, 10000, 5000, 2000, 1000, 500, // Scheine
  200, 100, 50, 20, 10, 5, 2, 1, // Münzen
] as const

export type CashDenominationCents = (typeof CASH_DENOMINATIONS_CENTS)[number]

/**
 * Stückzahl je Stückelung — Key `d_<cents>` (z. B. `d_5000` = Anzahl 50-€-Scheine).
 * Alle Keys sind OPTIONAL: der Client zählt nur die tatsächlich vorhandenen
 * Stückelungen (eine Teilmenge), fehlende gelten als 0 (`sumDenominationCounts`).
 * Ohne `Type.Optional` würde AJV jeden Key als required prüfen → Patch beim
 * Kasse-Schließen scheitert mit „must have required property d_50000".
 */
const denominationCountsSchema = Type.Object(
  Object.fromEntries(CASH_DENOMINATIONS_CENTS.map(c => [`d_${c}`, Type.Optional(Type.Integer({ minimum: 0, default: 0 }))])),
  { additionalProperties: false },
)
export type DenominationCounts = Partial<Record<`d_${CashDenominationCents}`, number>>

export const CashSessionStatus = {
  OPEN: 'open', // Schublade eröffnet, Anfangsbestand gesetzt
  COUNTING: 'counting', // Stückelung wird erfasst
  CLOSED: 'closed', // gezählt, Differenz berechnet
  AUDITED: 'audited', // vom Manager plombiert
} as const
export type CashSessionStatusType = (typeof CashSessionStatus)[keyof typeof CashSessionStatus]

/** Sessions, die als „offen" gelten (blockieren den Tagesabschluss). */
export const OPEN_CASH_SESSION_STATUSES: ReadonlyArray<CashSessionStatusType> = [
  CashSessionStatus.OPEN,
  CashSessionStatus.COUNTING,
]

/** Sessions, die als „erledigt" gelten (blockieren den Tagesabschluss nicht). */
export const CLOSED_CASH_SESSION_STATUSES: ReadonlyArray<CashSessionStatusType> = [
  CashSessionStatus.CLOSED,
  CashSessionStatus.AUDITED,
]

export const cashSessionSchema = Type.Object({
  _id: Type.String(),
  tenantId: Type.String(),
  locationId: Type.Union([Type.String(), Type.Null()]),
  businessDayId: Type.String(),
  label: Type.String({ minLength: 1, maxLength: 80 }),
  status: StringEnum(Object.values(CashSessionStatus)),

  openedBy: Type.String(), // userId
  openedAt: Type.String({ format: 'date-time' }),
  closedBy: Type.Optional(Type.String()),
  closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  deviceId: Type.Optional(Type.Union([Type.String(), Type.Null()])), // POS/Edge-Audit

  openingFloatCents: Type.Integer({ minimum: 0 }),
  denominationCounts: Type.Optional(denominationCountsSchema),

  // Server-berechnet (protectFromExternal) — aus denominationCounts + Inputs:
  countedClosingFloatCents: Type.Integer({ default: 0 }),
  cashSalesCents: Type.Integer({ default: 0 }),
  cashDropsCents: Type.Integer({ minimum: 0, default: 0 }),
  payoutsCents: Type.Integer({ minimum: 0, default: 0 }),
  expectedClosingFloatCents: Type.Integer({ default: 0 }),
  varianceCents: Type.Integer({ default: 0 }), // counted − expected (signiert)

  notes: Type.Optional(Type.String({ maxLength: 1000 })),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
})
export type CashSession = Static<typeof cashSessionSchema>

/** Σ (Stückzahl × Nennwert) in Cents — der gezählte Ist-Bestand. */
export function sumDenominationCounts(counts: DenominationCounts | undefined | null): number {
  if (!counts) return 0
  let total = 0
  for (const cents of CASH_DENOMINATIONS_CENTS) {
    total += (counts[`d_${cents}`] ?? 0) * cents
  }
  return total
}

/** Erwarteter Endbestand = Anfangsbestand + Bar-Umsatz − Entnahmen − Auszahlungen. */
export function computeExpectedClosingFloatCents(input: {
  openingFloatCents: number
  cashSalesCents?: number
  cashDropsCents?: number
  payoutsCents?: number
}): number {
  return (
    input.openingFloatCents + (input.cashSalesCents ?? 0) - (input.cashDropsCents ?? 0) - (input.payoutsCents ?? 0)
  )
}

// ─── Service-Schemas (CREATE / PATCH / QUERY) — geteilt von Edge + Cloud ───────

/**
 * CREATE-Schema. Zwei Konsumenten:
 *
 * 1. **Client-Eröffnung am POS / Cloud-Admin** — sendet nur die Eröffnungs-
 *    Felder (`businessDayId`, `label`, `openingFloatCents`, optional `openedBy`,
 *    `deviceId`, `notes`). tenantId/locationId stempelt der multiTenancy-Hook;
 *    Server-Defaults (`status`, `openedAt`, abgeleitete Geld-Felder …) stempelt
 *    der Resolver.
 * 2. **Sync-Push Edge→Cloud** — Outbox-Recorder schickt den **vollen** Edge-
 *    Record als Payload (inkl. `_id`, `status`, `openedAt`, `cashSalesCents`,
 *    `createdAt`, `updatedAt`, …). Damit der Cloud-`validateData` diese Felder
 *    nicht via `additionalProperties: false` ablehnt, sind sie via
 *    `Type.Partial(cashSessionSchema)` als Optional erlaubt — der Resolver
 *    überschreibt sie sowieso (sync-fromSync stempelt nicht neu, der bestehende
 *    Wert überlebt).
 *
 * Pflichtfelder beim Eröffnen werden im zweiten Object des Intersect erzwungen.
 */
// Type.Composite statt Type.Intersect: merged die TObjects zu EINEM flachen
// TObject. `additionalProperties: false` greift bei Type.Intersect/`allOf`
// nicht wie erwartet (AJV checkt nur das outer-Level, das bei Intersect leer
// ist → alle Branch-Properties werden als „additional" gewertet, inkl. `_id`
// → Sync-Reject mit „must NOT have additional properties [field: _id]").
// Composite produziert dagegen ein einzelnes TObject mit Pflicht- ∪
// Partial-Feldern; `additionalProperties: false` wirkt regulär.
export const cashSessionDataSchema = Type.Composite(
  [
    Type.Partial(cashSessionSchema),
    Type.Object({
      businessDayId: Type.String(),
      label: Type.String({ minLength: 1, maxLength: 80 }),
      openingFloatCents: Type.Integer({ minimum: 0 }),
    }),
  ],
  { $id: 'CashSessionData', additionalProperties: false },
)
export type CashSessionData = Static<typeof cashSessionDataSchema>

export const cashSessionPatchSchema = Type.Partial(cashSessionSchema, { $id: 'CashSessionPatch' })
export type CashSessionPatch = Static<typeof cashSessionPatchSchema>

export const cashSessionQueryProperties = Type.Pick(cashSessionSchema, [
  '_id',
  'tenantId',
  'locationId',
  'businessDayId',
  'status',
  'openedBy',
  // createdAt: für $sort (findForBusinessDay) — sonst lehnt querySyntax das
  // Sortier-Feld ab („Validation failed").
  'createdAt',
])
export const cashSessionQuerySchema = Type.Intersect(
  [querySyntax(cashSessionQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type CashSessionQuery = Static<typeof cashSessionQuerySchema>
