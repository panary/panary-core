import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

//#region Enums & Constants (Reusable)
/**
 * Art des Bezugs zwischen zwei Vorgaengen.
 *
 * Die Werte sind bewusst die deutschen DSFinV-K-Bezeichner aus `Bon_Referenzen`
 * (Feld `REF_TYP`) und nicht englische Konstanten: Sie wandern 1:1 in den
 * DSFinV-K-Export, und eine Uebersetzungstabelle dazwischen waere eine
 * zusaetzliche Fehlerquelle an einer pruefungsrelevanten Stelle.
 */
export const OrderReferenceType = {
  /** Bezug auf einen anderen Kassenvorgang (Grundfall). */
  TRANSAKTION: 'Transaktion',
  /** Der referenzierte Vorgang wurde storniert. */
  STORNO: 'Storno',
  /** Der referenzierte Vorgang wurde in mehrere Vorgaenge aufgeteilt. */
  SPLIT: 'Split',
  /** Positionen wurden zwischen Vorgaengen umgebucht. */
  UMBUCHUNG: 'Umbuchung',
} as const
//#endregion

//#region The main data model (schema)
export const orderReferenceSchema = Type.Object(
  {
    ...baseSchema,

    refType: StringEnum(Object.values(OrderReferenceType)),

    /**
     * Der **referenzierte** (urspruengliche) Vorgang — DSFinV-K `REF_BON_ID`.
     * Immer gesetzt: Eine Referenz ohne Ursprung hat keinen Aussagewert.
     */
    sourceOrderId: Type.String({ format: 'uuid' }),

    /**
     * Der Vorgang, der die Referenz **erzeugt** hat.
     *
     * Optional, und das ist kein Versehen: Ein **Storno** legt keinen neuen
     * Vorgang an — er setzt den bestehenden auf `ABORTED`. Dort gibt es nichts,
     * worauf `targetOrderId` zeigen koennte, und ein Selbstverweis auf
     * `sourceOrderId` waere eine Luege ueber die Datenlage. Beim **Split**
     * dagegen ist es die neu entstandene Teilbestellung.
     */
    // 🚨 `Type.Null()` ist hier Pflicht, nicht Kosmetik: SQLite liefert eine
    // ungesetzte Spalte als `null` zurueck, und der Sync-Push schickt den
    // Record unveraendert an die Cloud. Ohne den Null-Zweig lehnt die Cloud
    // ihn ab, und `classifyAcceptError` stuft das als TERMINAL ein — Outbox
    // `rejected`, kein Retry, kein Alarm. Gleiche Konstruktion wie
    // `order.stockBookedAt` und aus demselben Grund.
    targetOrderId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),

    // === Zustand des referenzierten Vorgangs zum Zeitpunkt der Referenzierung ===
    // Diese drei Felder sind bewusst KOPIEN und keine Joins. Das Gutachten zu
    // panary/panary-core#345 (10.3 Punkt 4) verlangt, dass historische Bezuege
    // nachtraeglich rekonstruierbar bleiben — ein Join gegen die Bestellung
    // liefert den HEUTIGEN Stand, nicht den zum Zeitpunkt des Bezugs.
    /** DSFinV-K `REF_DATUM` — Zeitpunkt des referenzierten Vorgangs. */
    refDate: Type.String({ format: 'date-time' }),
    /** Analog DSFinV-K `REF_Z_KASSE_ID` — Filiale des referenzierten Vorgangs. */
    refLocationId: Type.String({ format: 'uuid' }),
    /**
     * Analog DSFinV-K `REF_Z_NR` — Geschaeftstag des referenzierten Vorgangs.
     *
     * Optional, weil `order.businessDayId` es ebenfalls ist: Im Standalone-Modus
     * laeuft die Kasse ohne Geschaeftstag. Ein Pflichtfeld haette hier den
     * schlechtesten aller Ausgaenge — der Referenz-Create scheiterte an
     * `validateData`, und weil der schreibende Hook best-effort ist, waere der
     * Datensatz LAUTLOS ausgeblieben. Ein fehlender Wert ist ehrlicher als ein
     * erfundener.
     */
    refBusinessDayId: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])),
  },
  { $id: 'OrderReference', additionalProperties: false },
)
export type OrderReference = Static<typeof orderReferenceSchema>
//#endregion

//#region Schema for creation (POST)
const orderReferencePickedDataSchema = Type.Pick(orderReferenceSchema, [
  'refType',
  'sourceOrderId',
  'targetOrderId',
  'refDate',
  'refLocationId',
  'refBusinessDayId',
  'createdAt',
  'updatedAt',
])

// `_id` beim Create optional: der Resolver setzt `value || uuidv7()`. Offline am
// Edge erzeugte Records UND der Sync-Push (Edge→Cloud) bringen die bereits
// generierte _id mit — ohne diese Erlaubnis lehnt die Cloud den Sync-Create mit
// „additional properties [field: _id]" ab. Gleiche Struktur wie
// orderInteractionDataSchema (fuer den Sync-Push erprobt).
export const orderReferenceDataSchema = Type.Intersect(
  [
    Type.Object({ _id: Type.Optional(Type.String()) }),
    // `tenantId`/`locationId` optional: serverseitig von `multiTenancy()`
    // gestempelt. Als Pflichtfelder waere die 400-Meldung bei fehlgeschlagenem
    // Stempel irrefuehrend (ADR 0031 in panary-cloud).
    Type.Partial(Type.Pick(orderReferenceSchema, ['tenantId', 'locationId'])),
    orderReferencePickedDataSchema,
  ],
  {
    $id: 'OrderReferenceData',
    additionalProperties: false,
  },
)
export type OrderReferenceData = Static<typeof orderReferenceDataSchema>
//#endregion

// 🚨 BEWUSST KEIN Patch-Schema. `order-references` ist append-only (ADR 0048):
// Der Service registriert nur find/get/create, ein SQLite-Trigger blockt UPDATE
// und DELETE zusaetzlich auf DB-Ebene. Ein exportiertes `…PatchSchema` waere
// eine Einladung, spaeter `patch` zu registrieren — die Abwesenheit ist hier
// die Dokumentation. Vorbild: audit-events.

//#region Schema for search queries (query)
export const orderReferenceQueryProperties = Type.Pick(orderReferenceSchema, [
  '_id',
  'refType',
  'sourceOrderId',
  'targetOrderId',
  'refBusinessDayId',
  // Pflicht fuer multiTenancy()-Hook (filtert query.tenantId/locationId) und
  // fuer den Sync-Backfill (`createdAt > since`) bzw. Sync-Pull (`updatedAt > since`).
  'tenantId',
  'locationId',
  'createdAt',
  'updatedAt',
])
export const orderReferenceQuerySchema = Type.Intersect(
  [
    querySyntax(orderReferenceQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type OrderReferenceQuery = Static<typeof orderReferenceQuerySchema>
//#endregion
