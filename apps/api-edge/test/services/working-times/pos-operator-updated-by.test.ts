// `working-times.updatedBy` am Geraet aus dem Bediener-Token (panary/panary-core#631, ADR 0053).
//
// Vorher stand bei Patches vom Geraet `device:<uuid>` in `updatedBy` — kein Mensch.
// `userId` (wessen Arbeitszeit) bleibt die fachliche Person und wird nicht angefasst.
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { app } from '../../../src/app'

describe('working-times.patch — updatedBy am Geraet', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  const PIN = '4711'

  let locationId: string
  let operatorId: string
  let employeeId: string

  const deviceConnection = () => ({
    apiKey: true,
    deviceId: uuidv7(),
    deviceRole: 'device:pos-client',
    tenantId,
    locationId,
  })

  const workingTimes = () =>
    app.service('working-times') as unknown as {
      create: (data: unknown, params: unknown) => Promise<{ _id: string }>
      patch: (id: string, data: unknown, params: unknown) => Promise<{ updatedBy?: string; userId: string }>
      remove: (id: string, params: unknown) => Promise<unknown>
    }

  const createWorkingTime = async () => {
    const now = new Date().toISOString()
    const created = await workingTimes().create(
      {
        tenantId,
        locationId,
        userId: employeeId,
        breaks: [],
        checkinDate: now,
        originCheckinDate: now,
        checkoutDate: null,
        originCheckoutDate: null,
      },
      internal,
    )
    onTestFinished(async () => {
      await workingTimes()
        .remove(created._id, internal)
        .catch(() => undefined)
    })
    return created
  }

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Zeiterfassung',
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
            firstName: 'Zeit',
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
    operatorId = await createUser('Bediener')
    employeeId = await createUser('Mitarbeiter')
  })

  afterAll(async () => {
    if (locationId) await app.service('locations').remove(locationId, internal)
    for (const id of [operatorId, employeeId]) {
      if (id) await app.service('users').remove(id, internal)
    }
    await app.teardown()
  })

  it('mit Token: updatedBy ist der Bediener aus dem Token, userId bleibt der Mitarbeiter', async () => {
    const workingTime = await createWorkingTime()
    const connection = deviceConnection()
    const users = app.service('users') as unknown as {
      verifyPin: (data: unknown, params: unknown) => Promise<{ operatorToken?: string }>
    }
    const token = (await users.verifyPin({ userId: operatorId, pin: PIN }, { connection })).operatorToken

    const patched = await workingTimes().patch(
      workingTime._id,
      { checkoutDate: new Date().toISOString() },
      { provider: 'socketio', connection, query: { operatorToken: token } },
    )

    expect(patched.updatedBy).toBe(operatorId)
    expect(patched.userId).toBe(employeeId)
  })

  it('ohne Token: updatedBy bleibt die Geraete-Kennung wie bisher', async () => {
    const workingTime = await createWorkingTime()
    const connection = deviceConnection()

    const patched = await workingTimes().patch(
      workingTime._id,
      { checkoutDate: new Date().toISOString() },
      { provider: 'socketio', connection },
    )

    expect(patched.updatedBy).toBe(`device:${connection.deviceId}`)
  })
})
