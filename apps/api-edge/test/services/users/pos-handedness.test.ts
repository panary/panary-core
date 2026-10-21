// Bedienhand `posHandedness` am Edge (panary/panary-core#827) — gegen die migrierte
// Test-SQLite und die volle Hook-Kette (`provider: 'rest'`): Self-Patch-Policy,
// Validierung, Persistenz, Outbox-Payload und Pull-Apply.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'

import { SyncSource } from '@panary/sync/domain'
import { app } from '../../../src/app'
import { buildSyncOp } from '../../../src/workers/cloud-bootstrap-runner.worker'

type StoredUser = { _id: string; posHandedness?: string | null; role?: string }
// Die Outbox speichert den Payload als JSON-Text (SQLite).
type OutboxEntry = { op: string; payload: string | null }

describe('users — posHandedness', () => {
  const tenantId = uuidv7()

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    await app.teardown()
  })

  // Je Test eigener Mitarbeiter (Testing §10.2): die Tests patchen die Zeile.
  const createStaff = async (data: Record<string, unknown> = {}): Promise<StoredUser> => {
    const created = (await app
      .service('users')
      .create({ firstName: 'Hand', lastName: 'Test', role: 'tenant:staff', tenantId, ...data } as never, {
        provider: undefined,
      })) as StoredUser
    onTestFinished(async () => {
      await app.service('users').remove(created._id, { provider: undefined })
    })
    return created
  }

  const asSelf = (user: StoredUser) =>
    ({ provider: 'rest', authenticated: true, user: { _id: user._id, role: 'tenant:staff', tenantId } }) as never

  const stored = async (id: string) =>
    (await app.service('users').get(id, { provider: undefined })) as unknown as StoredUser

  const outboxFor = (entityId: string) =>
    app.service('sync-outbox').find({
      provider: undefined,
      paginate: false,
      query: { entityId },
    } as never) as unknown as Promise<OutboxEntry[]>

  it('Bestands-User ohne Wahl: Spalte leer, Bootstrap-Push laesst das Feld weg', async () => {
    const user = await createStaff()
    assert.strictEqual((await stored(user._id)).posHandedness, null, 'leere SQLite-Spalte kommt als null')

    const payload = buildSyncOp(await stored(user._id), 'users', SyncSource.LIVE).payload as Record<string, unknown>
    assert.strictEqual('posHandedness' in payload, false, 'null darf die Cloud nicht erreichen')
  })

  it('Mitarbeiter setzt die eigene Bedienhand → gespeichert, im Push-Payload', async () => {
    const user = await createStaff()

    await app.service('users').patch(user._id, { posHandedness: 'right' } as never, asSelf(user))
    assert.strictEqual((await stored(user._id)).posHandedness, 'right')

    await app.service('users').patch(user._id, { posHandedness: 'left' } as never, asSelf(user))
    assert.strictEqual((await stored(user._id)).posHandedness, 'left')

    const patches = (await outboxFor(user._id)).filter(entry => entry.op === 'patch')
    assert.deepStrictEqual(
      patches.map(entry => JSON.parse(entry.payload ?? '{}').posHandedness),
      ['right', 'left'],
    )
  })

  it.each([null, 'links', ''])('ungueltiger Wert %j → 400, Spalte unveraendert', async value => {
    const user = await createStaff({ posHandedness: 'right' })

    await assert.rejects(
      app.service('users').patch(user._id, { posHandedness: value } as never, asSelf(user)),
      (error: { code?: number }) => error.code === 400,
    )
    assert.strictEqual((await stored(user._id)).posHandedness, 'right')
  })

  it('Self-Patch-Policy unveraendert: role → 403, auch zusammen mit posHandedness', async () => {
    const user = await createStaff()

    for (const data of [{ role: 'tenant:owner' }, { posHandedness: 'right', role: 'tenant:owner' }]) {
      await assert.rejects(
        app.service('users').patch(user._id, data as never, asSelf(user)),
        (error: { code?: number }) => error.code === 403,
      )
    }
    const after = await stored(user._id)
    assert.strictEqual(after.role, 'tenant:staff')
    assert.strictEqual(after.posHandedness, null)
  })

  it('fremder Mitarbeiter → 403', async () => {
    const user = await createStaff()
    const other = await createStaff()

    await assert.rejects(
      app.service('users').patch(other._id, { posHandedness: 'right' } as never, asSelf(user)),
      (error: { code?: number }) => error.code === 403,
    )
    assert.strictEqual((await stored(other._id)).posHandedness, null)
  })

  it('Pull-Apply eines Cloud-Records mit posHandedness wird uebernommen', async () => {
    const user = await createStaff()

    await app
      .service('users')
      .patch(user._id, { posHandedness: 'right' } as never, { provider: undefined, fromSync: true } as never)
    assert.strictEqual((await stored(user._id)).posHandedness, 'right')
  })
})
