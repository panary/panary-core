import type { Static } from '@feathersjs/typebox'
import { StringEnum, Type } from '@feathersjs/typebox'

export const InitialSyncDirection = {
  BOOTSTRAP_EDGE_TO_CLOUD: 'bootstrap-edge-to-cloud',
  PULL_CLOUD_TO_EDGE: 'pull-cloud-to-edge',
  MERGE_BY_EXTERNAL_ID: 'merge-by-external-id',
} as const

export type InitialSyncDirection = (typeof InitialSyncDirection)[keyof typeof InitialSyncDirection]

// Pricelists ist ein reines Cloud-Feature (Tier-1-SaaS) und wird zwischen Edge
// und Cloud NICHT synchronisiert. Daher hier nicht aufgenommen — auch nicht im
// MasterDataInventory-Vergleich beim Pairing.
//
// LOCATIONS: Cloud ist Source of Truth für Standort-Stammdaten (Öffnungszeiten,
// Feiertage, Tische, Pager). Edge zieht read-only per Pull-Sync. Schreibzugriff
// am Edge wird über `cloudManaged()`-Hook auf dem `locations`-Service
// blockiert, sobald die Edge gepaart ist. Nicht im `MasterDataInventory`-
// Vergleich, weil per Edge eine 1:1-Zuordnung zur Cloud-Filiale gilt — keine
// Inventur-Differenz möglich.
export const SyncableMasterDataService = {
  PRODUCTS: 'products',
  PRODUCT_GROUPS: 'product-groups',
  USERS: 'users',
  CORPORATE_CUSTOMERS: 'corporate-customers',
  CUSTOMERS: 'customers',
  // Rabatt-Definitionen: Cloud ist Source of Truth (Admin-CRUD), Edge zieht
  // read-only per Pull-Sync (cloudManaged-Guard blockt Edge-Writes nach Pairing).
  // Keine FK-Abhängigkeit zu ORDERS — klassischer Master-Daten-Block.
  DISCOUNTS: 'discounts',
  LOCATIONS: 'locations',
  // Feiertage/Schließtage: Cloud materialisiert die holiday-calendars-Regel in
  // konkrete opening-hour-exceptions-Rows (closed:true je Datum) und synct sie
  // 1:1 read-only zum Edge. Cloud ist Source of Truth — der Edge-Service ist
  // beim Pairing cloudManaged. Keine FK-Ordnungsabhängigkeit zu ORDERS.
  OPENING_HOUR_EXCEPTIONS: 'opening-hour-exceptions',
  // OoS-Welle E Item 4: Tenant-Doc als Master-Data zum Edge syncen
  // (Receipt-Header/Footer, Branding, Localization). Pull-Service muss
  // eine **Allowlist-Projection** anwenden (apps/api-cloud/src/services/
  // sync/projections/tenant-projection.ts) — Stripe/TSE/SecurityPolicy/
  // internalNotes bleiben Cloud-only.
  // NIEMALS in SyncableTransactionService aufnehmen — Edge darf Tenants
  // nicht zurueckschreiben.
  TENANTS: 'tenants',
  // BusinessDays werden im Hybrid-Modell (siehe panary-cloud-Plan
  // `okay-wir-gehen-in-generic-leaf.md`) ausschliesslich Cloud-seitig
  // erzeugt/transitioniert. Edge zieht den Lifecycle als Master-Data via
  // Pull-Sync, schreibt aber niemals zurueck — deshalb NICHT in
  // SyncableTransactionService. Wichtig: BUSINESS_DAYS muss VOR ORDERS
  // gepullt werden (FK-Logik: order.businessDayId verweist darauf). Die
  // Object-Insertion-Order in diesem Enum bestimmt heute die Pull-Reihenfolge
  // des Bootstrap-Workers — daher gehoert es vor dem Locations-Block, aber
  // nach den klassischen Master-Daten. Cloud-managed-Hook am Edge
  // (apps/api-edge/src/services/business-days/business-days.ts: guard) blockt
  // direkte Schreibversuche auf dem Edge-Service.
  BUSINESS_DAYS: 'businessdays',
} as const

export type SyncableMasterDataService =
  (typeof SyncableMasterDataService)[keyof typeof SyncableMasterDataService]

export const SyncableTransactionService = {
  ORDERS: 'orders',
  ORDER_INTERACTIONS: 'order-interactions',
  WORKING_TIMES: 'working-times',
  // Kassen-Sessions (Multi-Kassen-Tagesabschluss): EDGE ist Schreiber (Kassierer
  // eröffnet/zählt/schließt seine Lade offline am POS), Cloud aggregiert sie beim
  // Tagesabschluss. Edge→Cloud-Push; der Cloud-recompute-Hook füllt
  // cashSalesCents/Varianz autoritativ aus den (gesyncten) Bestellungen.
  // FK: cash-session.businessDayId → businessdays (Master-Data, bereits in Cloud).
  CASH_SESSIONS: 'cash-sessions',
  // Tenant-Audit-Trail: Edge ist Schreiber, Cloud ist Source-of-Truth
  // (10-Jahres-Aufbewahrung, GoBD). Append-only auf beiden Seiten.
  AUDIT_EVENTS: 'audit-events',
  // Users werden zusaetzlich zur Master-Data-Pull-Pipeline auch live als
  // transactional Push propagiert — z.B. posPin-Wechsel im POS-Client soll
  // ohne Wartezeit auf den naechsten Master-Pull in der Cloud landen. Cloud
  // filtert sicherheitskritische Rollen ueber SYNC_PUSH_BLOCKED_USER_ROLES
  // (siehe acceptOps in apps/api-cloud/src/services/sync/sync.ts).
  USERS: 'users',
} as const

export type SyncableTransactionService =
  (typeof SyncableTransactionService)[keyof typeof SyncableTransactionService]

export const edgeIdentitySchema = Type.Object(
  {
    edgeName: Type.String({ minLength: 1, maxLength: 100 }),
    localTenantId: Type.String({ format: 'uuid' }),
    localLocationId: Type.Optional(Type.String({ format: 'uuid' })),
    edgeVersion: Type.String({ maxLength: 50 }),
    platform: Type.Optional(Type.String({ maxLength: 50 })),
    // Stammdaten der lokalen Edge-Location — Cloud nutzt diese Felder, wenn der
    // Pairing-Code "neuen Standort anlegen" signalisiert (suggestedLocationId
    // ist undefined). Sonst ignoriert die Cloud sie und uebernimmt die in
    // suggestedLocationId referenzierte bestehende Location.
    locationEmail: Type.Optional(Type.String({ format: 'email' })),
    locationPhone: Type.Optional(Type.String({ maxLength: 50 })),
  },
  { $id: 'EdgeIdentity' },
)

export type EdgeIdentity = Static<typeof edgeIdentitySchema>

// Inventarvergleich beim Pairing — nur Entitaeten, die zwischen Edge und Cloud
// tatsaechlich synchronisiert werden. Pricelists ist Cloud-only und nicht hier.
//
// `businessDays` ist optional, weil aeltere Edge-Versionen (vor Phase 4 des
// BusinessDay-Hybrid-Plans) das Feld noch nicht mitschicken. Cloud akzeptiert
// 0 als Default wenn ungesetzt — der Pairing-Pfad bleibt damit backward-
// kompatibel.
export const masterDataInventorySchema = Type.Object(
  {
    products: Type.Number({ minimum: 0 }),
    productGroups: Type.Number({ minimum: 0 }),
    users: Type.Number({ minimum: 0 }),
    corporateCustomers: Type.Number({ minimum: 0 }),
    customers: Type.Number({ minimum: 0 }),
    businessDays: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: 'MasterDataInventory', additionalProperties: false },
)

export type MasterDataInventory = Static<typeof masterDataInventorySchema>

export const preflightRequestSchema = Type.Object(
  {
    pairingCode: Type.String({ minLength: 6, maxLength: 6 }),
    edgeIdentity: edgeIdentitySchema,
    edgeInventory: masterDataInventorySchema,
  },
  { $id: 'PreflightRequest', additionalProperties: false },
)

export type PreflightRequest = Static<typeof preflightRequestSchema>

export const preflightResponseSchema = Type.Object(
  {
    cloudTenantId: Type.String({ format: 'uuid' }),
    cloudTenantName: Type.String({ maxLength: 200 }),
    cloudLocationId: Type.Optional(Type.String({ format: 'uuid' })),
    cloudLocationName: Type.Optional(Type.String({ maxLength: 200 })),
    cloudInventory: masterDataInventorySchema,
    suggestedDirection: StringEnum(Object.values(InitialSyncDirection)),
    requiresTenantIdRestamp: Type.Boolean(),
    serverTimestamp: Type.String({ format: 'date-time' }),
  },
  { $id: 'PreflightResponse', additionalProperties: false },
)

export type PreflightResponse = Static<typeof preflightResponseSchema>

export const edgePairingRequestSchema = Type.Object(
  {
    pairingCode: Type.String({ minLength: 6, maxLength: 6 }),
    edgeIdentity: edgeIdentitySchema,
    initialDirection: StringEnum(Object.values(InitialSyncDirection)),
    edgeInventory: masterDataInventorySchema,
  },
  { $id: 'EdgePairingRequest', additionalProperties: false },
)

export type EdgePairingRequest = Static<typeof edgePairingRequestSchema>

export const edgePairingResponseSchema = Type.Object(
  {
    cloudToken: Type.String(),
    cloudTokenExpiresAt: Type.String({ format: 'date-time' }),
    cloudEdgeId: Type.String({ format: 'uuid' }),
    cloudTenantId: Type.String({ format: 'uuid' }),
    cloudLocationId: Type.Optional(Type.String({ format: 'uuid' })),
    serverTimestamp: Type.String({ format: 'date-time' }),
  },
  { $id: 'EdgePairingResponse', additionalProperties: false },
)

export type EdgePairingResponse = Static<typeof edgePairingResponseSchema>
