// Standard-Bestellart je Terminal (panary/panary-core#1166): Rollen-Gate gegen die VOLLE
// Hook-Kette (`provider` erzwingt den externen Pfad). Eine Hook-Spec mit gefaktem Context
// bliebe gruen, auch wenn die Reihenfolge in devices.ts das Gate umgeht.
// Jeder Sperr-Test hat eine Gegenprobe mit erlaubter Rolle, sonst ginge ein Test, der aus
// ganz anderem Grund scheitert (falscher Tenant, kaputter Body), als „Sperre wirkt" durch.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

interface DeviceRecord {
  _id: string
  deviceId: string
  defaultOrderChannel?: string | null
}

describe('Standard-Bestellart — Rollen-Gate am Edge', () => {
  const tenantId = uuidv7()
  let locationId: string
  let device: DeviceRecord

  const actor = (role: string) => {
    const user = { _id: uuidv7(), role, tenantId, activeLocationId: locationId, locationId }
    return { provider: 'rest', authenticated: true, user } as never
  }

  const devicePosParams = () =>
    ({
      provider: 'socketio',
      authenticated: true,
      user: {
        _id: `device:${device.deviceId}`,
        role: 'device:pos-client',
        tenantId,
        locationId,
        activeLocationId: locationId,
      },
      authentication: { strategy: 'apiKey', authenticated: true, payload: { apiKey: true, deviceId: device.deviceId } },
    }) as never

  const stored = async () =>
    ((await app.service('devices').get(device._id, { provider: undefined })) as DeviceRecord).defaultOrderChannel

  const forbidden = (err: Error) => err.name === 'Forbidden'

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Filiale Bestellart',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id
    device = (await app
      .service('devices')
      .create({ name: 'Telefon-Terminal', type: 'pos-counter', tenantId, locationId } as never, {
        provider: undefined,
      })) as DeviceRecord
  })

  afterAll(async () => {
    await app.teardown()
  })

  it('Bestandsgeraet ohne Wert liest null (Migration: nullable Spalte)', async () => {
    assert.ok((await stored()) == null)
  })

  it('Owner setzt und setzt zurueck', async () => {
    await app.service('devices').patch(device._id, { defaultOrderChannel: 'telephone' } as never, actor('tenant:owner'))
    assert.strictEqual(await stored(), 'telephone')

    await app.service('devices').patch(device._id, { defaultOrderChannel: null } as never, actor('tenant:owner'))
    assert.ok((await stored()) == null)
  })

  it('platform:owner darf ebenfalls', async () => {
    await app.service('devices').patch(device._id, { defaultOrderChannel: 'pos' } as never, actor('platform:owner'))
    assert.strictEqual(await stored(), 'pos')
  })

  it('Techniker (devices: MANAGE) wird fuer dieses Feld mit 403 abgewiesen — Setzen UND Zuruecksetzen', async () => {
    await assert.rejects(
      app
        .service('devices')
        .patch(device._id, { defaultOrderChannel: 'telephone' } as never, actor('tenant:technician')),
      forbidden,
    )
    await assert.rejects(
      app.service('devices').patch(device._id, { defaultOrderChannel: null } as never, actor('tenant:technician')),
      forbidden,
    )
    assert.strictEqual(await stored(), 'pos', 'der Wert darf sich nicht veraendert haben')
  })

  it('Gegenprobe: derselbe Techniker darf andere Felder weiterhin patchen', async () => {
    await app.service('devices').patch(device._id, { name: 'Telefon-Terminal 2' } as never, actor('tenant:technician'))
    const after = (await app.service('devices').get(device._id, { provider: undefined })) as { name: string }
    assert.strictEqual(after.name, 'Telefon-Terminal 2')
  })

  it('das Geraet selbst kann den Wert nicht aendern (kein Self-Patch-Feld)', async () => {
    await assert.rejects(
      app.service('devices').patch(device._id, { defaultOrderChannel: 'telephone' } as never, devicePosParams()),
      forbidden,
    )
    assert.strictEqual(await stored(), 'pos')
  })

  it('Owner: unbekannter Kanal → 400, Wert bleibt', async () => {
    await assert.rejects(
      app.service('devices').patch(device._id, { defaultOrderChannel: 'online' } as never, actor('tenant:owner')),
      (err: Error) => err.name === 'BadRequest',
    )
    assert.strictEqual(await stored(), 'pos')
  })

  it('interner Aufruf (Seed, Pairing) ist erlaubt', async () => {
    await app
      .service('devices')
      .patch(device._id, { defaultOrderChannel: 'telephone' } as never, { provider: undefined })
    assert.strictEqual(await stored(), 'telephone')
  })

  it('Create ist gleich gegated: Techniker kann ein Geraet nicht mit Wert anlegen', async () => {
    await assert.rejects(
      app
        .service('devices')
        .create(
          { name: 'Neu', type: 'pos-counter', tenantId, locationId, defaultOrderChannel: 'pos' } as never,
          actor('tenant:technician'),
        ),
      forbidden,
    )
  })
})
