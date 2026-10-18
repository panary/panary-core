// Rolle des automatisch ausgestellten Geraete-Schluessels (panary/panary-core#762).
//
// Bewusst gegen die echte App auf der migrierten Test-SQLite: Der Fehler lag
// nicht in der Abbildung Typ → Rolle, sondern darin, dass der Resolver das
// Geraet ueber die falsche ID suchte. Eine Spec mit gemocktem devices-Service
// haette genau das nicht gesehen (panary/panary-core#521 pruefte nur
// Schluessel mit `deviceId` = Geraete-`_id`, einen Weg, den kein
// Produktionspfad nimmt).
import assert from 'assert'
import axios from 'axios'
import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

const port = app.get('port')
const appUrl = `http://${app.get('host')}:${port}`

interface DeviceRecord {
  _id: string
  deviceId: string
  apiKeyId?: string
  apiKey?: string
}

const EXPECTED_ROLE: Record<string, string> = {
  'pos-counter': 'device:pos-client',
  kds: 'device:kds',
  tablet: 'device:tablet',
  other: 'device:pos-client',
}

describe('API-Schluessel-Rolle aus dem Geraetetyp (#762)', () => {
  const tenantId = uuidv7()
  let locationId: string
  let ownerToken: string

  const authHeader = () => ({ headers: { Authorization: `Bearer ${ownerToken}` } })

  /** Liest den Schluessel des Geraets ueber `apiKeyId` am frisch gelesenen Geraet. */
  const roleOfDeviceKey = async (deviceRecordId: string): Promise<string> => {
    const device = (await app.service('devices').get(deviceRecordId, { provider: undefined } as never)) as DeviceRecord
    assert.ok(device.apiKeyId, 'Geraet hat keinen API-Schluessel bekommen')
    const key = (await app.service('apikeys').get(device.apiKeyId, { provider: undefined } as never)) as {
      role: string
      deviceId: string
    }
    // Gegenprobe: Der Schluessel haengt am FELD deviceId, nicht an `_id` —
    // genau die Verwechslung, an der der alte Resolver scheiterte.
    assert.strictEqual(key.deviceId, device.deviceId)
    assert.notStrictEqual(key.deviceId, device._id)
    return key.role
  }

  /** Jeder Test raeumt sein Geraet selbst ab (testing.md §10.2); die Kaskade nimmt den Schluessel mit. */
  const cleanupDevice = (deviceRecordId: string) =>
    onTestFinished(async () => {
      await app.service('devices').remove(deviceRecordId, { provider: undefined } as never)
    })

  beforeAll(async () => {
    await app.listen(port)

    const location = (await app.service('locations').create(
      {
        name: 'Filiale Schluesselrolle',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id

    const owner = (await app
      .service('users')
      .create(
        { firstName: 'Olga', lastName: 'Owner', role: 'tenant:owner', tenantId, activeLocationId: locationId } as never,
        { provider: undefined },
      )) as { _id: string }
    ownerToken = await app.service('authentication').createAccessToken({ sub: owner._id })
  })

  afterAll(async () => {
    await app.teardown()
  })

  it.each(Object.entries(EXPECTED_ROLE))('devices.create (intern) Typ %s → Rolle %s', async (type, role) => {
    const device = (await app
      .service('devices')
      .create({ name: `Geraet ${type}`, type, tenantId, locationId } as never, {
        provider: undefined,
      })) as DeviceRecord
    cleanupDevice(device._id)

    assert.strictEqual(await roleOfDeviceKey(device._id), role)
  })

  it.each(Object.entries(EXPECTED_ROLE))('POST /devices Typ %s → Rolle %s', async (type, role) => {
    const { data } = await axios.post<DeviceRecord>(
      `${appUrl}/devices`,
      { name: `REST ${type}`, type, locationId },
      authHeader(),
    )
    cleanupDevice(data._id)
    assert.ok(data.apiKey, 'Show-Once-Schluessel fehlt in der Antwort')

    assert.strictEqual(await roleOfDeviceKey(data._id), role)
  })

  it.each([
    ['kds', 'device:kds'],
    ['tablet', 'device:tablet'],
    ['pos-counter', 'device:pos-client'],
  ])('Pairing-Redeem Typ %s → Rolle %s', async (deviceType, role) => {
    const { data: codeData } = await axios.post<{ code: string }>(
      `${appUrl}/device-pairing/request-code`,
      { locationId },
      authHeader(),
    )
    const { data } = await axios.post<{ deviceId: string; apiKey: string }>(`${appUrl}/device-pairing/redeem`, {
      code: codeData.code,
      deviceName: `Pairing ${deviceType}`,
      deviceType,
    })
    assert.ok(data.apiKey)
    const [paired] = (await app
      .service('devices')
      .find({ query: { deviceId: data.deviceId }, paginate: false, provider: undefined } as never)) as DeviceRecord[]
    cleanupDevice(paired._id)

    const keys = (await app
      .service('apikeys')
      .find({ query: { deviceId: data.deviceId }, paginate: false, provider: undefined } as never)) as {
      role: string
    }[]
    assert.deepStrictEqual(
      keys.map(key => key.role),
      [role],
    )
  })

  it('nicht auffindbares Geraet → Fehler statt stillem Rueckfall auf device:pos-client', async () => {
    await assert.rejects(
      app
        .service('apikeys')
        .create({ name: 'Waise', deviceId: uuidv7(), tenantId, locationId } as never, { provider: undefined }),
      (error: { name?: string }) => error.name === 'BadRequest',
    )
  })

  it('Geraete-`_id` statt `deviceId` → ebenfalls Fehler (kein Treffer ueber die falsche ID)', async () => {
    const device = (await app
      .service('devices')
      .create({ name: 'Falsche ID', type: 'kds', tenantId, locationId } as never, {
        provider: undefined,
      })) as DeviceRecord
    cleanupDevice(device._id)

    await assert.rejects(
      app
        .service('apikeys')
        .create({ name: 'Falsche ID', deviceId: device._id, tenantId, locationId } as never, { provider: undefined }),
      (error: { name?: string }) => error.name === 'BadRequest',
    )
  })

  it('ausdruecklich gesetzte Rolle bleibt unangetastet', async () => {
    const key = (await app
      .service('apikeys')
      .create({ name: 'Integration', role: 'device:kds', tenantId, locationId } as never, {
        provider: undefined,
      })) as { _id: string; role: string }
    onTestFinished(async () => {
      await app.service('apikeys').remove(key._id, { provider: undefined } as never)
    })
    assert.strictEqual(key.role, 'device:kds')
  })
})
