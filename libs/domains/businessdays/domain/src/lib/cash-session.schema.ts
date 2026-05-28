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
  // SQLite-Spalte ist nullable; bei offener Session liegt hier NULL.
  // Type.Optional alleine erlaubt nur undefined — Sync-Push schickt aber
  // explizit `null` aus der Knex-Row, daher Union mit Type.Null().
  closedBy: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  deviceId: Type.Optional(Type.Union([Type.String(), Type.Null()])), // POS/Edge-Audit

  openingFloatCents: Type.Integer({ minimum: 0 }),
  // Stueckelungen werden erst beim Schliessen erfasst — Edge speichert NULL,
  // bis Counts kommen. Union mit Null analog zu closedBy.
  denominationCounts: Type.Optional(Type.Union([denominationCountsSchema, Type.Null()])),

  // Server-berechnet (protectFromExternal) — aus denominationCounts + Inputs:
  countedClosingFloatCents: Type.Integer({ default: 0 }),
  cashSalesCents: Type.Integer({ default: 0 }),
  cashDropsCents: Type.Integer({ minimum: 0, default: 0 }),
  payoutsCents: Type.Integer({ minimum: 0, default: 0 }),
  expectedClosingFloatCents: Type.Integer({ default: 0 }),
  varianceCents: Type.Integer({ default: 0 }), // counted − expected (signiert)

  notes: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),

  // Soft-Delete-Tombstone fuer Sync (Cloud<->Edge). Migration legt die Spalte
  // bereits als nullable an; ohne diese Schema-Deklaration lehnt
  // `additionalProperties: false` jeden Push ab, weil der Outbox-Recorder das
  // Feld mitserialisiert (auch wenn es null ist). Pattern analog discount.
  _deletedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
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
// EIN flaches TObject mit allen cashSessionSchema-Feldern. Pflicht beim
// Eröffnen: businessDayId, label, openingFloatCents — alles andere optional,
// damit der Sync-Push den VOLLEN Edge-Record (inkl. _id, status, openedAt,
// cashSalesCents, createdAt, updatedAt, …) durch validateData bringt.
// Bewusst kein Type.Intersect/Type.Partial-Konstrukt: `additionalProperties:
// false` greift bei AJV nur am Top-Level, bei `allOf` werden Branch-Properties
// als „additional" gewertet → Sync-Reject mit „must NOT have additional
// properties [field: _id]". Type.Composite gibt es in dieser TypeBox-Version
// nicht, daher die Felder explizit aufzählen.
export const cashSessionDataSchema = Type.Object(
  {
    // Pflichtfelder beim Eröffnen (Client-facing):
    businessDayId: Type.String(),
    label: Type.String({ minLength: 1, maxLength: 80 }),
    openingFloatCents: Type.Integer({ minimum: 0 }),
    // Server-gestempelte Felder + Sync-Push (alle optional):
    _id: Type.Optional(Type.String()),
    tenantId: Type.Optional(Type.String()),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Optional(StringEnum(Object.values(CashSessionStatus))),
    openedBy: Type.Optional(Type.String()),
    openedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // Spiegelt das Hauptschema: nullable in DB, daher Union mit Null().
    closedBy: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    closedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
    deviceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    denominationCounts: Type.Optional(Type.Union([denominationCountsSchema, Type.Null()])),
    countedClosingFloatCents: Type.Optional(Type.Integer()),
    cashSalesCents: Type.Optional(Type.Integer()),
    cashDropsCents: Type.Optional(Type.Integer({ minimum: 0 })),
    payoutsCents: Type.Optional(Type.Integer({ minimum: 0 })),
    expectedClosingFloatCents: Type.Optional(Type.Integer()),
    varianceCents: Type.Optional(Type.Integer()),
    notes: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // Soft-Delete-Tombstone — siehe cashSessionSchema. Optional, da der
    // Edge-Record das Feld initial mit NULL serialisiert; ohne diese Zeile
    // bricht der Sync-Push (Cloud `additionalProperties: false`).
    _deletedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  },
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
  // Sync-Pull filtert Tombstones via `_deletedAt: { $exists: false }` (Default)
  // oder `params.includeDeleted=true`. Ohne den Pick lehnt querySyntax beide ab.
  '_deletedAt',
])
export const cashSessionQuerySchema = Type.Intersect(
  [querySyntax(cashSessionQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type CashSessionQuery = Static<typeof cashSessionQuerySchema>
