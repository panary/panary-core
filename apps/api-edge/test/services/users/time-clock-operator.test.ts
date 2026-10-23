// Zeiterfassung am Terminal an das Bediener-Token gebunden (panary/panary-core#903).
//
// Der POS stempelt unter dem Geraete-JWT; wer gemeint ist, stand bis dahin nur in
// der ID im Body. Vor #902 hielt der Client nach einem Bedienerwechsel den vorigen
// Mitarbeiter fest und stempelte ihn. Ueber die echte Hook-Kette (allowApiKey,
// resolvePosOperator) mit echtem Token aus `verifyPin`; jeder Test legt seine
// Konten selbst an und raeumt sie ab (testing.md §10.2).
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { app } from '../../../src/app'

interface StoredUser {
  _id: string
  stampingId?: string | null
}

const PIN = '4711'
const internal = { provider: undefined } as const

describe('users.checkin am Terminal — Bediener-Token bestimmt die Person', () => {
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
    const device = (await app
      .service('devices')
      .create({ name: 'Kasse Stempeln', type: 'pos-counter', tenantId, locationId } as never, internal)) as {
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
        firstName: 'Stempel',
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
      const current = (await app.service('users').get(created._id, internal)) as unknown as StoredUser
      if (current.stampingId) {
        await app
          .service('working-times')
          .remove(current.stampingId, internal)
          .catch(() => undefined)
      }
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

  const checkin = (userId: string, connection: DeviceConnection, token?: string) =>
    (
      app.service('users') as unknown as {
        checkin: (data: unknown, params: unknown) => Promise<StoredUser>
      }
    ).checkin(userId, {
      provider: 'socketio',
      connection,
      query: token === undefined ? {} : { operatorToken: token },
    })

  const stampOf = async (id: string) =>
    ((await app.service('users').get(id, internal)) as unknown as StoredUser).stampingId ?? null

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Stempeln',
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

  it('stempelt den Bediener aus dem Token', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)

    await checkin(anna._id, connection, token)

    expect(await stampOf(anna._id)).toEqual(expect.any(String))
  })

  it('lehnt eine fremde ID im Body mit 403 ab und stempelt niemanden', async () => {
    const anna = await createStaff('Anna')
    const ben = await createStaff('Ben')
    const connection = await deviceConnection()
    const annasToken = await tokenFor(anna._id, connection)

    await expect(checkin(ben._id, connection, annasToken)).rejects.toMatchObject({ code: 403 })

    expect(await stampOf(ben._id)).toBeNull()
    expect(await stampOf(anna._id)).toBeNull()
  })

  it('lehnt ein manipuliertes Token mit 401 ab, statt auf den Weg ohne Token zurueckzufallen', async () => {
    const anna = await createStaff('Anna')
    const connection = await deviceConnection()
    const token = await tokenFor(anna._id, connection)

    await expect(checkin(anna._id, connection, `${token}x`)).rejects.toMatchObject({
      code: 401,
      data: { reason: 'POS_OPERATOR_REQUIRED' },
    })
    expect(await stampOf(anna._id)).toBeNull()
  })

  it('lehnt das Token eines anderen Geraets mit 401 ab', async () => {
    const anna = await createStaff('Anna')
    const kasse1 = await deviceConnection()
    const kasse2 = await deviceConnection()
    const tokenVonKasse1 = await tokenFor(anna._id, kasse1)

    await expect(checkin(anna._id, kasse2, tokenVonKasse1)).rejects.toMatchObject({ code: 401 })
    expect(await stampOf(anna._id)).toBeNull()
  })
})
