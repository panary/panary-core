import { Format } from '@sinclair/typebox/format'
import { Value } from '@sinclair/typebox/value'
import { beforeAll, describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { AuditAction } from './audit-action.enum'
import { AuditCategory, AuditOutcome, AuditSeverity } from './audit-category.enum'
import { auditActorSchema, auditEventDataSchema } from './audit-event.schema'

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

/**
 * panary/panary-core#435: Die Cloud protokolliert Datenexporte mit `action: 'EXPORT'`
 * (panary/panary-cloud#695). Fehlt der Wert im Enum, scheitert `validateData` am
 * `enum`-Keyword und das Export-Event geht verloren. Geprüft wird am String-Literal —
 * mit der Konstante wäre nach Streichen des Werts `undefined` validiert worden, und
 * der Test fiele am `required`-Keyword statt am Enum.
 */
describe('auditEventDataSchema — action EXPORT', () => {
  const formats: FormatsPluginOptions = ['date-time', 'uuid']
  const validate = getValidator(auditEventDataSchema, addFormats(new Ajv({}), formats))

  const exportEvent = (action: string) => ({
    _id: '019fa4bc-3ce4-7908-9eb7-0350d192bd01',
    tenantId: '019fa4bc-3ce4-7908-9eb7-0350d192bd02',
    locationId: null,
    occurredAt: '2026-09-28T12:00:00.000Z',
    actor: actor('019f2dfe-0b10-79ce-be36-7b9e8593c25a', { role: 'OWNER' }),
    target: { resource: 'catalog-export', entityType: 'catalog', entityId: '019fa4bc-3ce4-7908-9eb7-0350d192bd02' },
    action,
    category: AuditCategory.ACCESS,
    outcome: AuditOutcome.SUCCESS,
    severity: AuditSeverity.NOTICE,
    correlationId: REQUEST_ID,
  })

  // Leere Liste = angenommen. Als Liste statt `resolves`, damit ein Fehlschlag das
  // AJV-Keyword nennt — `enum` statt eines anonymen „validation failed".
  async function rejectionKeywords(action: string): Promise<string[]> {
    try {
      await validate(exportEvent(action) as never)
      return []
    } catch (error) {
      return ((error as { errors?: { keyword: string }[] }).errors ?? []).map(e => e.keyword)
    }
  }

  it('nimmt ein Export-Event an', async () => {
    expect(await rejectionKeywords('EXPORT')).toEqual([])
    expect(AuditAction.EXPORT).toBe('EXPORT')
  })

  it('lehnt eine unbekannte Aktion am enum-Keyword ab (Gegenprobe)', async () => {
    expect(await rejectionKeywords('READ')).toContain('enum')
  })
})
