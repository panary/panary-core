// Personalnummer nie an Geraete (panary/panary-core#1196): gegen die echte App und die migrierte Test-SQLite,
// mit externem Provider, damit `resolveExternal` laeuft.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { UserSystemRole } from '@panary/users/domain'

import { app } from '../../../src/app'
import { userExternalResolver } from '../../../src/services/users/users.schema'

type Row = { _id: string; employeeNumber?: string; firstName?: string }

describe('users — employeeNumber an Geraete', () => {
  const tenantId = uuidv7()
  const NUMBER = '482913'
  const internal = { provider: undefined } as const
  let locationId: string
  let device: never

  // Aufbau, den kein Test veraendert: Filiale und Geraet. Der users-Service lehnt Geraete ohne Datensatz ab.
  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Personalnummer',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id
    const record = (await app
      .service('devices')
      .create({ name: 'Kasse Personalnummer', type: 'pos-counter', tenantId, locationId } as never, internal)) as {
      deviceId: string
    }
    device = {
      _id: `device:${record.deviceId}`,
      role: UserSystemRole.DEVICE_POS,
      tenantId,
      locationId,
      activeLocationId: locationId,
      allowedLocationIds: [locationId],
    } as never
  })

  afterAll(async () => {
    await app.teardown()
  })

  const createStaff = async (): Promise<Row> => {
    const created = (await app.service('users').create(
      {
        firstName: 'Stempel',
        lastName: uuidv7(),
        role: 'tenant:staff',
        isPosUser: true,
        activeLocationId: locationId,
        employeeNumber: NUMBER,
        tenantId,
      } as never,
      { provider: undefined },
    )) as Row
    onTestFinished(async () => {
      await app.service('users').remove(created._id, { provider: undefined })
    })
    return created
  }

  const admin = { _id: uuidv7(), role: 'tenant:owner', tenantId } as never

  const asRows = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { data: Row[] }).data ?? [])) as Row[]

  // Feathers legt das Ergebnis von `resolveExternal` in `context.dispatch` ab, das nur die Transporte (REST, Socket,
  // Channels) ausliefern. Ein direkter Service-Aufruf liefert `result` und zeigt die Wirkung deshalb nicht: Der
  // Resolver wird mit dem gespeicherten Datensatz und dem Aufrufer-Kontext aufgerufen.
  const external = async (stored: Row, user: unknown): Promise<Row> =>
    (await userExternalResolver.resolve(stored as never, { params: { provider: 'rest', user } } as never)) as Row

  const storedRow = async (id: string): Promise<Row> =>
    (await app.service('users').get(id, { provider: undefined })) as Row

  it('liefert dem Geraet keine employeeNumber, die uebrigen Felder bleiben', async () => {
    const u = await createStaff()
    const row = await external(await storedRow(u._id), device)
    expect(row.employeeNumber).toBeUndefined()
    expect(row.firstName).toBe('Stempel')
  })

  it('erkennt das Geraet auch allein an der Rolle', async () => {
    const u = await createStaff()
    const row = await external(await storedRow(u._id), { _id: uuidv7(), role: UserSystemRole.DEVICE_POS, tenantId })
    expect(row.employeeNumber).toBeUndefined()
  })

  it('Verwaltungsrolle und Mitarbeiter behalten die Nummer', async () => {
    const u = await createStaff()
    for (const role of [UserSystemRole.TENANT_OWNER, UserSystemRole.TENANT_STAFF]) {
      const row = await external(await storedRow(u._id), { _id: uuidv7(), role, tenantId })
      expect(row.employeeNumber).toBe(NUMBER)
    }
  })

  it('interner Aufruf ohne User behaelt die Nummer', async () => {
    const u = await createStaff()
    const row = await external(await storedRow(u._id), undefined)
    expect(row.employeeNumber).toBe(NUMBER)
  })

  it('Panel-Query nach employeeNumber trifft am Geraet weiter', async () => {
    const u = await createStaff()
    const rows = asRows(
      await app
        .service('users')
        .find({ provider: 'rest', authenticated: true, user: device, query: { employeeNumber: NUMBER } } as never),
    )
    expect(rows.map(r => r._id)).toContain(u._id)
  })
})
