import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema, ingredientReferenceSchema, recipeReferenceSchema } from '@panary/shared-common'

//#region Enums & Constants
export const OrderChannel = {
  TELEPHONE: 'telephone',
  ONLINE: 'online',
  POS: 'pos',
  APP: 'app',
} as const

// Order-Lifecycle:
//
//   ACTIVE      → Bestellung eingegangen, wartet auf Produktionsstart
//   PRODUCTION  → Kueche in Bearbeitung (heute auf KDS sichtbar)
//   PRODUCED    → Produktion fertig, Ware aus dem Bestand gebucht; wartet
//                 auf Uebergabe (zukuenftige Abholtafel-Sicht)
//   COMPLETED   → Order an Kunde uebergeben / Bezahlung abgeschlossen
//   ABORTED     → Storniert (vor oder nach PRODUCED). Wenn nach PRODUCED:
//                 SALES_OUT_REVERSAL-Movement wird erzeugt.
//   UNCLAIMED   → War COMPLETED, aber nach TTL nicht abgeholt (Sonderfall)
//
// Stock-Buchung erfolgt beim Uebergang `→ PRODUCED`. Defensiv triggert der
// order-stock-update-Hook auch bei `→ COMPLETED` (Uebergangs-Strategie, solange
// das Frontend direkt PRODUCTION → COMPLETED setzt). Idempotenz ueber
// `stockBookedAt`-Marker.
export const OrderStatus = {
  ACTIVE: 'active',
  PRODUCTION: 'production',
  PRODUCED: 'produced',
  COMPLETED: 'completed',
  ABORTED: 'aborted',
  UNCLAIMED: 'unclaimed',
} as const

export const TransactionMethod = {
  CASH: 'cash',
  CARD: 'card',
  ONLINE: 'online',
  OTHER: 'other',
} as const

export const PaymentState = {
  PENDING: 'pending',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  REFUNDED: 'refunded',
} as const

export const DineLocation = {
  DINE_IN: 'dine-in',
  TAKE_OUT: 'take-out',
} as const

export const DiscountType = {
  PERCENT: 'percent',
  AMOUNT: 'amount',
} as const

// TSE-Signierstatus eines Bons (KassenSichV). 'unavailable' = TSE war beim
// Signieren ausgefallen (§146a) → nachzusignieren; 'failed' = anderer Fehler.
export const OrderTseStatus = {
  STARTED: 'started',
  SIGNED: 'signed',
  FAILED: 'failed',
  UNAVAILABLE: 'unavailable',
} as const

export const taxSummerySchema = Type.Object({
  taxes: Type.Array(
    Type.Object({
      taxRate: Type.Number(),
      amount: Type.Number(),
      tax: Type.Number(),
    }),
  ),
  netto: Type.Number(),
  brutto: Type.Number(),
})
//#endregion

//#region Sub-Schemas
export const taxSummarySchema = Type.Object({
  taxes: Type.Array(
    Type.Object({
      taxRate: Type.Number(),
      amount: Type.Number(),
      tax: Type.Number(),
    }),
  ),
  netto: Type.Number(),
  brutto: Type.Number(),
})

export const discountSchema = Type.Object({
  discountType: StringEnum(Object.values(DiscountType)),
  discount: Type.Number({ minimum: 0 }),
})

// Snapshot eines auf die Order angewandten Rabatts (additiv zu `discount`).
// Einzige Quelle für angewandte Rabatte: Order-Level (`target: 'order'`) und
// positionsbezogen (`target: 'line'` + `lineItemId`). `computedAmountCents` ist
// der von der Tax-Engine berechnete, tatsächlich abgezogene Brutto-Betrag (Cents).
// Werte (valueType/valuePercent/valueCents) sind ein Snapshot der Rabatt-Definition
// zum Anwendungszeitpunkt — spätere Definitionsänderungen verändern Bons nicht.
export const appliedDiscountSchema = Type.Object({
  _id: Type.String({ format: 'uuid' }),
  discountId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  discountCodeId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  code: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  name: Type.String({ maxLength: 120 }),
  method: StringEnum(['manual', 'automatic', 'code']),
  target: StringEnum(['order', 'line']),
  valueType: StringEnum(Object.values(DiscountType)),
  valuePercent: Type.Number({ minimum: 0, maximum: 100 }),
  valueCents: Type.Integer({ minimum: 0 }),
  computedAmountCents: Type.Number({ minimum: 0 }),
  lineItemId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  appliedBy: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  appliedAt: Type.String({ format: 'date-time' }),
  isStaffMeal: Type.Optional(Type.Boolean()),
})

export const cancellationSchema = Type.Object({
  canceledBy: Type.String({ maxLength: 200 }),
  reason: Type.String({ maxLength: 500 }),
  canceledAt: Type.String({ format: 'date-time' }),
})

export const customerPaymentInfoSchema = Type.Object({
  customerId: Type.String({ format: 'uuid' }), // Was ObjectId
  customerName: Type.String({ maxLength: 200 }),
  isPaid: Type.Boolean(),
  payedAt: Type.Optional(Type.String({ format: 'date-time' })), // legacy typo 'payedAt' kept for now, or should fix to paidAt? Keeping structure.
})

export const staffPaymentInfoSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }), // Was ObjectId
  userName: Type.String({ maxLength: 200 }),
  isPaid: Type.Boolean(),
  payedAt: Type.Optional(Type.String({ format: 'date-time' })),
})

export const genericLineItemSchema = Type.Object({
  // _id: ObjectIdSchema(), // subdoc ID? usually string in array
  _id: Type.String({ format: 'uuid' }),
  externalId: Type.String({ format: 'uuid' }),
  amount: Type.Number({ minimum: 0 }),
  name: Type.String({ maxLength: 200 }),
  icon: Type.Optional(Type.String({ maxLength: 16 })), // Emoji-Icon (nur UI-Anzeige)
  parentId: Type.Optional(Type.String({ format: 'uuid' })),
  price: Type.Number({ minimum: 0 }),

  recipeReferences: Type.Array(recipeReferenceSchema, { maxItems: 200 }),
  ingredientReferences: Type.Array(ingredientReferenceSchema, { maxItems: 200 }),

  taxInside: Type.Number({ minimum: 0 }),
  taxOutside: Type.Number({ minimum: 0 }),
  topic: Type.String({ maxLength: 200 }),
})

/**
 * Generische Bundle-Komponente einer Order-Zeile — ersetzt die hartkodierten
 * menuDrink/menuSideDish-Slots. Trägt einen EIGENEN Steuersatz (taxInside/
 * taxOutside aus genericLineItemSchema), damit mehrsatzige Menüs korrekt
 * gesplittet werden, plus optional die Herkunfts-OptionGroup + eine Rolle zur
 * Gruppierung in Bon/UI.
 */
export const lineComponentSchema = Type.Intersect([
  genericLineItemSchema,
  Type.Object({
    optionGroupId: Type.Optional(Type.String({ format: 'uuid' })),
    // 'main' = Hauptgericht eines Bundles (trägt bei FIXED_PROPORTIONAL sein
    // Normalpreis-Gewicht); übrige Rollen gruppieren in Bon/UI.
    role: Type.Optional(StringEnum(['main', 'drink', 'side', 'sauce', 'extra'])),
  }),
])
export type LineComponent = Static<typeof lineComponentSchema>

export const orderLineItemSchema = Type.Intersect([
  genericLineItemSchema,
  Type.Object({
    acronym: Type.Optional(Type.String()),
    productGroupExternalId: Type.String({ format: 'uuid' }),
    bundleNumber: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    modifiers: Type.Array(genericLineItemSchema, { maxItems: 100 }),
    index: Type.Optional(Type.Number()),
    // Neues Modell: generische Bundle-Komponenten (optional/rückwärtskompatibel).
    // Reader bevorzugen components[], fallen sonst auf menuDrink/menuSideDish.
    components: Type.Optional(Type.Array(lineComponentSchema, { maxItems: 100 })),
    // Preismodus des Bundles auf Order-Ebene: 'ROLLUP' = Σ Komponenten,
    // 'FIXED_PROPORTIONAL' = Festpreis (line.price) proportional über Komponenten
    // verteilt. Fehlt = à-la-carte/ROLLUP-Verhalten.
    bundlePricingMode: Type.Optional(StringEnum(['ROLLUP', 'FIXED_PROPORTIONAL'])),
    // --- Legacy (deprecated; Sunset nach abgeschlossener Migration) ---
    isMenu: Type.Optional(Type.Boolean()),
    menuDrink: Type.Optional(Type.Union([genericLineItemSchema, Type.Null()])),
    menuSideDish: Type.Optional(Type.Union([genericLineItemSchema, Type.Null()])),
  }),
])

export const transactionSchema = Type.Object({
  _id: Type.String({ format: 'uuid' }), // Was ObjectId
  method: StringEnum(Object.values(TransactionMethod)),
  amount: Type.Number({ minimum: 0 }),
  currency: Type.String({ default: 'EUR', pattern: '^[A-Z]{3}$' }),
  timestamp: Type.String({ format: 'date-time' }),
  referenceId: Type.Optional(Type.String({ maxLength: 200 })),
  data: Type.Optional(Type.Any()),
  performedBy: Type.Optional(Type.String({ format: 'uuid' })), // Was ObjectId
})

export const paymentSchema = Type.Object({
  state: StringEnum(Object.values(PaymentState)),
  totalAmount: Type.Number({ minimum: 0 }),
  tipAmount: Type.Number({ default: 0, minimum: 0 }),
  transactions: Type.Array(transactionSchema, { maxItems: 100 }),
})

export const creationContextSchema = Type.Object({
  createdBy: Type.String({ format: 'uuid' }),
  createdVia: Type.Optional(Type.String({ format: 'uuid' })),
})

// Eingebetteter TSE-Snapshot (KassenSichV). Strukturell identisch zu
// `OrderTseInfo` aus `@panary/tse/domain` — bewusst hier dupliziert, um eine
// Cross-Domain-Abhängigkeit orders→tse zu vermeiden. Vom Edge-Hook
// `signOrderTse*` gesetzt; im Cloud-Modus read-only synchronisiert.
export const orderTseSchema = Type.Object({
  status: StringEnum(Object.values(OrderTseStatus)),
  provider: Type.String({ maxLength: 40 }),
  clientId: Type.String({ maxLength: 200 }),
  transactionNumber: Type.Number({ minimum: 0 }),
  simulated: Type.Boolean(),
  startedAt: Type.Optional(Type.String({ format: 'date-time' })),
  signatureCounter: Type.Optional(Type.Number({ minimum: 0 })),
  signatureValue: Type.Optional(Type.String({ maxLength: 4096 })),
  signatureAlgorithm: Type.Optional(Type.String({ maxLength: 80 })),
  logTime: Type.Optional(Type.String({ format: 'date-time' })),
  processType: Type.Optional(Type.String({ maxLength: 60 })),
  errorReason: Type.Optional(Type.String({ maxLength: 500 })),
  // Storno-/Refund-Signatur (KassenSichV: eigener fiskalischer Vorgang). NEBEN
  // der Verkaufs-Signatur gehalten — die Sale-Signatur bleibt für den Audit
  // erhalten. Gesetzt von signOrderTseCancel(Cloud) beim Übergang → ABORTED.
  cancellation: Type.Optional(
    Type.Object(
      {
        status: StringEnum(['canceled', 'failed', 'unavailable']),
        canceledAt: Type.String({ format: 'date-time' }),
        signatureCounter: Type.Optional(Type.Number({ minimum: 0 })),
        signatureValue: Type.Optional(Type.String({ maxLength: 4096 })),
        signatureAlgorithm: Type.Optional(Type.String({ maxLength: 80 })),
        logTime: Type.Optional(Type.String({ format: 'date-time' })),
        processType: Type.Optional(Type.String({ maxLength: 60 })),
        errorReason: Type.Optional(Type.String({ maxLength: 500 })),
      },
      { additionalProperties: false },
    ),
  ),
})
//#endregion

//#region The main data model (schema)
export const orderSchema = Type.Object(
  {
    ...baseSchema,
    _id: Type.String({ format: 'uuid' }), // Override baseSchema ObjectId
    // externalId bewusst NICHT im Order-Schema: anders als bei Stamm-Daten
    // (products/ingredients/customers) gibt es keinen Use-Case fuer eine
    // externe Order-ID. Der `_id` (uuidv7) ist die einzige Order-Identitaet.
    // LineItem.externalId (genericLineItemSchema oben) bleibt — das ist die
    // Cross-Reference auf das verlinkte Produkt im Katalog.

    status: StringEnum(Object.values(OrderStatus)),
    businessDayId: Type.Optional(Type.String({ format: 'uuid' })), // Was ObjectId, now optional for Standalone mode
    // Zugeordnete Kassen-Session (cash-session). Serverseitig vom
    // restrictOrderToCashSession-Guard gestempelt (Cloud-Modus, pos-cashier).
    // `Null` toleriert — Edge serialisiert ungesetzte nullable SQLite-Spalten
    // als null (Standalone / orders-only), sonst „must be string" beim Sync-Push.
    cashSessionId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    orderChannel: StringEnum(Object.values(OrderChannel)),
    dailySequenceNumber: Type.Number({ minimum: 0 }),
    dineLocation: StringEnum(Object.values(DineLocation)),

    lineItems: Type.Array(orderLineItemSchema, { maxItems: 500 }),

    cancellation: Type.Optional(Type.Union([cancellationSchema, Type.Null()])),
    customerPaymentInfo: Type.Optional(Type.Union([customerPaymentInfoSchema, Type.Null()])),
    discount: Type.Optional(Type.Union([discountSchema, Type.Null()])),
    // Angewandte Rabatte (Phase 1+). Additiv zu `discount` (Rückwärtskompatibilität):
    // ist diese Liste gesetzt, ist sie führend; sonst greift `discount`. `Null` wird
    // toleriert, weil der Edge ungesetzte nullable SQLite-Spalten als `null` serialisiert
    // (sonst „must be array" beim Cloud-Sync-Push — gleiches Muster wie stockMovementIds).
    appliedDiscounts: Type.Optional(Type.Union([Type.Array(appliedDiscountSchema, { maxItems: 50 }), Type.Null()])),
    staffPaymentInfo: Type.Optional(Type.Union([staffPaymentInfoSchema, Type.Null()])),
    taxSnapshot: Type.Optional(Type.Union([taxSummarySchema, Type.Null()])),

    creationContext: Type.Optional(Type.Union([creationContextSchema, Type.Null()])),
    payment: Type.Optional(Type.Union([paymentSchema, Type.Null()])),

    isFinished: Type.Boolean(),
    // Wenn gesetzt, wurde diese Order aus einer Vorbestellung konvertiert
    preOrderId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    pager: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
    estimatedDuration: Type.Number({ minimum: 0 }),
    remainingTime: Type.Number({ minimum: 0 }),
    targetCompletionAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
    table: Type.Optional(Type.Union([Type.String({ maxLength: 50 }), Type.Null()])),
    recordingDate: Type.String({ format: 'date-time' }),

    // === Verkaufsverbrauch-Buchung (Variante A) ===
    // Idempotenz-Marker fuer den order-stock-update-Hook in api-cloud.
    // Gesetzt beim ersten Status-Wechsel auf PRODUCED / COMPLETED / UNCLAIMED.
    // Doppel-Hook-Aufrufe sind dann No-Op.
    stockBookedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
    // IDs der erzeugten inventory-movements (Typ SALES_OUT). Werden bei Storno
    // (Status → ABORTED) fuer Reverse-Lookup verwendet. `Null` toleriert,
    // konsistent zu `stockBookedAt`/`stockReversedAt` — Edge serialisiert
    // ungesetzte nullable SQLite-Spalten als `null` und der Cloud-Sync-Push
    // wuerde sonst mit `must be array` rejecten (Schema-Drift behoben).
    stockMovementIds: Type.Optional(
      Type.Union([Type.Array(Type.String({ format: 'uuid' })), Type.Null()]),
    ),
    // Gesetzt nach erfolgreichem Reversal (SALES_OUT_REVERSAL-Movements).
    // Verhindert Doppel-Reversal bei mehrfachem Status-Wechsel auf ABORTED.
    stockReversedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),

    // TSE-Signatur-Snapshot (KassenSichV). Vom Edge-Hook gesetzt; `Null`
    // toleriert (Edge serialisiert ungesetzte nullable SQLite-Spalten als null).
    tse: Type.Optional(Type.Union([orderTseSchema, Type.Null()])),

    // === Offline-Erfassung (Connect-Tier) ===
    // Markiert eine offline angelegte Order. Der Order-create-Hook im Backend
    // überspringt für markierte Orders das (rückwirkende) TSE-Signieren
    // (KassenSichV: kein Nachsignieren); die finale `dailySequenceNumber` wird
    // serverseitig re-gestempelt. `Null` toleriert (Edge-Sync-Serialisierung).
    offlineCreated: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    // Provisorische, offline lokal vergebene Belegnummer (für den gedruckten
    // Ausfall-Bon + Audit). Bleibt erhalten, auch wenn der Server `dailySequenceNumber`
    // re-stampt.
    provisionalSequenceNumber: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  },
  { $id: 'Order', additionalProperties: false },
)
export type Order = Static<typeof orderSchema>
export type OrderLineItem = Static<typeof orderLineItemSchema>
export type GenericOrderLineItem = Static<typeof genericLineItemSchema>
export type TaxInfo = Static<typeof taxSummerySchema>
export type CustomerPaymentInfo = Static<typeof customerPaymentInfoSchema>
export type StaffPaymentInfo = Static<typeof staffPaymentInfoSchema>
export type Cancellation = Static<typeof cancellationSchema>
export type Discount = Static<typeof discountSchema>
export type AppliedDiscount = Static<typeof appliedDiscountSchema>
export type CreationContext = Static<typeof creationContextSchema>
export type Payment = Static<typeof paymentSchema>
export type Transaction = Static<typeof transactionSchema>
export type OrderTse = Static<typeof orderTseSchema>
//#endregion

//#region Schema for creation (POST)
export const orderDataSchema = Type.Intersect(
  [
    Type.Object({ _id: Type.Optional(Type.String()) }),
    Type.Pick(
      orderSchema,
      [
        'locationId',
        'tenantId',
        'createdAt',
        'updatedAt',
        'status',
        'businessDayId',
        'cashSessionId',
        'orderChannel',
        'dailySequenceNumber',
        'dineLocation',
        'lineItems',
        'cancellation',
        'customerPaymentInfo',
        'discount',
        'appliedDiscounts',
        'staffPaymentInfo',
        'taxSnapshot',
        'creationContext',
        'payment',
        'isFinished',
        'preOrderId',
        'pager',
        'estimatedDuration',
        'remainingTime',
        'table',
        'recordingDate',
        'targetCompletionAt',
        // Stock-Buchungs-Marker werden serverseitig vom Hook gesetzt — hier
        // bewusst erlaubt fuer Sync-Push (Edge sendet Order mit moeglicherweise
        // schon gesetztem Marker, Cloud-Hook prueft idempotent).
        'stockBookedAt',
        'stockMovementIds',
        'stockReversedAt',
        // TSE-Snapshot wird serverseitig vom Signier-Hook gesetzt; fuer Sync-Push
        // erlaubt (Edge sendet die bereits signierte Order an die Cloud).
        'tse',
        // Offline-Erfassungs-Marker (Connect-Tier) — vom POS bei Offline-Anlage
        // gesetzt; steuert den TSE-Skip im create-Hook + bewahrt die Ausfall-Belegnummer.
        'offlineCreated',
        'provisionalSequenceNumber',
      ],
    ),
  ],
  {
    $id: 'OrderData',
    additionalProperties: false,
  },
)
export type OrderData = Static<typeof orderDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const orderPatchSchema = Type.Partial(orderSchema, {
  $id: 'OrderPatch',
})
export type OrderPatch = Static<typeof orderPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const orderQueryProperties = Type.Pick(orderSchema, [
  '_id',
  'businessDayId',
  'createdAt',
  'recordingDate',
  'orderChannel',
  'isFinished',
  'dailySequenceNumber',
  'pager',
  'status',
  'table',
  'dineLocation',
  'updatedAt',
  'locationId',
  'tenantId',
  // Flattened or specific properties could be added if needed
])
export const orderQuerySchema = Type.Intersect(
  [
    querySyntax(orderQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type OrderQuery = Static<typeof orderQuerySchema>
//#endregion
