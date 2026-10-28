// Vertrag und Jahresanspruch aus der Cloud am Edge (panary/panary-core#1180, panary/panary-cloud#1504) — gegen die
// migrierte Test-SQLite und die volle Hook-Kette des Pull-Apply (`provider: undefined`, `fromSync: true`). Ohne
// Spalten lehnte Knex den ganzen Cloud-Record ab, samt PIN-Wechsel und Rolle im selben Record.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'

import { app } from '../../../src/app'

type StoredUser = {
  _id: string
  role?: string
  vacationDaysPerYear?: number | null
  contract?: Record<string, unknown> | null
}

describe('users — Vertrag und Jahresanspruch aus der Cloud', () => {
  const tenantId = uuidv7()
  const fromSync = { provider: undefined, fromSync: true } as never

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    await app.teardown()
  })

  // Je Test eigener Mitarbeiter (Testing §10.2): die Tests patchen die Zeile.
  const createStaff = async (): Promise<StoredUser> => {
    const created = (await app
      .service('users')
      .create({ firstName: 'Vertrag', lastName: 'Test', role: 'tenant:staff', tenantId } as never, {
        provider: undefined,
      })) as StoredUser
    onTestFinished(async () => {
      await app.service('users').remove(created._id, { provider: undefined })
    })
    return created
  }

  const stored = async (id: string) =>
    (await app.service('users').get(id, { provider: undefined })) as unknown as StoredUser

  it('uebernimmt einen Cloud-Record mit Vertrag und Anspruch vollstaendig, auch die Rolle daneben', async () => {
    const user = await createStaff()
    const contract = { contractType: 'FULL_TIME', hoursPerWeek: 40 }

    await app
      .service('users')
      .patch(user._id, { role: 'tenant:manager', vacationDaysPerYear: 28, contract } as never, fromSync)

    const after = await stored(user._id)
    assert.strictEqual(after.role, 'tenant:manager')
    assert.strictEqual(after.vacationDaysPerYear, 28)
    assert.deepStrictEqual(after.contract, contract)
  })

  it('leert den Anspruch, wenn die Cloud null schickt', async () => {
    const user = await createStaff()
    await app.service('users').patch(user._id, { vacationDaysPerYear: 28 } as never, fromSync)

    await app.service('users').patch(user._id, { vacationDaysPerYear: null } as never, fromSync)

    assert.strictEqual((await stored(user._id)).vacationDaysPerYear, null)
  })
})
