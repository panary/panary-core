import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

//#region Enums & Constants

// Dokumenttyp-Diskriminator (ADR beleg-bon-system, D6):
//  - SALE              = steuerlicher Beleg i.S.d. §146a AO (pos-cashier, mit TSE)
//  - ORDER_CONFIRMATION = Service-Bestellbestätigung (orders-only, KEIN Beleg i.S.d. AO)
//  - CANCELLATION      = Storno-Beleg (referenziert das Original via voidedReceiptId)
export const ReceiptKind = {
  SALE: 'sale',
  ORDER_CONFIRMATION: 'order-confirmation',
  CANCELLATION: 'cancellation',
} as const

export const ReceiptStatus = {
  ISSUED: 'issued',
  VOIDED: 'voided',
} as const

// Auslieferungskanäle (ADR D-Kanäle). QR ist Default; NFC/E-Mail/Druck folgen
// in späteren Phasen. `channelsUsed` protokolliert, worüber ein Beleg ausgegeben
// wurde (Audit, DSGVO-Nachvollziehbarkeit).
export const ReceiptChannel = {
  QR: 'qr',
  NFC: 'nfc',
  EMAIL: 'email',
  WALLET: 'wallet',
  PRINT: 'print',
} as const

// Spiegelt order.PaymentState/TransactionMethod (bewusst dupliziert, um eine
// Cross-Domain-Abhängigkeit receipts→orders zu vermeiden — gleiches Muster wie
// der eingebettete order.tse-Snapshot).
export const ReceiptPaymentMethod = {
  CASH: 'cash',
  CARD: 'card',
  ONLINE: 'online',
  OTHER: 'other',
} as const

export const ReceiptPaymentState = {
  PENDING: 'pending',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  REFUNDED: 'refunded',
} as const

// TSE-Signierstatus (KassenSichV) — strukturgleich zu order.OrderTseStatus.
export const ReceiptTseStatus = {
  STARTED: 'started',
  SIGNED: 'signed',
  FAILED: 'failed',
  UNAVAILABLE: 'unavailable',
} as const
//#endregion

//#region Sub-Schemas (strukturelle Order-Snapshots — bewusst dupliziert)

// Steuer-Aufschlüsselung je Satz (= order.taxSummarySchema). Trägt die
// Mehrsatz-Aufteilung (z. B. 7 % / 19 %) als Source of Truth des Belegs.
export const receiptTaxSummarySchema = Type.Object(
  {
    taxes: Type.Array(
      Type.Object(
        {
          taxRate: Type.Number({ minimum: 0, maximum: 100 }),
          // amount = Netto-Bemessungsgrundlage dieses Satzes; tax = Steuerbetrag.
          amount: Type.Number(),
          tax: Type.Number(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 50 },
    ),
    netto: Type.Number(),
    brutto: Type.Number(),
  },
  { additionalProperties: false },
)

// Belegposition (DSFinV-K-/DFKA-Taxonomie-nahe Semantik, D9): reduzierter,
// fiskalisch relevanter Snapshot einer order.lineItem — NICHT die volle interne
// Order-Zeilenstruktur (modifiers/components/recipeReferences bleiben intern).
// Monetäre Werte in Währungseinheiten wie in der Order (keine Cent-Umrechnung —
// die DSFinV-K-Cent-Konvertierung ist ein Export-Concern in Phase 5).
export const receiptLineItemSchema = Type.Object(
  {
    externalId: Type.Optional(Type.String({ format: 'uuid' })),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    quantity: Type.Number({ minimum: 0 }),
    unitPrice: Type.Number({ minimum: 0 }),
    lineTotal: Type.Number({ minimum: 0 }),
    taxRate: Type.Number({ minimum: 0, maximum: 100 }),
  },
  { additionalProperties: false },
)
export type ReceiptLineItem = Static<typeof receiptLineItemSchema>

// Verkäufer-Snapshot (Pflichtangabe „Name + Anschrift des Unternehmers",
// §6 KassenSichV). Aus der Location + invoiceSettings zum Ausstellzeitpunkt
// eingefroren — spätere Stammdaten-Änderungen verändern ausgestellte Belege nicht.
export const receiptSellerSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    address: Type.Optional(Type.String({ maxLength: 400 })),
    taxNumber: Type.Optional(Type.String({ maxLength: 60 })),
    vatId: Type.Optional(Type.String({ maxLength: 60 })),
  },
  { additionalProperties: false },
)
export type ReceiptSeller = Static<typeof receiptSellerSchema>

// Eingebetteter TSE-Snapshot (KassenSichV) — strukturell identisch zu
// order.orderTseSchema. `transactionNumber` ist die fiskalisch relevante,
// lückenlose Belegnummer (ADR D5): es wird KEIN vierter Zähler eingeführt.
export const receiptTseSchema = Type.Object(
  {
    status: StringEnum(Object.values(ReceiptTseStatus)),
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
  },
  { additionalProperties: false },
)
export type ReceiptTse = Static<typeof receiptTseSchema>
//#endregion

//#region The main data model (schema)

// Persistenter elektronischer Beleg (§146a AO). Immutables, ausgestelltes
// Artefakt — die strukturierten Daten sind die Source of Truth (ADR D1/D3);
// PDF/PNG sind nur deterministische Renderings (renderHash als Audit-Anker).
export const receiptSchema = Type.Object(
  {
    ...baseSchema,
    _id: Type.String({ format: 'uuid' }),

    kind: StringEnum(Object.values(ReceiptKind)),
    status: StringEnum(Object.values(ReceiptStatus)),

    // Nicht-fiskalische interne Belegnummer (Auffindbarkeit / DSFinV-K).
    // Die fiskalische Nummer ist tse.transactionNumber (ADR D5).
    receiptNumber: Type.Optional(Type.String({ maxLength: 64 })),

    orderId: Type.String({ format: 'uuid' }),
    dailySequenceNumber: Type.Number({ minimum: 0 }),
    issuedAt: Type.String({ format: 'date-time' }),
    currency: Type.String({ default: 'EUR', pattern: '^[A-Z]{3}$' }),

    // === Strukturierter Snapshot = Source of Truth ===
    lineItems: Type.Array(receiptLineItemSchema, { maxItems: 500 }),
    taxSummary: receiptTaxSummarySchema,
    totalGross: Type.Number({ minimum: 0 }),
    paymentMethod: Type.Optional(StringEnum(Object.values(ReceiptPaymentMethod))),
    paymentState: Type.Optional(StringEnum(Object.values(ReceiptPaymentState))),
    seller: receiptSellerSchema,
    // Fiskal-Block — nur im Kassenmodus (sale) gesetzt. `Null` toleriert (Edge
    // serialisiert ungesetzte nullable SQLite-Spalten als null beim Sync-Push).
    tse: Type.Optional(Type.Union([receiptTseSchema, Type.Null()])),

    // === Abruf + Audit ===
    // Nicht-enumerierbarer HMAC-Token; Basis der öffentlichen Abruf-URL
    // (receipts.panary.io/r/<token>). Backend-gemintet (kein Client-Wert).
    token: Type.String({ minLength: 16, maxLength: 128 }),
    channelsUsed: Type.Array(StringEnum(Object.values(ReceiptChannel)), { maxItems: 8 }),
    // sha256(canonicalReceiptJson(snapshot)) — beweist Unveränderbarkeit der
    // strukturierten Daten; ETag der Render-Auslieferung.
    renderHash: Type.String({ minLength: 16, maxLength: 80 }),
    retainUntil: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
    voidedReceiptId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),

    // Soft-Delete-Marker für Sync-Tombstones (Edge→Cloud).
    _deletedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  },
  { $id: 'Receipt', additionalProperties: false },
)
export type Receipt = Static<typeof receiptSchema>
//#endregion

//#region Schema for creation (POST)
// Belege werden serverseitig vom issue-receipt-Hook erzeugt (provider: undefined);
// das Data-Schema erlaubt die gestempelten Felder (tenantId/locationId/createdAt)
// für den internen Create + den Edge→Cloud-Sync-Push.
export const receiptDataSchema = Type.Intersect(
  [
    Type.Object({ _id: Type.Optional(Type.String({ format: 'uuid' })) }),
    Type.Pick(receiptSchema, [
      'tenantId',
      'locationId',
      'createdAt',
      'updatedAt',
      'kind',
      'status',
      'receiptNumber',
      'orderId',
      'dailySequenceNumber',
      'issuedAt',
      'currency',
      'lineItems',
      'taxSummary',
      'totalGross',
      'paymentMethod',
      'paymentState',
      'seller',
      'tse',
      'token',
      'channelsUsed',
      'renderHash',
      'retainUntil',
      'voidedReceiptId',
      '_deletedAt',
    ]),
  ],
  { $id: 'ReceiptData', additionalProperties: false },
)
export type ReceiptData = Static<typeof receiptDataSchema>
//#endregion

//#region Schema for updates (PATCH)
export const receiptPatchSchema = Type.Partial(receiptSchema, { $id: 'ReceiptPatch' })
export type ReceiptPatch = Static<typeof receiptPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const receiptQueryProperties = Type.Pick(receiptSchema, [
  '_id',
  'tenantId',
  'locationId',
  'kind',
  'status',
  'orderId',
  'token',
  'createdAt',
  'updatedAt',
  '_deletedAt',
])
export const receiptQuerySchema = Type.Intersect(
  [querySyntax(receiptQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type ReceiptQuery = Static<typeof receiptQuerySchema>
//#endregion
