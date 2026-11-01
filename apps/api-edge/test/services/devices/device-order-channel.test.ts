// Standard-Bestellart je Terminal (panary/panary-core#1166): Rollen-Gate gegen die VOLLE
// Hook-Kette (`provider` erzwingt den externen Pfad). Eine Hook-Spec mit gefaktem Context
// bliebe gruen, auch wenn die Reihenfolge in devices.ts das Gate umgeht.
// Jeder Sperr-Test hat eine Gegenprobe mit erlaubter Rolle, sonst ginge ein Test, der aus
// ganz anderem Grund scheitert (falscher Tenant, kaputter Body), als „Sperre wirkt" durch.
// Jeder Test legt sein Geraet selbst an (testing.md §10.2): geteilt ist hier die Zeile, nicht die Bindung.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

interface DeviceRecord {
  _id: string
  deviceId: string
  name?: string
  defaultOrderChannel?: string | null
}

describe('Standard-Bestellart — Rollen-Gate am Edge', () => {
  const tenantId = uuidv7()
  let locationId: string

  const actor = (role: string) => {
    const user = { _id: uuidv7(), role, tenantId, activeLocationId: locationId, locationId }
    return { provider: 'rest', authenticated: true, user } as never
  }

  const devicePosParams = (device: DeviceRecord) =>
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

  /** `initial` geht per internem Patch hinein: Das Feld steht bewusst nicht in `deviceDataSchema` (Redeem setzt es nicht). */
  const createDevice = async (initial?: string): Promise<DeviceRecord> => {
    const device = (await app
      .service('devices')
      .create({ name: `Terminal ${uuidv7()}`, type: 'pos-counter', tenantId, locationId } as never, {
        provider: undefined,
      })) as DeviceRecord
    if (initial) {
      await app.service('devices').patch(device._id, { defaultOrderChannel: initial } as never, { provider: undefined })
    }
    onTestFinished(async () => {
      await app.service('devices').remove(device._id, { provider: undefined })
    })
    return device
  }

  const load = async (device: DeviceRecord) =>
    (await app.service('devices').get(device._id, { provider: undefined })) as DeviceRecord

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
  })

  afterAll(async () => {
    await app.teardown()
  })

  it('Bestandsgeraet ohne Wert liest null (Migration: nullable Spalte)', async () => {
    const device = await createDevice()
    assert.ok((await load(device)).defaultOrderChannel == null)
  })

  it('Owner setzt und setzt zurueck', async () => {
    const device = await createDevice()

    await app.service('devices').patch(device._id, { defaultOrderChannel: 'telephone' } as never, actor('tenant:owner'))
    assert.strictEqual((await load(device)).defaultOrderChannel, 'telephone')

    await app.service('devices').patch(device._id, { defaultOrderChannel: null } as never, actor('tenant:owner'))
    assert.ok((await load(device)).defaultOrderChannel == null)
  })

  it('platform:owner darf ebenfalls', async () => {
    const device = await createDevice()
    await app.service('devices').patch(device._id, { defaultOrderChannel: 'pos' } as never, actor('platform:owner'))
    assert.strictEqual((await load(device)).defaultOrderChannel, 'pos')
  })

  it('Techniker (devices: MANAGE) wird fuer dieses Feld mit 403 abgewiesen — Setzen UND Zuruecksetzen', async () => {
    const device = await createDevice('pos')

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
    assert.strictEqual((await load(device)).defaultOrderChannel, 'pos', 'der Wert darf sich nicht veraendert haben')
  })

  it('Gegenprobe: derselbe Techniker darf andere Felder weiterhin patchen', async () => {
    const device = await createDevice()
    await app.service('devices').patch(device._id, { name: 'Telefon-Terminal 2' } as never, actor('tenant:technician'))
    assert.strictEqual((await load(device)).name, 'Telefon-Terminal 2')
  })

  it('das Geraet selbst kann den Wert nicht aendern (kein Self-Patch-Feld)', async () => {
    const device = await createDevice('pos')

    await assert.rejects(
      app.service('devices').patch(device._id, { defaultOrderChannel: 'telephone' } as never, devicePosParams(device)),
      forbidden,
    )
    assert.strictEqual((await load(device)).defaultOrderChannel, 'pos')
  })

  it('Owner: unbekannter Kanal → 400, Wert bleibt', async () => {
    const device = await createDevice('pos')

    await assert.rejects(
      app.service('devices').patch(device._id, { defaultOrderChannel: 'online' } as never, actor('tenant:owner')),
      (err: Error) => err.name === 'BadRequest',
    )
    assert.strictEqual((await load(device)).defaultOrderChannel, 'pos')
  })

  it('interner Aufruf (Seed, Pairing) ist erlaubt', async () => {
    const device = await createDevice()
    await app
      .service('devices')
      .patch(device._id, { defaultOrderChannel: 'telephone' } as never, { provider: undefined })
    assert.strictEqual((await load(device)).defaultOrderChannel, 'telephone')
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
