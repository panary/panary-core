import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { notificationPatchSchema } from './notification.schema'
import { notificationPreferencePatchSchema } from './notification-preference.schema'
import { pushSubscriptionPatchSchema } from './push-subscription.schema'

/**
 * Die drei Notifications-Services laufen in `panary-cloud` mit `multiTenancy()`
 * **und** `userScoping()` in `around.all`. Beide Hooks stempeln bei WRITE-Methoden
 * — `patch` zaehlt dazu — in `context.data`:
 *
 *   multiTenancy() → data.tenantId
 *   userScoping()  → data.userId
 *
 * Das passiert VOR `validateData` in `before.patch`. Kennt das Patch-Schema die
 * Felder nicht und steht `additionalProperties: false`, lehnt AJV **jeden**
 * externen Patch mit 400 "validation failed" ab. Genau daran war „Benachrichtigung
 * als gelesen markieren" tot (panary/panary-core#174, panary/panary-cloud#199) —
 * unsichtbar, weil der Store den Fehler verschluckt hat.
 *
 * Die Klasse ist zur Bauzeit nicht erkennbar: Typecheck, Lint und Build sind gruen,
 * der Widerspruch entsteht erst zur Laufzeit zwischen Hook und Schema. Deshalb hier
 * als Laufzeit-Invariante festgenagelt — und bewusst in **beide** Richtungen: Ein
 * Test, der nur „tenantId geht durch" prueft, waere auch mit
 * `additionalProperties: true` gruen, und dann kaeme beliebiger Client-Input
 * ungefiltert bis nach Mongo.
 *
 * Cloud-seitig sind die Felder trotzdem keine Client-Erlaubnis: der jeweilige
 * Patch-Resolver verwirft sie per `protectFromExternal()`.
 */
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const makeValidator = (schema: Parameters<typeof getValidator>[0]) =>
  getValidator(schema, addFormats(new Ajv({}), formats))

const TENANT_ID = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7a1'
const USER_ID = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7a2'
/** Was die Hooks stempeln — in jedem externen Patch unvermeidlich mit drin. */
const STAMPED = { tenantId: TENANT_ID, userId: USER_ID }

const CASES = [
  {
    name: 'notificationPatchSchema',
    validate: makeValidator(notificationPatchSchema),
    // Der Patch, den `NotificationsStore.markRead()` schickt.
    payload: { readAt: '2026-08-11T10:00:00.000Z' },
  },
  {
    name: 'notificationPreferencePatchSchema',
    validate: makeValidator(notificationPreferencePatchSchema),
    payload: { inApp: true, email: false, push: false },
  },
  {
    name: 'pushSubscriptionPatchSchema',
    validate: makeValidator(pushSubscriptionPatchSchema),
    payload: { userAgent: 'Mozilla/5.0', lastUsedAt: '2026-08-11T10:00:00.000Z' },
  },
] as const

describe.each(CASES)('$name — vertraegt die gestempelten Hook-Felder', ({ validate, payload }) => {
  it('validiert den Fach-Patch zusammen mit tenantId + userId', async () => {
    await expect(validate({ ...payload, ...STAMPED })).resolves.toBeTruthy()
  })

  it('validiert den Fach-Patch auch ohne die Stempel (interner Aufruf ohne User)', async () => {
    await expect(validate({ ...payload })).resolves.toBeTruthy()
  })

  it('validiert einen Patch, der nur aus den Stempeln besteht', async () => {
    // `markAllRead()` kann einen bereits gelesenen Eintrag erwischen; uebrig
    // bleibt dann ein Patch, in dem nur noch die Hook-Felder stehen.
    await expect(validate({ ...STAMPED })).resolves.toBeTruthy()
  })

  it('lehnt unbekannte Felder weiterhin ab', async () => {
    await expect(validate({ ...payload, ...STAMPED, hackerFeld: 'x' })).rejects.toThrow()
  })

  it('lehnt einen Stempel mit falschem Typ ab', async () => {
    await expect(validate({ ...payload, tenantId: 'keine-uuid', userId: USER_ID })).rejects.toThrow()
  })
})
