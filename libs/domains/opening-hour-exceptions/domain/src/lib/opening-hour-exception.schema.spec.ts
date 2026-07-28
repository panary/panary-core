import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { openingHourExceptionDataSchema } from './opening-hour-exception.schema'

// Regression Standort-Settings-Sync (2026-07-28): Das Data-Schema war ein
// striktes Omit von `_id`/`createdAt`/`updatedAt`. Die Cloud materialisiert
// Feiertage/Schliesstage aber als fertige Records, die der Edge-Pull-Apply
// per CREATE mit dem KOMPLETTEN Record uebernimmt (die _ids sind am Edge
// immer neu) → validateData verwarf jeden Record, der Service konnte
// strukturell nie synchronisieren. AJV-Konfiguration identisch zum
// Feathers-`dataValidator` (@panary/shared-backend).
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validator = getValidator(openingHourExceptionDataSchema, addFormats(new Ajv({}), formats))

const syncedCloudException = {
  _id: '01890a5d-ac96-774b-bcce-b302099a8060',
  tenantId: '01890a5d-ac96-774b-bcce-b302099a8058',
  locationId: '01890a5d-ac96-774b-bcce-b302099a8057',
  date: '2026-12-24',
  label: 'Heiligabend',
  closed: true,
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T12:00:00.000Z',
}

describe('openingHourExceptionDataSchema (Sync-Pull-Apply-CREATE)', () => {
  it('akzeptiert einen kompletten Cloud-Record inkl. _id/createdAt/updatedAt', async () => {
    await expect(validator(syncedCloudException)).resolves.toBeTruthy()
  })

  it('lehnt unbekannte Felder weiterhin ab (kein Wildcard-Passthrough)', async () => {
    await expect(validator({ ...syncedCloudException, evilField: 'x' })).rejects.toThrow()
  })
})
