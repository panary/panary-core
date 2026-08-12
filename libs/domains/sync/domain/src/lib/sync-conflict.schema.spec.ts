import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { SyncConflictResolution, syncConflictPatchSchema } from './sync-conflict.schema'

// Regression-Anker fuer die Konflikt-Aufloesung im Admin-Panel (#183).
//
// Der Edge-Service `sync-conflicts` registriert `multiTenancy()` in
// `around.all` — der Hook stempelt bei jedem Write `data.tenantId`. `around`
// laeuft VOR `before`, der Validator sieht das Feld also immer. Das
// Patch-Schema kannte nur `resolution` und ist `additionalProperties: false`:
// Jeder Klick auf „Diesen Standort behalten" bzw. „Verwerfen" endete damit auf
// 400 „validation failed" — im Panel als „Mandant: must NOT have additional
// properties" (error-helper mappt tenantId → „Mandant").
//
// Validiert mit derselben AJV-Konfiguration wie der Feathers-`dataValidator`.
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validator = getValidator(syncConflictPatchSchema, addFormats(new Ajv({}), formats))

describe('syncConflictPatchSchema', () => {
  it('akzeptiert den von multiTenancy gestempelten Patch (resolution + tenantId)', async () => {
    await expect(
      validator({ resolution: SyncConflictResolution.USE_EDGE, tenantId: '019ff5ba-3cfa-7cdf-8231-844c4655b4eb' }),
    ).resolves.toBeTruthy()
  })

  it.each(Object.values(SyncConflictResolution))(
    'akzeptiert die Resolution %s mit Tenant-Stempel',
    async resolution => {
      await expect(validator({ resolution, tenantId: 'tenant-1' })).resolves.toBeTruthy()
    },
  )

  it('akzeptiert den Patch weiterhin ohne tenantId (interner Aufruf ohne Nutzerkontext)', async () => {
    await expect(validator({ resolution: SyncConflictResolution.DISCARD })).resolves.toBeTruthy()
  })

  it('verlangt weiterhin eine resolution', async () => {
    await expect(validator({ tenantId: 'tenant-1' })).rejects.toThrow()
  })

  it('lehnt unbekannte Resolutions ab', async () => {
    await expect(validator({ resolution: 'use-whatever', tenantId: 'tenant-1' })).rejects.toThrow()
  })

  it('lehnt weiterhin jedes andere Feld ab — tenantId ist die einzige Ausnahme', async () => {
    await expect(validator({ resolution: SyncConflictResolution.USE_EDGE, status: 'resolved' })).rejects.toThrow()
    await expect(
      validator({ resolution: SyncConflictResolution.USE_EDGE, resolvedByUserId: 'user-1' }),
    ).rejects.toThrow()
    await expect(validator({ resolution: SyncConflictResolution.USE_EDGE, edgePayload: {} })).rejects.toThrow()
  })
})
