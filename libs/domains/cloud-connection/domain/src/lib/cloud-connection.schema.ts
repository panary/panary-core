import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

//#region Enums & Konstanten
export const PairingStatus = {
  DISCONNECTED: 'disconnected',
  PAIRING: 'pairing',
  CONNECTED: 'connected',
  ERROR: 'error',
} as const

export type PairingStatus = (typeof PairingStatus)[keyof typeof PairingStatus]

export const InitialSyncDirection = {
  BOOTSTRAP_EDGE_TO_CLOUD: 'bootstrap-edge-to-cloud',
  PULL_CLOUD_TO_EDGE: 'pull-cloud-to-edge',
  MERGE_BY_EXTERNAL_ID: 'merge-by-external-id',
} as const

export type InitialSyncDirection = (typeof InitialSyncDirection)[keyof typeof InitialSyncDirection]

export const BootstrapStatus = {
  IDLE: 'idle',
  IN_PROGRESS: 'in-progress',
  DONE: 'done',
  FAILED: 'failed',
} as const

export type BootstrapStatus = (typeof BootstrapStatus)[keyof typeof BootstrapStatus]

export const SyncMode = {
  AUTO: 'auto',
  SCHEDULED: 'scheduled',
  MANUAL: 'manual',
  DISABLED: 'disabled',
} as const

export type SyncMode = (typeof SyncMode)[keyof typeof SyncMode]

export const SYNC_INTERVAL_MIN_SEC = 60
export const SYNC_INTERVAL_MAX_SEC = 3600
export const SYNC_INTERVAL_DEFAULT_SEC = 300

export const DEFAULT_CLOUD_URL = 'https://cloud.panary.io'
//#endregion

//#region Sub-Schemas
// Inventarvergleich beim Pairing — pricelists ist Cloud-only und wird nicht
// synchronisiert, daher hier nicht aufgenommen.
const masterDataInventorySchema = Type.Object(
  {
    products: Type.Number(),
    productGroups: Type.Number(),
    users: Type.Number(),
    corporateCustomers: Type.Number(),
    customers: Type.Number(),
  },
  { additionalProperties: false },
)

const preflightSnapshotSchema = Type.Object(
  {
    cloudTenantId: Type.String(),
    cloudTenantName: Type.String(),
    cloudLocationId: Type.Optional(Type.String()),
    cloudLocationName: Type.Optional(Type.String()),
    cloudInventory: masterDataInventorySchema,
    edgeInventory: masterDataInventorySchema,
    suggestedDirection: StringEnum(Object.values(InitialSyncDirection)),
    requiresTenantIdRestamp: Type.Boolean(),
    // True wenn der Edge seine lokale `locationId` auf die Cloud-locationId
    // umstempel muss (entweder weil eine neue Cloud-Location angelegt wurde
    // oder weil der Cloud-Admin eine bestehende Cloud-Location zugewiesen hat,
    // die nicht mit der lokalen Edge-Location-ID identisch ist).
    requiresLocationIdRestamp: Type.Boolean(),
    // Edge-IDs zum Zeitpunkt des Pairings — Quelle der Wahrheit fuer den
    // Restamp im Bootstrap-Worker. `connection.tenantId`/`connection.locationId`
    // duerfen NICHT genutzt werden, weil sie a) im upsertData nicht initial
    // gesetzt werden (locationId leer) und b) nach dem Restamp auf den Cloud-
    // Wert gepatcht werden — also kein verlaesslicher "alter" Zustand.
    edgeTenantId: Type.Union([Type.String(), Type.Null()]),
    edgeLocationId: Type.Union([Type.String(), Type.Null()]),
    capturedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)

const syncScheduleSchema = Type.Object(
  {
    times: Type.Array(Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { minItems: 1 }),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
)
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const cloudConnectionSchema = Type.Object(
  {
    ...baseSchema,

    cloudUrl: Type.String({ format: 'uri' }),
    cloudToken: Type.Optional(Type.String()),
    cloudEdgeId: Type.Optional(Type.String()),
    pairingStatus: StringEnum(Object.values(PairingStatus)),
    connectedAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastSyncAt: Type.Optional(Type.String({ format: 'date-time' })),
    syncEnabled: Type.Boolean({ default: false }),
    errorMessage: Type.Optional(Type.String()),
    // Auto-Recovery: Vom Sync-Scheduler gesetzt, wenn die Cloud einen 401
    // ('Edge-Token abgelaufen' / 'Cloud-Edge widerrufen') zurueckgibt — der
    // pairingStatus wird gleichzeitig auf DISCONNECTED gesetzt, damit Setup-
    // und POS-Client den Re-Pairing-Bedarf sichtbar machen koennen.
    lastTokenErrorAt: Type.Optional(Type.String({ format: 'date-time' })),
    tokenErrorReason: Type.Optional(Type.String()),
    // Spiegelt das Token-Ablaufdatum aus `cloud-edges.tokenExpiresAt` (Cloud-Seite).
    // Wird vom Sync-Scheduler nach jedem erfolgreichen Sync aktualisiert, damit
    // POS- und Admin-Client den Token-Countdown anzeigen koennen, ohne dass
    // jeder Render einen Cloud-Roundtrip erzeugt.
    edgeTokenExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
    edgeName: Type.Optional(Type.String()),

    // M7.2 Felder
    initialDirection: Type.Optional(StringEnum(Object.values(InitialSyncDirection))),
    bootstrapStatus: Type.Optional(StringEnum(Object.values(BootstrapStatus))),
    bootstrapStartedAt: Type.Optional(Type.String({ format: 'date-time' })),
    bootstrapCompletedAt: Type.Optional(Type.String({ format: 'date-time' })),
    bootstrapResumeToken: Type.Optional(Type.String()),
    bootstrapError: Type.Optional(Type.String()),
    preflightSnapshot: Type.Optional(preflightSnapshotSchema),
    tenantIdRestampedAt: Type.Optional(Type.String({ format: 'date-time' })),
    preTenantIdRestampBackupPath: Type.Optional(Type.String()),

    // ADR §7 Sync-Konfiguration
    syncMode: Type.Optional(StringEnum(Object.values(SyncMode))),
    syncIntervalSec: Type.Optional(Type.Integer({ minimum: SYNC_INTERVAL_MIN_SEC, maximum: SYNC_INTERVAL_MAX_SEC })),
    syncSchedule: Type.Optional(syncScheduleSchema),
    lastManualSyncAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastScheduledSyncAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastClockSkewMs: Type.Optional(Type.Number()),
    outboxBacklog: Type.Optional(Type.Integer({ minimum: 0 })),

    // Optionale User-ID-Allowlist fuer den `bootstrap-edge-to-cloud`-Push.
    // Wenn gesetzt: nur Users mit diesen IDs werden aus dem Edge-Snapshot in
    // die Cloud gepusht. Wenn `undefined`/leer: kein Allowlist-Filter (Default
    // — alle nicht von der Cloud serverseitig blockierten Users werden gepusht).
    // Server-seitiger Filter (Cloud-side `PUSH_BLOCKED_USER_ROLES`) bleibt
    // unabhaengig aktiv (Defense in Depth).
    bootstrapUserAllowlist: Type.Optional(Type.Array(Type.String())),

    // Emergency-Override (Edge-only, nicht zur Cloud syncen):
    // Bei Cloud-Ausfall (>5 min ohne Heartbeat ODER 3 konsekutive Heartbeat-
    // Fehler) öffnet der `cloudManaged`-Hook eine Whitelist für reine
    // `printSettings`-Patches. Lokale Änderungen landen in der Tabelle
    // `pending-local-overrides` (nicht in der Sync-Outbox) und werden beim
    // nächsten erfolgreichen Heartbeat per Reconciliation-Flow mit dem
    // Cloud-Stand abgeglichen. Siehe ADR `emergency-override-adr.md`.
    emergencyOverride: Type.Optional(Type.Boolean({ default: false })),
    emergencyOverrideSince: Type.Optional(Type.String({ format: 'date-time' })),
    lastHeartbeatOk: Type.Optional(Type.String({ format: 'date-time' })),
    consecutiveHeartbeatFailures: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),

    // Business-Days-Pull-Worker: `since`-Cursor fuer incremental Pulls.
    // Wird vom Worker nach jedem erfolgreichen Pull auf `now` gesetzt.
    // `null` (oder fehlend) = erster Pull, ohne `since`-Filter (Cloud
    // antwortet mit allen tenant-Records bis zum `$limit`).
    lastBusinessDaysPullAt: Type.Optional(
      Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    ),

    // Offline-Override (Operator-Action bei Cloud-Outage):
    // Wenn gesetzt und in der Zukunft liegend, darf der Edge im
    // Connected-Modus voruebergehend `rotateBusinessDay()` ausfuehren —
    // sonst blockiert er neue Bestellungen mit `BUSINESS_DAY_NOT_SET`.
    // Wird vom Operator manuell via Admin-Banner gesetzt (Default 2h
    // ab now), beim naechsten erfolgreichen Pull-Tick auf `null`
    // zurueckgesetzt (Auto-Reset).
    offlineOverrideActiveUntil: Type.Optional(
      Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    ),

    // „Cloud erreichbar"-Heartbeat — ENTKOPPELT vom Pull-Cursor
    // `lastBusinessDaysPullAt`. Wird gesetzt, sobald Cloud-Kontakt bestaetigt
    // ist: vom Realtime-Worker waehrend aktiver Socket-Verbindung (lokaler
    // Touch, kein HTTP) UND vom BusinessDays-Pull bei Erfolg. Der Offline-
    // Banner nutzt dieses Feld (statt des Pull-Cursors), weil der Pull im
    // Push-Modus nur noch als langsamer Safety-Net laeuft — der Cursor wuerde
    // sonst faelschlich „stale" wirken, obwohl die Cloud via Socket erreichbar
    // ist. NICHT als Cursor verwenden (kein incremental-since).
    lastCloudContactAt: Type.Optional(
      Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    ),
  },
  { $id: 'CloudConnection', additionalProperties: false },
)

export type CloudConnection = Static<typeof cloudConnectionSchema>
//#endregion

//#region Schema für CRUD-Create der cloud-connection-Entity
// Wizard-Inputs (pairingCode, initialDirection) sind KEINE DB-Felder und gehoeren
// in die Custom-Method-Schemas (cloudConnectionStartBootstrapDataSchema). Hier nur
// echte persistente Felder. Der Edge-Service nutzt diesen Schema-Validator beim
// internen create()-Aufruf aus startBootstrap (via Hook-Pipeline).
export const cloudConnectionDataSchema = Type.Object(
  {
    // tenantId/locationId werden vom multiTenancy-Hook serverseitig gestempelt
    // (überschreiben Client-Werte). Im Schema als Optional erlaubt, damit der
    // Validator die gestempelten Felder nicht als "additional properties"
    // ablehnt.
    tenantId: Type.Optional(Type.String()),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    cloudUrl: Type.String({ format: 'uri' }),
    edgeName: Type.Optional(Type.String({ maxLength: 100 })),
    // Pairing-Result-Felder (vom Bootstrap geschrieben, nicht vom User)
    cloudToken: Type.Optional(Type.String()),
    cloudEdgeId: Type.Optional(Type.String()),
    pairingStatus: Type.Optional(StringEnum(Object.values(PairingStatus))),
    connectedAt: Type.Optional(Type.String({ format: 'date-time' })),
    syncEnabled: Type.Optional(Type.Boolean()),
    initialDirection: Type.Optional(StringEnum(Object.values(InitialSyncDirection))),
    bootstrapStatus: Type.Optional(StringEnum(Object.values(BootstrapStatus))),
    bootstrapStartedAt: Type.Optional(Type.String({ format: 'date-time' })),
    preflightSnapshot: Type.Optional(preflightSnapshotSchema),
    syncMode: Type.Optional(StringEnum(Object.values(SyncMode))),
    syncIntervalSec: Type.Optional(Type.Integer({ minimum: SYNC_INTERVAL_MIN_SEC, maximum: SYNC_INTERVAL_MAX_SEC })),
    bootstrapUserAllowlist: Type.Optional(Type.Array(Type.String())),
  },
  { $id: 'CloudConnectionData', additionalProperties: false },
)

export type CloudConnectionData = Static<typeof cloudConnectionDataSchema>
//#endregion

//#region Schema für Updates (PATCH)
// Erlaubt alle nicht-Identitaets-Felder. Externe Clients (mit provider:rest/socketio)
// duerfen nur die User-controllable Felder setzen — der cloudConnectionPatchResolver
// im Edge-Service filtert Server-managed Felder fuer externe Aufrufe heraus.
// Interne Aufrufe (provider:undefined) — z.B. der Bootstrap-Worker — duerfen
// alle Felder schreiben.
export const cloudConnectionPatchSchema = Type.Partial(
  Type.Pick(cloudConnectionSchema, [
    // User-controllable
    'cloudUrl',
    'syncEnabled',
    'edgeName',
    'syncMode',
    'syncIntervalSec',
    'syncSchedule',
    // Server-managed (Bootstrap-Worker + Pairing-Flow + Sync-Scheduler)
    'cloudToken',
    'cloudEdgeId',
    'pairingStatus',
    'connectedAt',
    'lastSyncAt',
    'errorMessage',
    'lastTokenErrorAt',
    'tokenErrorReason',
    'initialDirection',
    'bootstrapStatus',
    'bootstrapStartedAt',
    'bootstrapCompletedAt',
    'bootstrapResumeToken',
    'bootstrapError',
    'preflightSnapshot',
    'tenantIdRestampedAt',
    'preTenantIdRestampBackupPath',
    'lastManualSyncAt',
    'lastScheduledSyncAt',
    'lastClockSkewMs',
    'outboxBacklog',
    'bootstrapUserAllowlist',
    // Emergency-Override-Felder (vom Sync-Scheduler gesetzt)
    'emergencyOverride',
    'emergencyOverrideSince',
    'lastHeartbeatOk',
    'consecutiveHeartbeatFailures',
    // Business-Days-Pull-Cursor + Offline-Override (siehe Hauptschema oben)
    'lastBusinessDaysPullAt',
    'offlineOverrideActiveUntil',
    'lastCloudContactAt',
    // tenantId/locationId fuer den Re-Stamp-Flow im Bootstrap-Worker
    'tenantId',
    'locationId',
  ]),
  { $id: 'CloudConnectionPatch' },
)

export type CloudConnectionPatch = Static<typeof cloudConnectionPatchSchema>
//#endregion

//#region Schema für Suchanfragen (Query)
export const cloudConnectionQueryProperties = Type.Pick(cloudConnectionSchema, [
  '_id',
  'tenantId',
  'pairingStatus',
  'bootstrapStatus',
  'syncEnabled',
])
export const cloudConnectionQuerySchema = Type.Intersect(
  [querySyntax(cloudConnectionQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)

export type CloudConnectionQuery = Static<typeof cloudConnectionQuerySchema>
//#endregion

//#region Wizard / Custom-Method Schemas
export const cloudConnectionPreflightDataSchema = Type.Object(
  {
    cloudUrl: Type.String({ format: 'uri' }),
    pairingCode: Type.String({ minLength: 6, maxLength: 6 }),
    edgeName: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { $id: 'CloudConnectionPreflightData', additionalProperties: false },
)
export type CloudConnectionPreflightData = Static<typeof cloudConnectionPreflightDataSchema>

// Preflight ist read-only: kein DB-Eintrag, daher keine cloudConnectionId.
// Der Bootstrap-Schritt erzeugt den Eintrag erst.
export const cloudConnectionPreflightResultSchema = Type.Object(
  {
    cloudTenantId: Type.String({ format: 'uuid' }),
    cloudTenantName: Type.String(),
    cloudLocationId: Type.Optional(Type.String({ format: 'uuid' })),
    cloudInventory: masterDataInventorySchema,
    edgeInventory: masterDataInventorySchema,
    suggestedDirection: StringEnum(Object.values(InitialSyncDirection)),
    requiresTenantIdRestamp: Type.Boolean(),
  },
  { $id: 'CloudConnectionPreflightResult', additionalProperties: false },
)
export type CloudConnectionPreflightResult = Static<typeof cloudConnectionPreflightResultSchema>

// Bootstrap fuehrt Cloud-Pair + DB-Upsert atomar aus. Alle Wizard-Inputs werden
// hier mitgegeben — der Edge haelt zwischen Preflight und Bootstrap keinen State.
export const cloudConnectionStartBootstrapDataSchema = Type.Object(
  {
    cloudUrl: Type.String({ format: 'uri' }),
    pairingCode: Type.String({ minLength: 6, maxLength: 6 }),
    edgeName: Type.String({ minLength: 1, maxLength: 100 }),
    initialDirection: StringEnum(Object.values(InitialSyncDirection)),
    confirmDataLoss: Type.Boolean(),
    // Optional — nur fuer `bootstrap-edge-to-cloud` relevant. Wenn gesetzt,
    // pusht der Worker ausschliesslich Users mit diesen IDs. Wenn `undefined`/
    // leer, gilt der Default (alle vom serverseitigen Filter erlaubten Users).
    bootstrapUserAllowlist: Type.Optional(Type.Array(Type.String())),
  },
  { $id: 'CloudConnectionStartBootstrapData', additionalProperties: false },
)
export type CloudConnectionStartBootstrapData = Static<typeof cloudConnectionStartBootstrapDataSchema>

export const cloudConnectionSyncNowResultSchema = Type.Object(
  {
    pushed: Type.Integer({ minimum: 0 }),
    pulled: Type.Integer({ minimum: 0 }),
    durationMs: Type.Integer({ minimum: 0 }),
    lastError: Type.Optional(Type.String()),
  },
  { $id: 'CloudConnectionSyncNowResult', additionalProperties: false },
)
export type CloudConnectionSyncNowResult = Static<typeof cloudConnectionSyncNowResultSchema>
//#endregion
