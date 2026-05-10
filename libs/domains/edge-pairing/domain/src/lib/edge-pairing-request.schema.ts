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
export const SyncableMasterDataService = {
  PRODUCTS: 'products',
  PRODUCT_GROUPS: 'product-groups',
  USERS: 'users',
  CORPORATE_CUSTOMERS: 'corporate-customers',
  CUSTOMERS: 'customers',
} as const

export type SyncableMasterDataService =
  (typeof SyncableMasterDataService)[keyof typeof SyncableMasterDataService]

export const SyncableTransactionService = {
  ORDERS: 'orders',
  ORDER_INTERACTIONS: 'order-interactions',
  WORKING_TIMES: 'working-times',
  // Tenant-Audit-Trail: Edge ist Schreiber, Cloud ist Source-of-Truth
  // (10-Jahres-Aufbewahrung, GoBD). Append-only auf beiden Seiten.
  AUDIT_EVENTS: 'audit-events',
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
export const masterDataInventorySchema = Type.Object(
  {
    products: Type.Number({ minimum: 0 }),
    productGroups: Type.Number({ minimum: 0 }),
    users: Type.Number({ minimum: 0 }),
    corporateCustomers: Type.Number({ minimum: 0 }),
    customers: Type.Number({ minimum: 0 }),
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
    cloudTenantName: Type.String(),
    cloudLocationId: Type.Optional(Type.String({ format: 'uuid' })),
    cloudLocationName: Type.Optional(Type.String()),
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
