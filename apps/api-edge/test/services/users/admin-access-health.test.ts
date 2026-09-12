import assert from 'assert'

import { UserStatus, UserSystemRole } from '@panary/users/domain'

import { app } from '../../../src/app'
import { readAdminAccessState } from '../../../src/utils/admin-access-health'

// Laufzeit-Gegenprobe zum Boot-Check aus #275 gegen die echte Test-SQLite und
// die echte Hook-Kette. Die Unit-Spec (src/utils/admin-access-health.spec.ts)
// prueft die Bewertung mit einer App-Attrappe — sie kann NICHT zeigen, dass die
// Abfrage den `validateQuery`-Hook passiert und der `$select` im Query-Schema
// erlaubt ist. Genau daran scheitert so ein Read sonst mit 400, und das faellt
// erst beim Start auf einem Kundengeraet auf.
//
// Bewusst relativ zum Ausgangszustand gemessen: Die Test-DB wird von mehreren
// Test-Dateien geteilt und kann bereits Verwaltungskonten aus dem Bootstrap
// tragen. Absolute Zahlen waeren reihenfolgeabhaengig.
describe('readAdminAccessState — gegen die echte Edge-DB', () => {
  let userId: string
  let baselineUsable = 0

  beforeAll(async () => {
    await app.setup()
    const baseline = await readAdminAccessState(app)
    assert.ok(baseline, 'Ausgangszustand muss ermittelbar sein (Abfrage passiert die Hook-Kette)')
    baselineUsable = baseline.usableCount

    const created = await app.service('users').create(
      {
        firstName: 'Access',
        lastName: 'Owner',
        role: UserSystemRole.TENANT_OWNER,
        status: UserStatus.ACTIVE,
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

  it('aktiver tenant:owner zaehlt als administrationsfaehiger Zugang', async () => {
    const state = await readAdminAccessState(app)
    assert.ok(state)
    assert.strictEqual(state.usableCount, baselineUsable + 1)
    assert.strictEqual(state.healthy, true)
    assert.ok(
      !state.blocked.some(account => account._id === userId),
      'ein aktives Konto darf nicht als gesperrt gemeldet werden',
    )
  })

  it('archivierter Owner faellt aus der Zaehlung und wird als gesperrt gemeldet (#275)', async () => {
    await app.service('users').patch(userId, { status: UserStatus.ARCHIVED } as never, { provider: undefined })

    const state = await readAdminAccessState(app)
    assert.ok(state)
    assert.strictEqual(state.usableCount, baselineUsable)
    const blocked = state.blocked.find(account => account._id === userId)
    assert.ok(blocked, 'das archivierte Owner-Konto muss im blocked-Block stehen')
    assert.strictEqual(blocked.role, UserSystemRole.TENANT_OWNER)
    assert.strictEqual(blocked.status, UserStatus.ARCHIVED)
  })
})
