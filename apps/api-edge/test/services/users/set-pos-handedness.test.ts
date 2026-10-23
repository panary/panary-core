// Bedienhand am Terminal setzen (panary/panary-core#833).
//
// Der POS ist am Edge das Geraet. Wessen `posHandedness` sich aendert, darf
// deshalb allein das Bediener-Token aus `verifyPin` bestimmen (ADR 0053) — nie
// eine ID im Body. Ueber die echte Hook-Kette mit Geraete-Verbindung; jeder Test
// legt seine Konten selbst an und raeumt sie ab (testing.md §10.2).
import { BadRequest, NotAuthenticated } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'

import { app } from '../../../src/app'
import { POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS } from '../../../src/utils/pos-operator-token'

interface StoredUser {
  _id: string
  tenantId: string
  role: string
  posHandedness?: string | null
}

/** In SQLite liegt die Payload als JSON-Text. */
interface OutboxEntry {
  entityId: string
  op: string
  payload: string | null
}

const PIN = '4711'
const internal = { provider: undefined } as const

describe('users.setPosHandedness — Bediener-Token bestimmt die Person', () => {
  const tenantId = uuidv7()
  let locationId: string

  interface DeviceConnection {
    apiKey: true
    deviceId: string
    deviceRole: string
    tenantId: string
    locationId: string
  }

  /** Echtes Geraet: Der users-Service lehnt Geraete ohne Datensatz ab (resolveDeviceAccessScope). */
  const deviceConnection = async (): Promise<DeviceConnection> => {
    // `deviceId` vergibt der Resolver beim Anlegen selbst.
    const device = (await app
      .service('devices')
      .create({ name: 'Kasse Bedienhand', type: 'pos-counter', tenantId, locationId } as never, internal)) as {
      _id: string
      deviceId: string
    }
    onTestFinished(async () => {
      await app
        .service('devices')
        .remove(device._id, internal)
        .catch(() => undefined)
    })
    return { apiKey: true, deviceId: device.deviceId, deviceRole: 'device:pos-client', tenantId, locationId }
  }

  const createStaff = async (lastName: string) => {
    const created = (await app.service('users').create(
      {
        firstName: 'Hand',
        lastName,
        role: 'tenant:staff',
        tenantId,
        activeLocationId: locationId,
        isPosUser: true,
        posPin: PIN,
      } as never,
      internal,
    )) as StoredUser
    onTestFinished(async () => {
      await app
        .service('users')
        .remove(created._id, internal)
        .catch(() => undefined)
    })
    return created
  }

  const tokenFor = async (userId: string, connection: DeviceConnection) => {
    const service = app.service('users') as unknown as {
      verifyPin: (data: unknown, params: unknown) => Promise<{ operatorToken?: string }>
    }
    return (await service.verifyPin({ userId, pin: PIN }, { connection })).operatorToken as string
  }

  const setPosHandedness = (data: unknown, connection: DeviceConnection, token?: string) =>
    (
      app.service('users') as unknown as {
        setPosHandedness: (data: unknown, params: unknown) => Promise<{ _id: string; posHandedness: string }>
      }
    ).setPosHandedness(data, {
      provider: 'socketio',
      connection,
      query: token ? { operatorToken: token } : {},
    })

  const stored = async (id: string) => (await app.service('users').get(id, internal)) as unknown as StoredUser

  const outboxPatchesFor = async (entityId: string) =>
    (
      (await app.service('sync-outbox').find({
        provider: undefined,
        paginate: false,
        query: { entityId },
      } as never)) as unknown as OutboxEntry[]
    ).filter(entry => entry.op === 'patch')

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Bedienhand',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id
  })

  afterAll(async () => {
    if (locationId) await app.service('locations').remove(locationId, internal)
    await app.teardown()
  })

  it('setzt die Bedienhand des Bedieners aus dem Token und schreibt sie in die Sync-Outbox', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)

    const result = await setPosHandedness({ posHandedness: 'right' }, connection, token)

    expect(result).toEqual({ _id: anna._id, posHandedness: 'right' })
    expect((await stored(anna._id)).posHandedness).toBe('right')
    const patches = await outboxPatchesFor(anna._id)
    expect(patches.map(entry => JSON.parse(entry.payload ?? '{}').posHandedness)).toEqual(['right'])
  })

  it('eine fremde userId im Body wird abgelehnt — das Konto des Kollegen bleibt unberührt', async () => {
    const anna = await createStaff('Anna')
    const bruno = await createStaff('Bruno')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)

    await expect(
      setPosHandedness({ posHandedness: 'right', userId: bruno._id }, connection, token),
    ).rejects.toBeInstanceOf(BadRequest)

    expect((await stored(bruno._id)).posHandedness ?? null).toBeNull()
    expect((await stored(anna._id)).posHandedness ?? null).toBeNull()
  })

  it('ein weiteres Feld im Body wird abgelehnt (keine Rechte-Erhöhung über die Methode)', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)

    await expect(
      setPosHandedness({ posHandedness: 'right', role: 'tenant:owner' }, connection, token),
    ).rejects.toBeInstanceOf(BadRequest)

    const after = await stored(anna._id)
    expect(after.role).toBe('tenant:staff')
    expect(after.posHandedness ?? null).toBeNull()
  })

  it('ein unbekannter Wert wird abgelehnt', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)

    await expect(setPosHandedness({ posHandedness: 'middle' }, connection, token)).rejects.toBeInstanceOf(BadRequest)
    expect((await stored(anna._id)).posHandedness ?? null).toBeNull()
  })

  it('ohne Bediener-Token: abgelehnt, nichts geschrieben', async () => {
    const anna = await createStaff('Anna')

    await expect(setPosHandedness({ posHandedness: 'right' }, await deviceConnection())).rejects.toBeInstanceOf(
      NotAuthenticated,
    )
    expect((await stored(anna._id)).posHandedness ?? null).toBeNull()
  })

  it('ein manipuliertes Token wird abgelehnt', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)
    const [header, payload] = token.split('.')

    await expect(
      setPosHandedness({ posHandedness: 'right' }, connection, `${header}.${payload}.gefaelscht`),
    ).rejects.toBeInstanceOf(NotAuthenticated)
    expect((await stored(anna._id)).posHandedness ?? null).toBeNull()
  })

  it('das Token eines anderen Geräts wird abgelehnt', async () => {
    const anna = await createStaff('Anna')
    const token = await tokenFor(anna._id, await deviceConnection())

    await expect(setPosHandedness({ posHandedness: 'right' }, await deviceConnection(), token)).rejects.toBeInstanceOf(
      NotAuthenticated,
    )
    expect((await stored(anna._id)).posHandedness ?? null).toBeNull()
  })

  it('an der Verbindung eines anderen Mandanten wird das Token abgelehnt', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)

    // Geraete-Datensatz und Token passen beide nicht zum fremden Mandanten; welche Pruefung
    // zuerst greift, ist egal — entscheidend ist, dass nichts geschrieben wird.
    await expect(
      setPosHandedness({ posHandedness: 'right' }, { ...connection, tenantId: uuidv7() }, token),
    ).rejects.toBeInstanceOf(Error)
    expect((await stored(anna._id)).posHandedness ?? null).toBeNull()
  })

  it('ein abgelaufenes Token wird abgelehnt', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(Date.now() + (POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS + 60) * 1000)

    await expect(setPosHandedness({ posHandedness: 'right' }, connection, token)).rejects.toBeInstanceOf(
      NotAuthenticated,
    )
    vi.useRealTimers()
    expect((await stored(anna._id)).posHandedness ?? null).toBeNull()
  })
})
