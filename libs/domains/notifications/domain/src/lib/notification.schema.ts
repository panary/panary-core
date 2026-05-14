import { querySyntax, Static, Type } from '@feathersjs/typebox'

import { NOTIFICATION_EVENT_META, NotificationEventType, NotificationSeverity } from './notification-event'

/**
 * Persistierte In-App-Benachrichtigung — **eine Row pro Empfänger**.
 *
 * Owner-Modell:
 *  - `tenantId` — Mandanten-Isolation (Pflicht, vom `multiTenancy`-Hook gestempelt)
 *  - `userId` — Empfänger; nur er sieht/patcht den Datensatz (`userScoping`-Hook)
 *
 * Lifecycle:
 *  - `readAt = null` → ungelesen (zählt in Bell-Badge)
 *  - `readAt = ISO-String` → gelesen
 *
 * Fan-Out: Wenn ein Event N Empfänger hat, schreibt der Sender N Rows. Storage
 * pro Event selten >5 Empfänger; vereinfacht Read/Update massiv (kein
 * read-state-Subdokument).
 *
 * TTL: 90 Tage ab `createdAt` (Mongo-TTL-Index in der Service-Registration).
 */
export const notificationSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    tenantId: Type.String({ format: 'uuid' }),
    userId: Type.String({ format: 'uuid' }),

    // Event-Klassifizierung
    eventType: Type.Union(
      (Object.values(NotificationEventType) as string[]).map(v => Type.Literal(v)),
    ),
    severity: Type.Union(
      (Object.values(NotificationSeverity) as string[]).map(v => Type.Literal(v)),
    ),

    // UI-Anzeige
    title: Type.String({ minLength: 1, maxLength: 200 }),
    body: Type.Optional(Type.String({ maxLength: 1000 })),
    /**
     * Tiefer Link in die App (z.B. `/staff/leave-requests/<id>`). Frontend
     * navigiert dahin beim Click. **Pflicht-Validierung im Frontend**: nur
     * relativ-Pfade akzeptieren, keine `http(s)://`-Links — schützt vor
     * Open-Redirect via manipuliertem Notification-Payload.
     */
    actionUrl: Type.Optional(Type.String({ maxLength: 500 })),

    /**
     * Auslöser-Quelle für Audit/Debug. Beispiel: `leave-request:abc-123`,
     * `shift-swap:xy-789`. Keine Geschäfts-Logik daran knüpfen — nur
     * Diagnose.
     */
    sourceRef: Type.Optional(Type.String({ maxLength: 200 })),

    // Status
    readAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),

    // Audit
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'Notification', additionalProperties: false },
)
export type Notification = Static<typeof notificationSchema>

/**
 * Create-Schema — der Sender stempelt `tenantId` + `userId` explizit
 * (Hook ignoriert sie bei internem `provider: undefined`-Call).
 * Server-Resolver setzt `_id`, `createdAt`, `updatedAt`, `readAt: null`.
 */
export const notificationDataSchema = Type.Pick(
  notificationSchema,
  ['tenantId', 'userId', 'eventType', 'severity', 'title', 'body', 'actionUrl', 'sourceRef'],
  { $id: 'NotificationData', additionalProperties: false },
)
export type NotificationData = Static<typeof notificationDataSchema>

/**
 * Patch — **nur** `readAt` ist externes patchable. Alle anderen Felder werden
 * via Resolver auf `undefined` gesetzt (`protectFromExternal`-Pattern aus
 * `code-style.md §9.8`).
 */
export const notificationPatchSchema = Type.Partial(
  Type.Pick(notificationSchema, ['readAt']),
  { $id: 'NotificationPatch', additionalProperties: false },
)
export type NotificationPatch = Static<typeof notificationPatchSchema>

const queryProperties = Type.Pick(notificationSchema, [
  '_id',
  'tenantId',
  'userId',
  'eventType',
  'severity',
  'readAt',
  'createdAt',
])
export const notificationQuerySchema = Type.Intersect(
  [querySyntax(queryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type NotificationQuery = Static<typeof notificationQuerySchema>

// Re-exports für ergonomischen Import
export { NotificationEventType, NotificationSeverity, NOTIFICATION_EVENT_META }
export type { NotificationEventMeta } from './notification-event'
