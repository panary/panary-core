// Integrationstest fuer die Custom-Method `reloadUsers` (panary/panary-core#666) —
// Reparaturweg „Benutzer vollstaendig neu aus der Cloud laden". Gegen die echte
// Test-SQLite und die volle Hook-Kette, weil Cursor, Audit-Eintrag und
// Tenant-Isolation dort sitzen.
//
// Geprueft wird am Cursor, nicht am Sync-Ergebnis: Die Test-Verbindung hat keinen
// Cloud-Token und keine erreichbare Cloud, der Sync bewegt also nichts. Auch dann
// muss der Cursor geloescht sein, damit der naechste regulaere Tick den Voll-Pull
// nachholt.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import { PairingStatus } from '@panary/cloud-connection/domain'
import { app } from '../../../src/app'

type ReloadUsersService = {
  reloadUsers: (
    data: { cloudConnectionId: string },
    params?: unknown,
  ) => Promise<{ _id: string; pulled: number; lastError?: string }>
}

describe('cloud-connection — reloadUsers (#666)', () => {
  beforeAll(async () => {
    await app.setup()
  })

  // Die Methode und der Sync waehlen die CONNECTED-Verbindung. Reste aus anderen
  // Suiten (die Test-SQLite ist persistent) wuerden eine fremde Zeile treffen.
  //
  // Dasselbe gilt fuer wartende `users`-Ops: Andere Suiten legen Benutzer an, der
  // Recorder schreibt dafuer `pending`-Eintraege (gemessen: 212), und `reloadUsers`
  // lehnt dann zu Recht ab. Ohne Cloud-Token pusht sie hier niemand.
  beforeEach(async () => {
    const knex = app.get('sqliteClient') as any
    await knex.table('cloud-connection').del()
    await knex.table('sync-outbox').where({ service: 'users' }).whereIn('status', ['pending', 'in-flight']).del()
  })

  afterAll(async () => {
    const knex = app.get('sqliteClient') as any
    await knex.table('cloud-connection').del()
    await knex.table('sync-cursor').whereIn('_id', ['cloud:users', 'cloud:products']).del()
  })

  const service = () => app.service('cloud-connection') as unknown as ReloadUsersService

  async function seedConnection(overrides: Record<string, unknown> = {}): Promise<{ id: string; tenantId: string }> {
    const id = uuidv7()
    const tenantId = (overrides['tenantId'] as string) ?? uuidv7()
    const knex = app.get('sqliteClient') as any
    await knex.table('cloud-connection').insert({
      _id: id,
      tenantId,
      // `.test` ist reserviert und loest nie auf.
      cloudUrl: 'https://cloud.example.test',
      pairingStatus: PairingStatus.CONNECTED,
      syncEnabled: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    })
    return { id, tenantId }
  }

  async function seedCursor(service: string): Promise<void> {
    const cursors = app.service('sync-cursor') as any
    await cursors.remove(`cloud:${service}`, { provider: undefined }).catch(() => undefined)
    await cursors.create(
      { _id: `cloud:${service}`, service, lastPullAt: '2026-10-01T00:00:00.000Z' },
      { provider: undefined },
    )
  }

  const cursorExists = async (id: string): Promise<boolean> =>
    (app.service('sync-cursor') as any)
      .get(id, { provider: undefined })
      .then(() => true)
      .catch(() => false)

  it('loescht nur den Cursor `cloud:users`, auch wenn der Sync danach nichts bewegt', async () => {
    const { id } = await seedConnection()
    await seedCursor('users')
    await seedCursor('products')

    const result = await service().reloadUsers({ cloudConnectionId: id }, { provider: undefined })

    assert.strictEqual(await cursorExists('cloud:users'), false, 'der naechste Pull ist ein Voll-Pull')
    assert.strictEqual(await cursorExists('cloud:products'), true, 'andere Services bleiben inkrementell')
    assert.strictEqual(result._id, id)
  })

  it('laeuft auch ohne vorhandenen Cursor durch', async () => {
    const { id } = await seedConnection()
    await (app.service('sync-cursor') as any).remove('cloud:users', { provider: undefined }).catch(() => undefined)

    const result = await service().reloadUsers({ cloudConnectionId: id }, { provider: undefined })

    assert.strictEqual(result._id, id)
  })

  it('lehnt ab, wenn der Edge nicht verbunden ist, und laesst den Cursor stehen', async () => {
    const { id } = await seedConnection({ pairingStatus: PairingStatus.DISCONNECTED })
    await seedCursor('users')

    await assert.rejects(service().reloadUsers({ cloudConnectionId: id }, { provider: undefined }), /nicht verbunden/)

    assert.strictEqual(await cursorExists('cloud:users'), true)
  })

  it('lehnt ab, solange Benutzer-Aenderungen auf den Push warten, und laesst den Cursor stehen', async () => {
    const { id } = await seedConnection()
    await seedCursor('users')
    const opId = uuidv7()
    const outbox = app.service('sync-outbox') as any
    await outbox.create(
      {
        _id: opId,
        service: 'users',
        op: 'patch',
        entityId: uuidv7(),
        payload: {},
        occurredAt: new Date().toISOString(),
        syncSource: 'live',
      },
      { provider: undefined },
    )
    onTestFinished(() => outbox.remove(opId, { provider: undefined }).catch(() => undefined))

    await assert.rejects(service().reloadUsers({ cloudConnectionId: id }, { provider: undefined }), /warten noch/)

    assert.strictEqual(await cursorExists('cloud:users'), true)
  })

  it('schreibt einen Audit-Eintrag mit Akteur', async () => {
    const { id, tenantId } = await seedConnection()
    const owner = { _id: uuidv7(), tenantId, locationId: null, role: 'tenant:owner', permissions: [] }

    await service().reloadUsers({ cloudConnectionId: id }, { provider: undefined, user: owner })

    const knex = app.get('sqliteClient') as any
    const rows = await knex.table('audit-events').where({ target_resource: 'cloud-connection', target_entityId: id })
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].action, 'CONFIG_CHANGE')
    assert.strictEqual(rows[0].actor_userId, owner._id)
  })
})
