import type { Static } from '@feathersjs/typebox'
import { Type } from '@feathersjs/typebox'

export const SYNC_PULL_MAX_LIMIT = 500
export const SYNC_PULL_DEFAULT_LIMIT = 200

export const syncPullQuerySchema = Type.Object(
  {
    service: Type.String({ minLength: 1, maxLength: 80 }),
    since: Type.Optional(Type.String({ format: 'date-time' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SYNC_PULL_MAX_LIMIT })),
    cursor: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { $id: 'SyncPullQuery', additionalProperties: false },
)

export type SyncPullQuery = Static<typeof syncPullQuerySchema>

export const syncPullRecordSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    updatedAt: Type.String({ format: 'date-time' }),
    deletedAt: Type.Optional(Type.String({ format: 'date-time' })),
    record: Type.Optional(Type.Unknown()),
  },
  { $id: 'SyncPullRecord', additionalProperties: false },
)

export type SyncPullRecord = Static<typeof syncPullRecordSchema>

export const syncPullResponseSchema = Type.Object(
  {
    service: Type.String({ maxLength: 80 }),
    records: Type.Array(syncPullRecordSchema),
    nextCursor: Type.Optional(Type.String()),
    hasMore: Type.Boolean(),
    serverTimestamp: Type.String({ format: 'date-time' }),
    /**
     * Visibility-Snapshot: vollstaendige Liste aller `_id`s, die fuer diese
     * Edge aktuell sichtbar sein sollten — nach Anwendung aller Filter
     * (tenantId, locationId, role-blocklist).
     *
     * Wird **nur beim Initial-Pull** (`since=undefined`, `cursor=undefined`)
     * geliefert. Der Edge nutzt sie zur Reconciliation: lokale IDs, die nicht
     * im Snapshot sind, gehoeren nicht mehr zu dieser Filiale (z.B. weil
     * `allowedLocationIds` reduziert wurde) und werden lokal auf
     * `status: ARCHIVED` gesetzt — nicht geloescht, weil Working-Times,
     * Orders etc. weiterhin auf den User referenzieren.
     *
     * Folge-Pulls mit `since` haben kein `visibilitySnapshot` (waeren teuer
     * und meist unnoetig — die Reconciliation laeuft beim naechsten Initial-
     * Pull oder beim Edge-Restart).
     */
    visibilitySnapshot: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
  },
  { $id: 'SyncPullResponse', additionalProperties: false },
)

export type SyncPullResponse = Static<typeof syncPullResponseSchema>
