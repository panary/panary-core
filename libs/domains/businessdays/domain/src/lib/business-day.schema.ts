import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'

// Lifecycle-Status eines Geschäftstages.
// 'open'                 → POS kann Bestellungen erfassen
// 'closing-requested'    → POS hat Close getriggert; Edge wartet auf Sync-Outbox-Flush
// 'closing-aggregating'  → Cloud aggregiert; UI zeigt Live-Progress
// 'closed'               → Cloud-Report finalisiert + signiert
// 'failed'               → Aggregation abgebrochen; retry möglich via reAggregate
// 'audited'              → Manuell vom Manager freigegeben (Sicherheits-Plombe)
export const BusinessDayStatus = {
  OPEN: 'open',
  CLOSING_REQUESTED: 'closing-requested',
  CLOSING_AGGREGATING: 'closing-aggregating',
  CLOSED: 'closed',
  FAILED: 'failed',
  AUDITED: 'audited',
} as const

// Snapshot der Location-Betriebsart zur Zeit der Tageseröffnung.
// Bewusst kopiert (statt referenziert), damit ein nachträgliches Umschalten
// von 'pos-cashier' → 'orders-only' den bereits offenen Tag nicht beeinflusst.
export const BusinessDayOperationMode = {
  ORDERS_ONLY: 'orders-only',
  POS_CASHIER: 'pos-cashier',
} as const

export const businessDaySchema = Type.Object({
  _id: Type.String(),
  tenantId: Type.String(),
  locationId: Type.Union([Type.String(), Type.Null()]),

  date: Type.String({ format: 'date' }), // YYYY-MM-DD, Anker des Geschäftstages

  status: StringEnum(Object.values(BusinessDayStatus)),
  openedAt: Type.String({ format: 'date-time' }),
  closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  openedBy: Type.Optional(Type.String({ maxLength: 64 })), // userId
  closedBy: Type.Optional(Type.String({ maxLength: 64 })),

  // Backwards-compat: isOpen ist abgeleitet aus status === 'open', wird aber
  // weiterhin von älteren Konsumenten gelesen. Resolver hält den Wert konsistent.
  isOpen: Type.Boolean(),

  // Schnappschuss der Betriebsart der Location bei Eröffnung.
  operationMode: StringEnum(Object.values(BusinessDayOperationMode)),

  // @deprecated Legacy-Single-Float (vor dem Multi-Kassen-Modell). Float gehört
  // jetzt zur Kasse (cash-sessions.openingFloatCents / countedClosingFloatCents).
  // Felder BLEIBEN im Vollschema für historische Tage, Sync-Kompatibilität und
  // den Legacy-Reconciliation-Fallback (compute-cash-reconciliation.ts) — werden
  // bei neuen Tagen aber nicht mehr geschrieben. Cents als Integer (kein Float-Geld).
  openingFloatCents: Type.Optional(Type.Integer({ minimum: 0 })),
  countedClosingFloatCents: Type.Optional(Type.Integer({ minimum: 0 })),

  // Verknüpfung zum Cloud-Tagesabschluss-Report (uuidv7, Cloud-seitig vergeben).
  reportId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reportErrorMessage: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),

  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
})

export type BusinessDay = Static<typeof businessDaySchema>
export type BusinessDaySchema = BusinessDay

// CREATE-Schema: minimal — Service-Resolver setzt _id, status, isOpen, openedAt.
export const businessDayDataSchema = Type.Object(
  {
    _id: Type.Optional(Type.String()),
    tenantId: Type.Optional(Type.String()),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    date: Type.Optional(Type.String({ format: 'date' })),
    openedBy: Type.Optional(Type.String()),
    operationMode: Type.Optional(StringEnum(Object.values(BusinessDayOperationMode))),
    // openingFloatCents bewusst NICHT mehr im CREATE-Schema: Float gehört zur
    // Kasse (cash-sessions), nicht zum Geschäftstag. Tag-Eröffnung ohne Float.
  },
  { $id: 'BusinessDayData', additionalProperties: false },
)
export type BusinessDayData = Static<typeof businessDayDataSchema>

// PATCH-Schema: alle Felder optional fuer partielle Updates.
export const businessDayPatchSchema = Type.Partial(businessDaySchema, {
  $id: 'BusinessDayPatch',
})
export type BusinessDayPatch = Static<typeof businessDayPatchSchema>

// QUERY-Schema: nur sichere Felder zulassen, $or fuer Multi-Status-Suche.
export const businessDayQueryProperties = Type.Pick(businessDaySchema, [
  '_id',
  'tenantId',
  'locationId',
  'date',
  'status',
  'isOpen',
  'operationMode',
  'reportId',
])
const _businessDayQueryBase = querySyntax(businessDayQueryProperties)
export const businessDayQuerySchema = Type.Object(
  {
    ..._businessDayQueryBase.properties,
    $or: Type.Optional(Type.Array(Type.Any())),
  },
  { additionalProperties: false },
)
export type BusinessDayQuery = Static<typeof businessDayQuerySchema>
