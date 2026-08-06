import { Format } from '@sinclair/typebox/format'
import { Value } from '@sinclair/typebox/value'
import { beforeAll, describe, expect, it } from 'vitest'

import { auditActorSchema } from './audit-event.schema'

// TypeBox liefert keine eingebauten Format-Validatoren — in der Feathers-App
// uebernimmt AJV das. Fuer Value.Check registrieren wir die verwendeten
// Formate lokal (analog sync-trigger.schema.spec).
beforeAll(() => {
  if (!Format.Has('uuid')) {
    Format.Set('uuid', value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  }
})

const DEVICE_UUID = '019fa4bc-3ce4-7908-9eb7-0350d192bd97'
const REQUEST_ID = '019fa4ee-ac70-7db3-956f-7c0bbe052e27'

const actor = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  role: 'device:pos-client',
  requestId: REQUEST_ID,
  ...extra,
})

describe('auditActorSchema.userId', () => {
  // Regression: `userId` war auf `format: 'uuid'` gehaertet. Geraete-Sessions
  // (`allow-apikey.hook.ts` → `device:<uuid>`) und fehlgeschlagene Logins
  // (`anonymous`) scheiterten dadurch an der Validierung — jedes Audit-Event
  // einer Kasse ging mit `audit.record_failed` verloren.
  it('akzeptiert die Geraete-Kennung device:<uuid>', () => {
    expect(Value.Check(auditActorSchema, actor(`device:${DEVICE_UUID}`, { deviceId: DEVICE_UUID }))).toBe(true)
  })

  it('akzeptiert den anonymen Akteur fehlgeschlagener Logins', () => {
    expect(Value.Check(auditActorSchema, actor('anonymous'))).toBe(true)
  })

  it('akzeptiert weiterhin eine echte User-UUID', () => {
    expect(Value.Check(auditActorSchema, actor('019f2dfe-0b10-79ce-be36-7b9e8593c25a'))).toBe(true)
  })

  it('bleibt laengenbegrenzt', () => {
    expect(Value.Check(auditActorSchema, actor('x'.repeat(81)))).toBe(false)
  })
})
