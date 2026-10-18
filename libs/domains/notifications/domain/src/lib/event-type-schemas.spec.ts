import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { notificationDataSchema } from './notification.schema'
import { notificationPreferenceDataSchema } from './notification-preference.schema'

/**
 * Beide Schemas bauen die `eventType`-Union aus `Object.values(NotificationEventType)`.
 * Fehlt ein Typ dort, lehnt die Cloud den Insert mit 400 ab — der Glocken-Eintrag
 * bzw. die Preference wird nie geschrieben, und der Aufrufer sieht nur einen
 * verschluckten Fehler im Sender.
 *
 * Die Typen stehen hier bewusst als **String**, nicht als Konstante: Preferences
 * speichern den String, eine Umbenennung der Konstante darf ihn nicht still
 * mitändern (Kommentar an `NotificationEventType`).
 */
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const makeValidator = (schema: Parameters<typeof getValidator>[0]) =>
  getValidator(schema, addFormats(new Ajv({}), formats))

const TENANT_ID = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7a1'
const USER_ID = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7a2'

const CASES = [
  {
    name: 'notificationDataSchema',
    validate: makeValidator(notificationDataSchema),
    // Der Glocken-Eintrag, den panary/panary-cloud#1295 beim Tenant-Owner schreibt.
    payload: (eventType: string) => ({
      tenantId: TENANT_ID,
      userId: USER_ID,
      eventType,
      severity: 'warning',
      title: 'Konto gesperrt',
    }),
  },
  {
    name: 'notificationPreferenceDataSchema',
    validate: makeValidator(notificationPreferenceDataSchema),
    // Der Record, den die Preferences-Page beim ersten Umschalten anlegt.
    payload: (eventType: string) => ({
      tenantId: TENANT_ID,
      userId: USER_ID,
      eventType,
      inApp: true,
      email: false,
      push: false,
    }),
  },
] as const

describe.each(CASES)('$name — eventType', ({ validate, payload }) => {
  it("nimmt 'account.locked' an", async () => {
    await expect(validate(payload('account.locked'))).resolves.toBeTruthy()
  })

  it('lehnt einen unbekannten Typ weiterhin ab', async () => {
    // Ohne diesen Fall waere der Test oben auch mit einer offenen `Type.String()` gruen.
    await expect(validate(payload('account.unknown'))).rejects.toThrow()
  })
})
