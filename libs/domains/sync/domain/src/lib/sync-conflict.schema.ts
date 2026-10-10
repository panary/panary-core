import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

export const SyncConflictStatus = {
  OPEN: 'open',
  RESOLVED: 'resolved',
} as const

export type SyncConflictStatus = (typeof SyncConflictStatus)[keyof typeof SyncConflictStatus]

export const SyncConflictResolution = {
  USE_CLOUD: 'use-cloud',
  USE_EDGE: 'use-edge',
  DISCARD: 'discard',
} as const

export type SyncConflictResolution = (typeof SyncConflictResolution)[keyof typeof SyncConflictResolution]

export const SyncConflictReason = {
  // Bootstrap-Konflikte (Cloud-Pull):
  EXTERNAL_ID_MISMATCH: 'external-id-mismatch',
  EXTERNAL_ID_MISSING: 'external-id-missing',
  AMBIGUOUS_NAME_MATCH: 'ambiguous-name-match',
  // Push-Konflikte (Edge → Cloud):
  // Catch-all bei MAX_ATTEMPTS-Eskalation (transient wurde dauerhaft transient,
  // oder die Cloud-Version liefert keine genauere Klassifikation).
  PUSH_REJECTED: 'push-rejected',
  // Tenant-Mismatch: ensureTenantIsolation lehnt den Record ab, weil die
  // tenantId zwischen Edge-Stempel und Cloud-Stand auseinanderlaeuft.
  // Klassischer Cross-Tenant-Konflikt, User muss entscheiden.
  PUSH_FORBIDDEN: 'push-forbidden',
  // Concurrent-Write: Cloud-Record wurde nach `op.occurredAt` modifiziert
  // (Mongoose VersionError oder updatedAt-Vergleich). Edge-Payload und
  // Cloud-Payload divergieren, User waehlt welche Version gewinnt.
  PUSH_CONCURRENT_WRITE: 'push-concurrent-write',
} as const

export type SyncConflictReason = (typeof SyncConflictReason)[keyof typeof SyncConflictReason]

/**
 * Woher ein Konflikt stammt — steuert, was „Verwerfen" bedeutet (#663).
 *
 * - `bootstrap`:    Merge-Konflikt aus dem Cloud-Pull. Verwerfen loescht den
 *                   lokalen Datensatz (mit Rueckfrage im Admin-Panel).
 * - `push-write`:   abgelehnte `create`-/`patch`-Op. Verwerfen loescht ebenfalls
 *                   lokal (mit Rueckfrage).
 * - `push-remove`:  abgelehnte `remove`-Op. Verwerfen laesst nur den
 *                   Loesch-Auftrag fallen; der Datensatz bleibt. Ein `remove` hier
 *                   haette keinen Sinn: Gemeint ist „nicht loeschen", und der
 *                   Datensatz, den es noch gibt, ist meist ein neu geholter mit
 *                   derselben ID.
 */
export const SyncConflictOrigin = {
  BOOTSTRAP: 'bootstrap',
  PUSH_WRITE: 'push-write',
  PUSH_REMOVE: 'push-remove',
} as const

export type SyncConflictOrigin = (typeof SyncConflictOrigin)[keyof typeof SyncConflictOrigin]

const PUSH_REASONS: ReadonlySet<string> = new Set([
  SyncConflictReason.PUSH_REJECTED,
  SyncConflictReason.PUSH_FORBIDDEN,
  SyncConflictReason.PUSH_CONCURRENT_WRITE,
])

/**
 * Leitet den Ursprung aus dem gespeicherten Konflikt ab, ohne eigene Spalte.
 *
 * Der Outbox-Recorder schreibt fuer `remove` als einzige Op `payload: null`
 * (`sync-outbox-recorder.hook.ts`), `create`/`patch` tragen immer den vollen
 * Record. `escalateToConflict` uebernimmt den Payload als `edgePayload`. Ein
 * Push-Konflikt ohne `edgePayload` stammt damit aus einer Loesch-Op — auch bei
 * Bestands-Konflikten, die vor #663 angelegt wurden. Eine Spalte am Konflikt
 * haette genau die nicht erfasst.
 *
 * `'null'` als String deckt den Lesepfad ohne JSON-Hooks ab (text-Spalte, #293).
 */
export const syncConflictOrigin = (conflict: { reason: string; edgePayload?: unknown }): SyncConflictOrigin => {
  if (!PUSH_REASONS.has(conflict.reason)) return SyncConflictOrigin.BOOTSTRAP
  const payload = conflict.edgePayload
  const empty = payload === null || payload === undefined || payload === '' || payload === 'null'
  return empty ? SyncConflictOrigin.PUSH_REMOVE : SyncConflictOrigin.PUSH_WRITE
}

export const syncConflictSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    // Tenant-Affiliation — von der DB-Migration vorgesehen (notNullable),
    // damit der multiTenancy()-Hook seine Filter setzen kann.
    tenantId: Type.String({ format: 'uuid' }),
    locationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    service: Type.String({ minLength: 1, maxLength: 80 }),
    edgeRecordId: Type.String({ format: 'uuid' }),
    cloudRecordId: Type.Optional(Type.String({ format: 'uuid' })),
    reason: StringEnum(Object.values(SyncConflictReason)),
    edgePayload: Type.Optional(Type.Unknown()),
    cloudPayload: Type.Optional(Type.Unknown()),
    status: StringEnum(Object.values(SyncConflictStatus)),
    resolution: Type.Optional(StringEnum(Object.values(SyncConflictResolution))),
    resolvedByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    resolvedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // Virtuell, nicht gespeichert: setzt der Result-Resolver des Edge-Service aus
    // `syncConflictOrigin()`, damit das Admin-Panel die Ableitung nicht nachbaut.
    origin: Type.Optional(StringEnum(Object.values(SyncConflictOrigin))),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'SyncConflict', additionalProperties: false },
)

export type SyncConflict = Static<typeof syncConflictSchema>

// Create-Schema OHNE createdAt/updatedAt: die Timestamps setzt serverseitig der
// Data-Resolver — der laeuft aber NACH validateData. Gegen das volle Schema
// validiert scheitert jede Erst-Anlage ohne manuell mitgestempelte Timestamps
// (BadRequest), siehe fiscal-counters-Regression 2026-07-03. `_id`/`status`
// bleiben Pflicht: beide Sync-Worker (Push-Eskalation + Bootstrap-Merge) geben
// sie explizit mit.
// `origin` ist virtuell (keine Spalte) und darf deshalb nie in einen Insert.
export const syncConflictDataSchema = Type.Omit(syncConflictSchema, ['createdAt', 'updatedAt', 'origin'], {
  $id: 'SyncConflictData',
})
export type SyncConflictData = Static<typeof syncConflictDataSchema>

/**
 * Fachlich ist nur `resolution` patchbar. `tenantId` steht trotzdem drin: Der
 * Edge-Hook `multiTenancy()` stempelt es in `around.all` — also VOR
 * `validateData` in `before.patch`. Mit `additionalProperties: false` scheiterte
 * dadurch JEDER externe Patch mit 400 „validation failed", im Admin-Panel
 * sichtbar als „Mandant: must NOT have additional properties". Konkret hiess
 * das: Offene Konflikte liessen sich ueber die UI ueberhaupt nicht aufloesen —
 * weder „Diesen Standort behalten" noch „Verwerfen" (#183).
 *
 * `Type.Optional` statt Pflicht: interne Aufrufe ohne Nutzerkontext bleiben
 * moeglich. Eine Erlaubnis ist es nicht — der Hook ueberschreibt jeden
 * mitgesendeten Wert, und `syncConflictPatchResolver` verwirft ihn zusaetzlich.
 *
 * Gleiche Klasse wie panary/panary-cloud#200 (fiscal-counter, reservation).
 */
export const syncConflictPatchSchema = Type.Object(
  {
    resolution: StringEnum(Object.values(SyncConflictResolution)),
    tenantId: Type.Optional(Type.String()),
  },
  { $id: 'SyncConflictPatch', additionalProperties: false },
)

export type SyncConflictPatch = Static<typeof syncConflictPatchSchema>

export const syncConflictQueryProperties = Type.Pick(syncConflictSchema, [
  '_id',
  'tenantId',
  'locationId',
  'service',
  'status',
  'reason',
  'edgeRecordId',
])

export const syncConflictQuerySchema = Type.Intersect(
  [querySyntax(syncConflictQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)

export type SyncConflictQuery = Static<typeof syncConflictQuerySchema>
