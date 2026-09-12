import assert from 'assert'

import { UserStatus, UserSystemRole } from '@panary/users/domain'
import { onTestFinished } from 'vitest'

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
//
// **Baseline UND Konto gehoeren in den Test** (Code-Style §10.1, #301): Vorher
// lagen beide im `beforeAll`, und der zweite Test archivierte genau das Konto,
// dessen Aktivsein der erste zaehlte. Unter `--sequence.shuffle` — der mischt
// auch die Tests INNERHALB einer Datei — war das rot, sobald die beiden die
// Plaetze tauschten (gemessen 2026-09-13, Seed 3: `4 !== 5`). Eine im
// `beforeAll` gemessene Baseline ist ausserdem nur so lange gueltig, wie kein
// Test davor etwas an der Zaehlung aendert.
describe('readAdminAccessState — gegen die echte Edge-DB', () => {
  /** Misst den Ausgangszustand und belegt zugleich, dass die Abfrage die Hook-Kette passiert. */
  const readBaseline = async () => {
    const baseline = await readAdminAccessState(app)
    assert.ok(baseline, 'Ausgangszustand muss ermittelbar sein (Abfrage passiert die Hook-Kette)')
    return baseline
  }

  /** Legt einen aktiven Owner an und raeumt ihn am Ende DIESES Tests ab. */
  const createActiveOwner = async () => {
    const created = (await app.service('users').create(
      {
        firstName: 'Access',
        lastName: 'Owner',
        role: UserSystemRole.TENANT_OWNER,
        status: UserStatus.ACTIVE,
      } as never,
      { provider: undefined },
    )) as { _id: string }

    onTestFinished(async () => {
      await app
        .service('users')
        .remove(created._id, { provider: undefined })
        .catch(() => undefined)
    })

    return created._id
  }

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    await app.teardown()
  })

  it('aktiver tenant:owner zaehlt als administrationsfaehiger Zugang', async () => {
    const baseline = await readBaseline()
    const userId = await createActiveOwner()

    const state = await readAdminAccessState(app)
    assert.ok(state)
    assert.strictEqual(state.usableCount, baseline.usableCount + 1)
    assert.strictEqual(state.healthy, true)
    assert.ok(
      !state.blocked.some(account => account._id === userId),
      'ein aktives Konto darf nicht als gesperrt gemeldet werden',
    )
  })

  it('archivierter Owner faellt aus der Zaehlung und wird als gesperrt gemeldet (#275)', async () => {
    const baseline = await readBaseline()
    const userId = await createActiveOwner()

    await app.service('users').patch(userId, { status: UserStatus.ARCHIVED } as never, { provider: undefined })

    const state = await readAdminAccessState(app)
    assert.ok(state)
    assert.strictEqual(state.usableCount, baseline.usableCount)
    const blocked = state.blocked.find(account => account._id === userId)
    assert.ok(blocked, 'das archivierte Owner-Konto muss im blocked-Block stehen')
    assert.strictEqual(blocked.role, UserSystemRole.TENANT_OWNER)
    assert.strictEqual(blocked.status, UserStatus.ARCHIVED)
  })
})
