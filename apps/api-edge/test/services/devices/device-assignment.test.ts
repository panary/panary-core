// Durchsetzung der Geraete-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
//
// Bewusst ein Integrationstest gegen die VOLLE Hook-Kette (`provider:
// 'socketio'` erzwingt den externen Pfad) und nicht eine Unit-Spec der Hooks:
// Die Zuweisung ist nur dann eine Sicherheitsgrenze, wenn sie im
// Zusammenspiel aus authorize → multiTenancy → resolveQuery → Adapter greift.
// Eine Hook-Spec mit gefaktem Context wuerde gruen bleiben, waehrend der
// Resolver in der echten Kette gar nicht laeuft — genau die Frage, an der das
// Feature haengt.
//
// Der Angreifer-Blickwinkel ist eingebaut: Jeder Sperr-Test hat eine
// Gegenprobe auf einem `shared`-Geraet, sonst wuerde ein Test, der aus einem
// ganz anderen Grund leer zurueckkommt (falscher Tenant, kaputte Query),
// faelschlich als „Sperre wirkt" durchgehen.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

interface DeviceRecord {
  _id: string
  deviceId: string
}

interface UserRecord {
  _id: string
}

type UsersFindResult = { data?: UserRecord[] } | UserRecord[]

const idsOf = (result: UsersFindResult): string[] =>
  (Array.isArray(result) ? result : (result.data ?? [])).map(user => user._id)

describe('Geraete-Zuweisung — Durchsetzung am Edge', () => {
  const tenantId = uuidv7()
  const foreignTenantId = uuidv7()

  let locationId: string
  let ownerUser: { _id: string; role: string; tenantId: string; activeLocationId: string }

  // Mitarbeiter des Mandanten
  let assignedUserId: string
  let otherPosUserId: string
  let managerUserId: string // Freigabe-Rolle → muss immer sichtbar bleiben
  let foreignTenantUserId: string
  let nonPosUserId: string
  let archivedUserId: string

  let sharedDevice: DeviceRecord
  let assignedDevice: DeviceRecord

  /** Params, wie sie der allowApiKey-Hook fuer ein gepairtes Geraet aufbaut. */
  const deviceParams = (device: DeviceRecord, tenant = tenantId) =>
    ({
      provider: 'socketio',
      authenticated: true,
      user: {
        _id: `device:${device.deviceId}`,
        role: 'device:pos-client',
        tenantId: tenant,
        locationId,
        activeLocationId: locationId,
      },
      authentication: { strategy: 'apiKey', authenticated: true, payload: { apiKey: true, deviceId: device.deviceId } },
    }) as never

  const ownerParams = () => ({ provider: 'rest', authenticated: true, user: ownerUser }) as never

  const createPosUser = async (
    firstName: string,
    overrides: Record<string, unknown> = {},
    tenant = tenantId,
  ): Promise<string> => {
    const created = (await app.service('users').create(
      {
        firstName,
        lastName: 'Zuweisung',
        role: 'tenant:staff',
        isPosUser: true,
        posPin: '1234',
        tenantId: tenant,
        ...overrides,
      } as never,
      { provider: undefined },
    )) as UserRecord
    return created._id
  }

  const createDevice = async (name: string, extra: Record<string, unknown> = {}): Promise<DeviceRecord> =>
    (await app.service('devices').create({ name, type: 'pos-counter', tenantId, locationId, ...extra } as never, {
      provider: undefined,
    })) as DeviceRecord

  beforeAll(async () => {
    await app.setup()

    const location = (await app.service('locations').create(
      {
        name: 'Filiale Zuweisung',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id

    ownerUser = { _id: uuidv7(), role: 'tenant:owner', tenantId, activeLocationId: locationId }

    assignedUserId = await createPosUser('Anna')
    otherPosUserId = await createPosUser('Bruno')
    managerUserId = await createPosUser('Mara', { role: 'tenant:manager' })
    nonPosUserId = await createPosUser('Nico', { isPosUser: false })
    archivedUserId = await createPosUser('Alt', { status: 'ARCHIVED' })
    foreignTenantUserId = await createPosUser('Fremd', {}, foreignTenantId)

    sharedDevice = await createDevice('Theke 1')
    assignedDevice = await createDevice('Diensthandy Anna', {
      deviceAccessMode: 'assigned',
      assignedUserIds: [assignedUserId],
    })
  })

  afterAll(async () => {
    await app.teardown()
  })

  describe('users.find — Scoping des Login-Screens', () => {
    it('shared-Geraet sieht weiterhin alle POS-Benutzer (Gegenprobe)', async () => {
      const result = (await app
        .service('users')
        .find({ query: { $limit: 250 }, ...(deviceParams(sharedDevice) as object) } as never)) as UsersFindResult
      const ids = idsOf(result)

      assert.ok(ids.includes(assignedUserId), 'Anna fehlt auf dem shared-Geraet')
      assert.ok(ids.includes(otherPosUserId), 'Bruno fehlt auf dem shared-Geraet')
      assert.ok(ids.includes(managerUserId), 'Mara fehlt auf dem shared-Geraet')
    })

    it('zugewiesenes Geraet liefert nur Zugewiesene + Freigabe-Rollen', async () => {
      const result = (await app
        .service('users')
        .find({ query: { $limit: 250 }, ...(deviceParams(assignedDevice) as object) } as never)) as UsersFindResult
      const ids = idsOf(result)

      assert.ok(ids.includes(assignedUserId), 'die zugewiesene Anna muss sichtbar sein')
      assert.ok(ids.includes(managerUserId), 'die Freigabe-Rolle muss sichtbar bleiben (Notfallpfade!)')
      assert.ok(!ids.includes(otherPosUserId), 'Bruno darf auf dem Diensthandy NICHT erscheinen')
      assert.ok(!ids.includes(nonPosUserId), 'ein Nicht-POS-Benutzer hat hier nichts zu suchen')
    })

    it('leckt keine Freigabe-Rollen fremder Mandanten', async () => {
      // Der Exempt-Lookup laeuft intern (provider: undefined) — dort stempelt
      // multiTenancy NICHT. Ohne den expliziten tenantId-Filter stuenden hier
      // die Manager aller Mandanten auf dem Login-Screen.
      const result = (await app
        .service('users')
        .find({ query: { $limit: 250 }, ...(deviceParams(assignedDevice) as object) } as never)) as UsersFindResult

      assert.ok(!idsOf(result).includes(foreignTenantUserId), 'Mandantengrenze im Exempt-Lookup verletzt')
    })

    it('eine gezielte $in-Query kann die Sperre nicht erweitern', async () => {
      const result = (await app.service('users').find({
        query: { _id: { $in: [assignedUserId, otherPosUserId] }, $limit: 250 },
        ...(deviceParams(assignedDevice) as object),
      } as never)) as UsersFindResult

      assert.deepStrictEqual(idsOf(result), [assignedUserId], 'die $in-Liste wurde nicht geschnitten')
    })

    it('get-by-id auf einen fremden Mitarbeiter schlaegt fehl', async () => {
      // Der Adapter matcht die Query auch beim get — sonst waere get-by-id der
      // bequeme Umweg um das find-Scoping.
      await assert.rejects(
        () => app.service('users').get(otherPosUserId, deviceParams(assignedDevice)),
        (err: Error) => err.name === 'NotFound' || err.name === 'Forbidden',
        'get-by-id umgeht das Scoping',
      )

      const own = (await app.service('users').get(assignedUserId, deviceParams(assignedDevice))) as UserRecord
      assert.strictEqual(own._id, assignedUserId, 'der eigene Datensatz muss weiterhin ladbar sein')
    })

    it('Geraet ohne Datensatz wird fail-closed abgewiesen, nicht stillschweigend freigegeben', async () => {
      const ghost: DeviceRecord = { _id: uuidv7(), deviceId: uuidv7() }
      await assert.rejects(
        () => app.service('users').find({ query: { $limit: 10 }, ...(deviceParams(ghost) as object) } as never),
        (err: Error) => err.name === 'Forbidden',
        'unbekanntes Geraet bekam die volle Liste',
      )
    })
  })

  describe('users.verifyPin — die Methode am find-Scoping vorbei', () => {
    type VerifyPin = { verifyPin: (data: unknown, params?: unknown) => Promise<Record<string, unknown>> }

    it('zugewiesener Mitarbeiter kann sich anmelden', async () => {
      const service = app.service('users') as unknown as VerifyPin
      const result = await service.verifyPin({ userId: assignedUserId, pin: '1234' }, deviceParams(assignedDevice))
      assert.strictEqual(result['_id'], assignedUserId)
    })

    it('fremder Mitarbeiter wird mit der PIN-Meldung abgelehnt — kein eigener Text als Oracle', async () => {
      const service = app.service('users') as unknown as VerifyPin
      await assert.rejects(
        () => service.verifyPin({ userId: otherPosUserId, pin: '1234' }, deviceParams(assignedDevice)),
        (err: Error) => err.name === 'NotAuthenticated' && err.message === 'PIN ungueltig',
        'die Ablehnung ist von einem falschen PIN unterscheidbar',
      )
    })

    it('auf einem shared-Geraet bleibt derselbe Aufruf erlaubt (Gegenprobe)', async () => {
      const service = app.service('users') as unknown as VerifyPin
      const result = await service.verifyPin({ userId: otherPosUserId, pin: '1234' }, deviceParams(sharedDevice))
      assert.strictEqual(result['_id'], otherPosUserId)
    })

    it('Freigabe-Rolle darf auch am zugewiesenen Geraet ihren PIN eingeben', async () => {
      // Traegt die drei Notfallpfade: Storno, Kassenabschluss, Entkoppeln.
      const service = app.service('users') as unknown as VerifyPin
      const result = await service.verifyPin({ userId: managerUserId, pin: '1234' }, deviceParams(assignedDevice))
      assert.strictEqual(result['_id'], managerUserId)
    })
  })

  describe('devices — Schreibpfad der Zuweisung', () => {
    it('das Geraet selbst kann sich nicht auf shared zuruecksetzen', async () => {
      await assert.rejects(
        () =>
          app
            .service('devices')
            .patch(assignedDevice._id, { deviceAccessMode: 'shared' } as never, deviceParams(assignedDevice)),
        (err: Error) => err.name === 'Forbidden',
        'Self-Patch der Zugriffsentscheidung war moeglich',
      )
    })

    it('Admin darf zuweisen und wieder freigeben', async () => {
      const device = await createDevice('Theke 2')

      const assigned = (await app
        .service('devices')
        .patch(
          device._id,
          { deviceAccessMode: 'assigned', assignedUserIds: [assignedUserId, otherPosUserId] } as never,
          ownerParams(),
        )) as { deviceAccessMode?: string; assignedUserIds?: string[] }
      assert.strictEqual(assigned.deviceAccessMode, 'assigned')
      assert.deepStrictEqual(
        assigned.assignedUserIds,
        [assignedUserId, otherPosUserId],
        'JSON-Feld kam nicht als Array zurueck',
      )

      const back = (await app
        .service('devices')
        .patch(device._id, { deviceAccessMode: 'shared' } as never, ownerParams())) as { deviceAccessMode?: string }
      assert.strictEqual(back.deviceAccessMode, 'shared')
    })

    it('nur die Liste leeren sperrt das Terminal nicht aus — der Teil-Patch wird gegen den Bestand geprueft', async () => {
      const device = await createDevice('Theke 3', {
        deviceAccessMode: 'assigned',
        assignedUserIds: [assignedUserId],
      })

      await assert.rejects(
        () => app.service('devices').patch(device._id, { assignedUserIds: [] } as never, ownerParams()),
        (err: Error) => err.name === 'BadRequest',
        'ein zugewiesenes Geraet konnte auf „niemand" gesetzt werden',
      )
    })

    it.each([
      ['Nicht-POS-Benutzer', () => [nonPosUserId]],
      ['archivierter Mitarbeiter', () => [archivedUserId]],
      ['Mitarbeiter eines fremden Mandanten', () => [foreignTenantUserId]],
      ['unbekannte ID', () => [uuidv7()]],
    ])('lehnt Zuweisung ab: %s', async (_name, ids) => {
      const device = await createDevice(`Theke ${_name}`)
      await assert.rejects(
        () =>
          app
            .service('devices')
            .patch(device._id, { deviceAccessMode: 'assigned', assignedUserIds: ids() } as never, ownerParams()),
        (err: Error) => err.name === 'BadRequest',
        `${_name} wurde akzeptiert`,
      )
    })

    it('lehnt mehr als fuenf Mitarbeiter ab', async () => {
      const device = await createDevice('Theke Ueberzahl')
      const ids = [assignedUserId, otherPosUserId, managerUserId, uuidv7(), uuidv7(), uuidv7()]
      await assert.rejects(
        () =>
          app
            .service('devices')
            .patch(device._id, { deviceAccessMode: 'assigned', assignedUserIds: ids } as never, ownerParams()),
        (err: Error) => err.name === 'BadRequest',
      )
    })

    it('Zuweisung bereits beim Anlegen (Pairing-Redeem-Pfad)', async () => {
      const device = (await createDevice('Diensthandy Bruno', {
        deviceAccessMode: 'assigned',
        assignedUserIds: [otherPosUserId],
      })) as DeviceRecord & { deviceAccessMode?: string; assignedUserIds?: string[] }

      assert.strictEqual(device.deviceAccessMode, 'assigned')
      assert.deepStrictEqual(device.assignedUserIds, [otherPosUserId])
    })
  })
})
