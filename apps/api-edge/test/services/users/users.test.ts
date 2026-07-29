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

// Brute-Force-Schutz: ohne Limiter waere der 4-stellige PIN-Raum (10^4) bei
// bcrypt-Cost 6 in etwa einer Minute durchprobiert. Eigener User, damit die
// Sperre die uebrigen Tests nicht beeinflusst.
describe('users service — verifyPin Rate-Limit', () => {
  type VerifyPinService = { verifyPin: (data: { userId: string; pin: string }) => Promise<unknown> }

  let lockUserId: string

  beforeAll(async () => {
    await app.setup()
    const created = await app.service('users').create(
      { firstName: 'Brute', lastName: 'Force', role: 'tenant:staff', isPosUser: true, posPin: '1234' } as never,
      { provider: undefined },
    )
    lockUserId = (created as { _id: string })._id
  })

  afterAll(async () => {
    if (lockUserId) await app.service('users').remove(lockUserId, { provider: undefined })
    await app.teardown()
  })

  it('sperrt nach zu vielen Fehlversuchen mit TooManyRequests (429)', async () => {
    const service = app.service('users') as unknown as VerifyPinService

    let sawLockout = false
    for (let i = 0; i < 12; i++) {
      await service.verifyPin({ userId: lockUserId, pin: '9999' }).catch((error: { code?: number }) => {
        if (error.code === 429) sawLockout = true
      })
    }
    assert.ok(sawLockout, 'nach wiederholten Fehlversuchen muss 429 kommen')

    // Auch der korrekte PIN prallt waehrend der Sperre ab — die Sperre laeuft
    // aber von selbst aus (siehe pin-attempt-limiter.spec.ts).
    await assert.rejects(
      service.verifyPin({ userId: lockUserId, pin: '1234' }),
      (error: { code?: number }) => error.code === 429,
    )
  })
})

// Business-Logik-Test fuer die Custom-Method `changePin` (POS-PIN-Selbstwechsel
// am Terminal). Der wichtigste Fall ist der Klartext-Schutz: der interne Patch
// darf NIEMALS `fromSync: true` setzen, sonst ueberspringt der Resolver das
// bcrypt-Hashing und der PIN landet im Klartext in der DB.
describe('users service — changePin', () => {
  type ChangePinService = {
    changePin: (
      data: { userId?: string; currentPin?: string; newPin?: string },
      params?: { user?: { _id?: string; role?: string; tenantId?: string } },
    ) => Promise<Record<string, unknown>>
  }

  const devicePos = { _id: 'device:test', role: 'device:pos-client' }

  let userId: string

  beforeAll(async () => {
    await app.setup()
    const created = await app.service('users').create(
      {
        firstName: 'Change',
        lastName: 'Pin',
        role: 'tenant:staff',
        isPosUser: true,
        posPin: '1234',
        mustChangePosPin: true,
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

  it('falscher currentPin → NotAuthenticated, PIN und Flag bleiben unveraendert', async () => {
    const service = app.service('users') as unknown as ChangePinService
    const before = (await app.service('users').get(userId, { provider: undefined })) as {
      posPin?: string
      mustChangePosPin?: unknown
    }

    await assert.rejects(
      service.changePin({ userId, currentPin: '0000', newPin: '5678' }, { user: devicePos }),
      (error: { code?: number }) => error.code === 401,
    )

    const after = (await app.service('users').get(userId, { provider: undefined })) as {
      posPin?: string
      mustChangePosPin?: unknown
    }
    assert.strictEqual(after.posPin, before.posPin, 'PIN darf nicht geaendert worden sein')
    assert.ok(after.mustChangePosPin, 'Flag muss gesetzt bleiben')
  })

  it('newPin === currentPin → BadRequest (400)', async () => {
    const service = app.service('users') as unknown as ChangePinService
    await assert.rejects(
      service.changePin({ userId, currentPin: '1234', newPin: '1234' }, { user: devicePos }),
      (error: { code?: number }) => error.code === 400,
    )
  })

  it('newPin mit falscher Laenge → BadRequest (400)', async () => {
    const service = app.service('users') as unknown as ChangePinService
    for (const bad of ['123', '12345', 'abcd']) {
      await assert.rejects(
        service.changePin({ userId, currentPin: '1234', newPin: bad }, { user: devicePos }),
        (error: { code?: number }) => error.code === 400,
      )
    }
  })

  it('fremder Mandant → Forbidden (403)', async () => {
    const service = app.service('users') as unknown as ChangePinService
    await assert.rejects(
      service.changePin(
        { userId, currentPin: '1234', newPin: '5678' },
        { user: { ...devicePos, tenantId: 'fremder-tenant' } },
      ),
      (error: { code?: number }) => error.code === 403,
    )
  })

  it('korrekter currentPin → neuer PIN als bcrypt-Hash, Flag geloescht, Result ohne Secrets', async () => {
    const service = app.service('users') as unknown as ChangePinService
    const result = await service.changePin({ userId, currentPin: '1234', newPin: '5678' }, { user: devicePos })

    assert.strictEqual(result['posPin'], undefined, 'posPin darf nicht im Result stehen')
    assert.strictEqual(result['password'], undefined, 'password darf nicht im Result stehen')

    const stored = (await app.service('users').get(userId, { provider: undefined })) as {
      posPin?: string
      mustChangePosPin?: unknown
    }
    // Kernaussage: kein Klartext. Waere `fromSync: true` gesetzt, stuende hier '5678'.
    assert.notStrictEqual(stored.posPin, '5678', 'neuer PIN darf nicht im Klartext gespeichert sein')
    assert.ok(String(stored.posPin).startsWith('$2'), 'neuer PIN muss ein bcrypt-Hash sein')
    assert.ok(!stored.mustChangePosPin, 'Flag muss nach erfolgreichem Wechsel geloescht sein')

    // Der neue PIN muss danach auch fuer den Login gelten.
    const verify = app.service('users') as unknown as {
      verifyPin: (d: { userId: string; pin: string }) => Promise<unknown>
    }
    await assert.doesNotReject(verify.verifyPin({ userId, pin: '5678' }))
  })
})
