import { querySyntax, Static, Type } from '@feathersjs/typebox'

/**
 * Tenant-User Web-Push-Subscription (eigenständig — **nicht** mit
 * `platform-push-subscription` verwechseln, das ist nur für Plattform-User
 * im Cloud-Admin-Kontext).
 *
 * Lifecycle:
 *  - Frontend ruft `pushManager.subscribe(...)` und persistiert das volle
 *    `subscription.toJSON()`-Result via POST.
 *  - Sender ruft beim Versand `webPush.sendNotification(subscription, payload)`.
 *  - Bei `410 Gone`/`404`-Antwort: Subscription auto-löschen.
 *
 * Security:
 *  - `keys.p256dh` + `keys.auth` werden via `resolveExternal` aus REST-
 *    Responses gestrippt (sensitive — würden Push-Versand von außen erlauben).
 *  - Endpoint kommt **ausschließlich** vom Browser-PushManager, nicht aus
 *    User-Input → keine SSRF-Whitelist nötig.
 */
export const pushSubscriptionSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    tenantId: Type.String({ format: 'uuid' }),
    userId: Type.String({ format: 'uuid' }),

    endpoint: Type.String({ minLength: 1, maxLength: 1000 }),
    keys: Type.Object({
      p256dh: Type.String({ minLength: 1, maxLength: 500 }),
      auth: Type.String({ minLength: 1, maxLength: 500 }),
    }),

    userAgent: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    /**
     * Optional: letzter erfolgreicher Versand. Wird vom Sender geupdated,
     * damit Stale-Subscriptions (älter als z.B. 30 Tage ohne Push) später
     * von einem Cleanup-Job abgeräumt werden können.
     */
    lastUsedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),

    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'PushSubscription', additionalProperties: false },
)
export type PushSubscription = Static<typeof pushSubscriptionSchema>

export const pushSubscriptionDataSchema = Type.Pick(
  pushSubscriptionSchema,
  ['endpoint', 'keys', 'userAgent'],
  { $id: 'PushSubscriptionData', additionalProperties: false },
)
export type PushSubscriptionData = Static<typeof pushSubscriptionDataSchema>

export const pushSubscriptionPatchSchema = Type.Partial(
  Type.Pick(pushSubscriptionSchema, ['userAgent', 'lastUsedAt']),
  { $id: 'PushSubscriptionPatch', additionalProperties: false },
)
export type PushSubscriptionPatch = Static<typeof pushSubscriptionPatchSchema>

const queryProperties = Type.Pick(pushSubscriptionSchema, [
  '_id',
  'tenantId',
  'userId',
  'endpoint',
])
export const pushSubscriptionQuerySchema = Type.Intersect(
  [querySyntax(queryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type PushSubscriptionQuery = Static<typeof pushSubscriptionQuerySchema>
