import { querySyntax, Static, Type } from '@feathersjs/typebox'

import { NotificationEventType } from './notification-event'

/**
 * Pro User + Event-Typ ein Record. Wenn kein Record existiert, gilt die
 * `NOTIFICATION_EVENT_META[event].defaults`-Matrix (Server-seitig im Sender
 * aufgelöst). Erst beim ersten Toggle in der UI schreibt das Frontend einen
 * Record — vermeidet Bootstrap-Logic beim User-Anlegen.
 *
 * Owner-Modell wie `notifications`: `tenantId` + `userId` als Composite-Owner.
 */
export const notificationPreferenceSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    tenantId: Type.String({ format: 'uuid' }),
    userId: Type.String({ format: 'uuid' }),

    eventType: Type.Union(
      (Object.values(NotificationEventType) as string[]).map(v => Type.Literal(v)),
    ),

    inApp: Type.Boolean(),
    email: Type.Boolean(),
    push: Type.Boolean(),

    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'NotificationPreference', additionalProperties: false },
)
export type NotificationPreference = Static<typeof notificationPreferenceSchema>

export const notificationPreferenceDataSchema = Type.Pick(
  notificationPreferenceSchema,
  ['tenantId', 'userId', 'eventType', 'inApp', 'email', 'push'],
  { $id: 'NotificationPreferenceData', additionalProperties: false },
)
export type NotificationPreferenceData = Static<typeof notificationPreferenceDataSchema>

export const notificationPreferencePatchSchema = Type.Partial(
  Type.Pick(notificationPreferenceSchema, ['inApp', 'email', 'push']),
  { $id: 'NotificationPreferencePatch', additionalProperties: false },
)
export type NotificationPreferencePatch = Static<typeof notificationPreferencePatchSchema>

const queryProperties = Type.Pick(notificationPreferenceSchema, [
  '_id',
  'tenantId',
  'userId',
  'eventType',
])
export const notificationPreferenceQuerySchema = Type.Intersect(
  [querySyntax(queryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type NotificationPreferenceQuery = Static<typeof notificationPreferenceQuerySchema>
