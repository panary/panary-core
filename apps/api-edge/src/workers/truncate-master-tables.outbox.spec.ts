// Regression-Anker fuer #660: Der Truncate vor `pull-cloud-to-edge` darf keine
// Loesch-Auftraege in die Sync-Outbox schreiben.
//
// Ausloeser (2026-10-10): Ein Kunden-Edge wurde neu gekoppelt mit „alles aus
// der Cloud uebernehmen". Danach stand fuer jeden Bestands-User ein REMOVE
// („Personal geloescht") in der Outbox — der Truncate lief ueber
// `service.remove(…, { provider: undefined })`, und der globale After-Hook
// `recordSyncOutbox` nahm jede Loeschung des Transaktions-Pfads `users` auf.
// Nur ein Cloud-Fehler (panary/panary-cloud#1112) verhinderte, dass der
// Bootstrap die Benutzer in der Cloud loeschte.
//
// Anders als `truncate-master-tables.spec.ts` laeuft diese Spec ueber eine
// echte Feathers-App mit dem Hook so verdrahtet wie in `app.ts` — die Luecke
// lag genau im Zusammenspiel, das eine Service-Attrappe nicht abbildet.

import { feathers } from '@feathersjs/feathers'
import { describe, expect, it, vi } from 'vitest'

import { recordSyncOutbox } from '../hooks/sync-outbox-recorder.hook'
import { truncateMasterTables } from './truncate-master-tables'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const TENANT = 'tenant-1'

interface Row {
  _id: string
  tenantId: string
}

class RowService {
  constructor(
    private rows: Row[],
    private readonly allowsBulkRemove: boolean,
  ) {}

  async find(params: { query?: { tenantId?: string } }) {
    return this.rows.filter(row => row.tenantId === params.query?.tenantId).map(({ _id }) => ({ _id }))
  }

  async remove(id: string | null, params: { query?: { tenantId?: string } }) {
    if (id === null) {
      if (!this.allowsBulkRemove) throw new Error('Can not remove multiple entries')
      const removed = this.rows.filter(row => row.tenantId === params.query?.tenantId)
      this.rows = this.rows.filter(row => row.tenantId !== params.query?.tenantId)
      return removed
    }
    const removed = this.rows.find(row => row._id === id)
    this.rows = this.rows.filter(row => row._id !== id)
    return removed
  }
}

interface OutboxEntry {
  _id?: string
  service: string
  op: string
  entityId: string
  status?: string
  lastError?: string
}

class OutboxService {
  constructor(readonly entries: OutboxEntry[] = []) {}

  async create(data: OutboxEntry) {
    this.entries.push(data)
    return data
  }

  // Nachbau des Adapter-Bulk-Patch fuer die Query, die der Truncate stellt.
  async patch(id: null, data: Partial<OutboxEntry>, params: { query: { service: string; status: { $in: string[] } } }) {
    const hits = this.entries.filter(
      entry => entry.service === params.query.service && params.query.status.$in.includes(entry.status ?? ''),
    )
    for (const entry of hits) Object.assign(entry, data)
    return hits
  }
}

const makeApp = (outboxEntries: OutboxEntry[] = []) => {
  const app = feathers()
  const outbox = new OutboxService(outboxEntries)
  app.use('users' as never, new RowService([
    { _id: 'user-1', tenantId: TENANT },
    { _id: 'user-2', tenantId: TENANT },
    { _id: 'user-3', tenantId: TENANT },
  ]) as never)
  app.use('products' as never, new RowService([{ _id: 'product-1', tenantId: TENANT }], true) as never)
  app.use('sync-outbox' as never, outbox as never)
  // Verdrahtung wie in `app.ts`: Recorder nach dem Service-Aufruf.
  app.hooks({
    around: [
      async (context: any, next: () => Promise<void>) => {
        await next()
        await recordSyncOutbox(context, async () => undefined as never)
      },
    ],
  })
  return { app, outbox }
}

describe('truncateMasterTables — Sync-Outbox (#660)', () => {
  it('schreibt beim Leeren eines Transaktions-Pfads (users) keinen REMOVE-Auftrag', async () => {
    const { app, outbox } = makeApp()

    await truncateMasterTables(app as never, TENANT, ['users', 'products'])

    expect(await app.service('users' as never).find({ query: { tenantId: TENANT } } as never)).toEqual([])
    expect(outbox.entries).toEqual([])
  })

  it('verwirft offene Alt-Auftraege der geleerten Services, laesst erledigte und fremde stehen', async () => {
    // Ein lokal angelegter, noch nicht gepushter Kassierer: Ohne das Verwerfen
    // ginge sein CREATE nach dem Bootstrap in die Cloud, obwohl der Operator ihn
    // mit `confirmDataLoss` aufgegeben hat. Frueher verdraengte ihn das REMOVE
    // des Truncate per Coalescing.
    const { app, outbox } = makeApp([
      { _id: 'o-1', service: 'users', op: 'create', entityId: 'user-1', status: 'pending' },
      { _id: 'o-2', service: 'users', op: 'patch', entityId: 'user-2', status: 'rejected' },
      { _id: 'o-3', service: 'users', op: 'patch', entityId: 'user-3', status: 'in-flight' },
      { _id: 'o-4', service: 'users', op: 'patch', entityId: 'user-3', status: 'acked' },
      { _id: 'o-5', service: 'orders', op: 'create', entityId: 'order-1', status: 'pending' },
    ])

    await truncateMasterTables(app as never, TENANT, ['users', 'products'])

    expect(outbox.entries.map(entry => [entry._id, entry.status])).toEqual([
      ['o-1', 'superseded'],
      ['o-2', 'superseded'],
      ['o-3', 'superseded'],
      ['o-4', 'acked'],
      ['o-5', 'pending'],
    ])
  })

  it('Gegenprobe: ein normales internes users.remove landet weiterhin in der Outbox', async () => {
    // Haelt fest, dass die Verdrahtung oben den Recorder tatsaechlich ausloest —
    // sonst bliebe der erste Test auch ohne Fix gruen.
    const { app, outbox } = makeApp()

    await app.service('users' as never).remove('user-1' as never, { provider: undefined } as never)

    expect(outbox.entries).toEqual([expect.objectContaining({ service: 'users', op: 'remove', entityId: 'user-1' })])
  })
})
