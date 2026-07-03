// For more information about this file see https://dove.feathersjs.com/guides/cli/service.test.html
import assert from 'assert'
import { app } from '../../../src/app'

describe('users service', () => {
  it('registered the service', () => {
    const service = app.service('users')

    assert.ok(service, 'Registered the service')
  })
})

// Business-Logik-Test fuer die Custom-Method `verifyPin` (serverseitige
// POS-PIN-Verifizierung, users.ts): korrekter PIN liefert den User OHNE
// sensible Felder, falscher/fehlender PIN wirft NotAuthenticated (401).
// Laeuft gegen die echte Test-SQLite (SQLITE_PATH aus vitest.config.mts);
// app.setup() fuehrt die Migrationen aus, afterAll raeumt den User wieder ab.
describe('users service — verifyPin', () => {
  type VerifyPinService = {
    verifyPin: (data: { userId?: string; pin?: string }) => Promise<Record<string, unknown>>
  }

  let userId: string

  beforeAll(async () => {
    await app.setup()
    const created = await app.service('users').create(
      {
        firstName: 'Pin',
        lastName: 'Tester',
        role: 'tenant:staff',
        isPosUser: true,
        posPin: '1234',
      } as never,
      { provider: undefined },
    )
    userId = (created as { _id: string })._id
  })

  afterAll(async () => {
    if (userId) {
      await app.service('users').remove(userId, { provider: undefined })
    }
    await app.teardown()
  })

  it('korrekter PIN → User ohne posPin/password, PIN liegt nur als Hash in der DB', async () => {
    const service = app.service('users') as unknown as VerifyPinService
    const result = await service.verifyPin({ userId, pin: '1234' })

    assert.strictEqual(result['_id'], userId)
    assert.strictEqual(result['posPin'], undefined, 'posPin darf nicht im Result stehen')
    assert.strictEqual(result['password'], undefined, 'password darf nicht im Result stehen')

    // Der dataResolver muss den Klartext-PIN gehasht haben (bcrypt, nie plain).
    const stored = (await app.service('users').get(userId, { provider: undefined })) as { posPin?: string }
    assert.ok(stored.posPin, 'posPin muss gespeichert sein')
    assert.notStrictEqual(stored.posPin, '1234', 'posPin darf nicht im Klartext gespeichert sein')
    assert.ok(String(stored.posPin).startsWith('$2'), 'posPin muss ein bcrypt-Hash sein')
  })

  it('falscher PIN → NotAuthenticated (401)', async () => {
    const service = app.service('users') as unknown as VerifyPinService
    await assert.rejects(service.verifyPin({ userId, pin: '9999' }), (error: { name?: string; code?: number }) => {
      assert.strictEqual(error.name, 'NotAuthenticated')
      assert.strictEqual(error.code, 401)
      return true
    })
  })

  it('fehlende Parameter → NotAuthenticated (401)', async () => {
    const service = app.service('users') as unknown as VerifyPinService
    await assert.rejects(service.verifyPin({ userId }), (error: { code?: number }) => error.code === 401)
    await assert.rejects(service.verifyPin({ pin: '1234' }), (error: { code?: number }) => error.code === 401)
  })
})
