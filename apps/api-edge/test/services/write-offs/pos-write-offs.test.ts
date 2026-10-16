// Abschreibungen am Edge (panary/panary-core#635).
//
// Bis hierher speicherte der POS-Dialog über `app.service('write-offs')` ins Leere: Am Edge gab es
// keinen Service, und `device:pos-client` hatte kein Recht auf die Ressource. Jetzt: Der Edge legt
// die Abschreibung an, rechnet sie dem Bediener aus dem Bediener-Token zu (ADR 0053) und schreibt
// einen Outbox-Eintrag für den Push in die Cloud, die dort den Bestand einmal bucht.
//
// Über die echte Hook-Kette mit Geräte-Verbindung, gegen die migrierte Test-SQLite
// (test/global-setup.ts). Die Tabelle ist append-only (Trigger): Abschreibungen bleiben nach dem
// Lauf liegen, jeder Test nutzt deshalb einen eigenen Tenant-Kontext über uuidv7-IDs
// (testing.md §10.2). Die Outbox-Einträge räumt jeder Test selbst ab.
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { app } from '../../../src/app'

interface WriteOffLite {
  _id: string
  tenantId: string
  locationId: string
  userId: string
  createdAt: string
}

interface OutboxLite {
  _id: string
  service: string
  op: string
  entityId: string
  payload: Record<string, unknown> | string | null
}

describe('write-offs — Edge-Service für den POS-Dialog', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  const PIN = '4711'

  let locationId: string
  let cashierId: string
  let otherStaffId: string

  const deviceConnection = (deviceRole = 'device:pos-client') => ({
    apiKey: true,
    deviceId: uuidv7(),
    deviceRole,
    tenantId,
    locationId,
  })

  const tokenFor = async (userId: string, connection: ReturnType<typeof deviceConnection>) => {
    const service = app.service('users') as unknown as {
      verifyPin: (data: unknown, params: unknown) => Promise<{ operatorToken?: string }>
    }
    return (await service.verifyPin({ userId, pin: PIN }, { connection })).operatorToken as string
  }

  const deviceParams = (connection: ReturnType<typeof deviceConnection>, token?: string) =>
    ({ provider: 'socketio', connection, query: token ? { operatorToken: token } : {} }) as never

  const writeOffs = () =>
    app.service('write-offs') as unknown as {
      create: (data: unknown, params: unknown) => Promise<WriteOffLite>
      get: (id: string, params: unknown) => Promise<WriteOffLite>
      patch: (id: string, data: unknown, params: unknown) => Promise<unknown>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  const outbox = () =>
    app.service('sync-outbox') as unknown as {
      find: (params: unknown) => Promise<OutboxLite[] | { data: OutboxLite[] }>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  /** So schickt der POS-Dialog die Abschreibung (`write-off-dialog.component.ts`, `save()`). */
  const dialogPayload = (claimedUserId: string, overrides: Record<string, unknown> = {}) => ({
    businessDayId: uuidv7(),
    itemType: 'ingredient',
    itemId: uuidv7(),
    itemName: 'Mehl Type 550',
    itemVersion: 1,
    quantity: 2,
    unit: 'kg',
    reason: 'waste',
    wasteType: 'finished',
    userId: claimedUserId,
    costPerUnit: 0,
    totalCost: 0,
    ...overrides,
  })

  /** Outbox-Einträge zu einer Abschreibung, mit Aufräumen am Testende. */
  const outboxFor = async (entityId: string) => {
    const res = await outbox().find({ ...internal, query: { service: 'write-offs', entityId }, paginate: false })
    const entries = Array.isArray(res) ? res : res.data
    onTestFinished(async () => {
      for (const entry of entries)
        await outbox()
          .remove(entry._id, internal)
          .catch(() => undefined)
    })
    return entries
  }

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Abschreibung',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    const createUser = async (lastName: string) =>
      (
        (await app.service('users').create(
          {
            firstName: 'Kasse',
            lastName,
            role: 'tenant:staff',
            tenantId,
            activeLocationId: locationId,
            isPosUser: true,
            posPin: PIN,
          } as never,
          internal,
        )) as { _id: string }
      )._id
    cashierId = await createUser('Kassierer')
    otherStaffId = await createUser('Kollege')
  })

  afterAll(async () => {
    if (locationId) await app.service('locations').remove(locationId, internal)
    for (const id of [cashierId, otherStaffId]) {
      if (id) await app.service('users').remove(id, internal)
    }
    await app.teardown()
  })

  it('legt die Abschreibung vom POS an — Tenant und Filiale aus dem Gerät', async () => {
    const connection = deviceConnection()
    const token = await tokenFor(cashierId, connection)

    const created = await writeOffs().create(dialogPayload(cashierId), deviceParams(connection, token))
    await outboxFor(created._id)

    const stored = await writeOffs().get(created._id, internal)
    expect(stored).toMatchObject({ tenantId, locationId, userId: cashierId })
  })

  it('bucht auf die Filiale des Geräts, nicht auf eine im Body genannte', async () => {
    const connection = deviceConnection()
    const token = await tokenFor(cashierId, connection)

    const created = await writeOffs().create(
      dialogPayload(cashierId, { locationId: uuidv7() }),
      deviceParams(connection, token),
    )
    await outboxFor(created._id)

    expect((await writeOffs().get(created._id, internal)).locationId).toBe(locationId)
  })

  it('setzt den Erfassungszeitpunkt am Edge, nicht aus dem Body', async () => {
    const connection = deviceConnection()
    const token = await tokenFor(cashierId, connection)
    const before = new Date().toISOString()

    const created = await writeOffs().create(
      dialogPayload(cashierId, { createdAt: '2020-01-01T00:00:00.000Z' }),
      deviceParams(connection, token),
    )
    await outboxFor(created._id)

    expect((await writeOffs().get(created._id, internal)).createdAt >= before).toBe(true)
  })

  it('rechnet dem Bediener aus dem Token zu, nicht der ID im Body', async () => {
    const connection = deviceConnection()
    const token = await tokenFor(cashierId, connection)

    const created = await writeOffs().create(dialogPayload(otherStaffId), deviceParams(connection, token))
    await outboxFor(created._id)

    expect((await writeOffs().get(created._id, internal)).userId).toBe(cashierId)
  })

  it('schreibt genau einen Outbox-Eintrag für den Push in die Cloud — mit dem vollen Datensatz', async () => {
    const connection = deviceConnection()
    const token = await tokenFor(cashierId, connection)

    const created = await writeOffs().create(dialogPayload(cashierId), deviceParams(connection, token))
    const entries = await outboxFor(created._id)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ service: 'write-offs', op: 'create', entityId: created._id })
    const payload = typeof entries[0].payload === 'string' ? JSON.parse(entries[0].payload) : entries[0].payload
    expect(payload).toMatchObject({ _id: created._id, tenantId, locationId, userId: cashierId })
  })

  it('lehnt ein Gerät ohne Recht auf Abschreibungen ab (Küchen-Monitor)', async () => {
    await expect(
      writeOffs().create(dialogPayload(cashierId), deviceParams(deviceConnection('device:kds'))),
    ).rejects.toMatchObject({ code: 403 })
  })

  it('lehnt eine Abschreibung ohne Geschäftstag ab — der POS bekommt einen Fehler statt Stille', async () => {
    const connection = deviceConnection()
    const token = await tokenFor(cashierId, connection)

    await expect(
      writeOffs().create(dialogPayload(cashierId, { businessDayId: undefined }), deviceParams(connection, token)),
    ).rejects.toMatchObject({ code: 400 })
  })

  it('ist append-only: patch und remove sind nicht freigegeben', async () => {
    const connection = deviceConnection()
    const token = await tokenFor(cashierId, connection)
    const created = await writeOffs().create(dialogPayload(cashierId), deviceParams(connection, token))
    await outboxFor(created._id)

    await expect(writeOffs().patch(created._id, { quantity: 99 }, deviceParams(connection, token))).rejects.toThrow()
    await expect(writeOffs().remove(created._id, deviceParams(connection, token))).rejects.toThrow()
    expect((await writeOffs().get(created._id, internal)) as unknown as { quantity: number }).toMatchObject({
      quantity: 2,
    })
  })
})
