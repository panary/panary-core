import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { MAX_ASSIGNED_USER_IDS } from './device-access-mode'
import { deviceDataSchema, deviceQueryProperties, deviceSchema } from './device.schema'

// Mit derselben AJV-Konfiguration wie der Feathers-`dataValidator`
// (@panary/shared-backend) — `Value.Check` scheitert an StringEnum
// (Type.Unsafe), und genau die Enum-Pruefung ist hier der Punkt. Muster:
// location.schema.spec.ts.
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const makeValidator = (schema: Parameters<typeof getValidator>[0]) =>
  getValidator(schema, addFormats(new Ajv({}), formats))

const validateDevice = makeValidator(deviceSchema)
const validateDeviceData = makeValidator(deviceDataSchema)

const USER_A = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d701'
const USER_B = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d702'

const validDevice = {
  _id: '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e1',
  tenantId: '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e2',
  locationId: '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e3',
  deviceId: '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e4',
  name: 'Kasse 1',
  type: 'pos-counter',
  active: true,
  createdBy: 'setup',
}

const validDeviceData = {
  name: 'Diensthandy Anna',
  type: 'tablet',
}

describe('deviceSchema — Zuweisungs-Felder', () => {
  it('Bestandsgeraet ohne die neuen Felder bleibt gueltig', async () => {
    await expect(validateDevice(validDevice)).resolves.toBeTruthy()
  })

  it('akzeptiert deviceAccessMode + assignedUserIds', async () => {
    await expect(
      validateDevice({ ...validDevice, deviceAccessMode: 'assigned', assignedUserIds: [USER_A, USER_B] }),
    ).resolves.toBeTruthy()
    await expect(validateDevice({ ...validDevice, deviceAccessMode: 'shared' })).resolves.toBeTruthy()
  })

  it('lehnt unbekannte Modus-Werte ab', async () => {
    await expect(validateDevice({ ...validDevice, deviceAccessMode: 'kiosk-only' })).rejects.toThrow()
    await expect(validateDevice({ ...validDevice, deviceAccessMode: null })).rejects.toThrow()
  })

  it(`lehnt mehr als ${MAX_ASSIGNED_USER_IDS} zugewiesene Mitarbeiter ab`, async () => {
    const tooMany = Array.from(
      { length: MAX_ASSIGNED_USER_IDS + 1 },
      (_, i) => `01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7${String(i).padStart(2, '0')}`,
    )
    await expect(validateDevice({ ...validDevice, assignedUserIds: tooMany })).rejects.toThrow()
    await expect(validateDevice({ ...validDevice, assignedUserIds: tooMany.slice(0, -1) })).resolves.toBeTruthy()
  })

  it('lehnt doppelte und nicht-UUID-Eintraege ab', async () => {
    await expect(validateDevice({ ...validDevice, assignedUserIds: [USER_A, USER_A] })).rejects.toThrow()
    await expect(validateDevice({ ...validDevice, assignedUserIds: ['nicht-uuid'] })).rejects.toThrow()
  })
})

describe('deviceDataSchema (POST)', () => {
  // Der Pairing-Redeem-Pfad legt die Zuweisung beim Create an, und
  // `validateData` laeuft auch bei `provider: undefined` — fehlten die Felder
  // hier, verwuerfe `additionalProperties: false` sie mit einem 400.
  it('akzeptiert die Zuweisung bereits beim Anlegen', async () => {
    await expect(
      validateDeviceData({ ...validDeviceData, deviceAccessMode: 'assigned', assignedUserIds: [USER_A] }),
    ).resolves.toBeTruthy()
  })

  it('bleibt ohne die Felder gueltig', async () => {
    await expect(validateDeviceData(validDeviceData)).resolves.toBeTruthy()
  })

  it('lehnt unbekannte Modus-Werte auch beim Create ab', async () => {
    await expect(validateDeviceData({ ...validDeviceData, deviceAccessMode: 'kiosk-only' })).rejects.toThrow()
  })
})

describe('deviceQueryProperties', () => {
  it('erlaubt Filter auf deviceAccessMode', () => {
    expect(Object.keys(deviceQueryProperties.properties)).toContain('deviceAccessMode')
  })

  it('erlaubt KEINEN Filter auf assignedUserIds', () => {
    // Am Edge liegt die Liste als TEXT/JSON in SQLite — ein Gleichheitsvergleich
    // vergliche den serialisierten String und waere still falsch.
    expect(Object.keys(deviceQueryProperties.properties)).not.toContain('assignedUserIds')
  })
})
