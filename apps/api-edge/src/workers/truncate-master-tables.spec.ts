// Regression-Anker fuer den destruktiven Bootstrap-Modus `pull-cloud-to-edge`.
//
// Ausloeser (2026-08-12, #183): Der Truncate lief ueber
// `service.remove(null, { query })`. Das erlaubt der Feathers-Adapter nur, wenn
// `remove` in den `multi`-Optionen steht — von den acht Master-Services tut das
// ausschliesslich `products`. Fuer die uebrigen sieben antwortete der Adapter
// mit „Can not remove multiple entries", der Runner protokollierte eine Warnung
// und machte weiter: Pull auf `upsert` degradiert, Alt-Bestand blieb stehen,
// Abschlussmeldung trotzdem „Bootstrap erfolgreich abgeschlossen" — obwohl der
// Operator `confirmDataLoss` bestaetigt hatte.
//
// Diese Spec haelt beides fest: dass ohne Bulk-Remove trotzdem geleert wird,
// und dass ein NICHT geleerter Service den Bootstrap abbricht statt ihn
// stillschweigend als Erfolg durchzuwinken.

import { describe, expect, it, vi } from 'vitest'

import { truncateMasterTables } from './truncate-master-tables'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const MASTER_SERVICES = [
  'locations',
  'opening-hour-exceptions',
  'product-groups',
  'products',
  'users',
  'corporate-customers',
  'customers',
  'businessdays',
]

const TENANT = 'tenant-1'

interface ServiceBehaviour {
  /** Startbestand je Service (Anzahl Rows). */
  rows?: number
  /** true = Adapter erlaubt `remove(null, …)` (entspricht `multi: ['remove']`). */
  allowsBulkRemove?: boolean
  /** true = jedes remove ist wirkungslos (Hook verweigert still). */
  removeIsNoop?: boolean
}

function makeApp(behaviours: Record<string, ServiceBehaviour> = {}) {
  const state = new Map<string, string[]>()
  const singleRemoves: string[] = []
  for (const service of MASTER_SERVICES) {
    const count = behaviours[service]?.rows ?? 2
    state.set(
      service,
      Array.from({ length: count }, (_, i) => `${service}-${i}`),
    )
  }

  const app = {
    service: (path: string) => {
      const behaviour = behaviours[path] ?? {}
      return {
        find: async () => (state.get(path) ?? []).map(_id => ({ _id })),
        remove: async (id: string | null) => {
          if (id === null) {
            if (!behaviour.allowsBulkRemove) throw new Error('Can not remove multiple entries')
            if (!behaviour.removeIsNoop) state.set(path, [])
            return []
          }
          singleRemoves.push(`${path}:${id}`)
          if (behaviour.removeIsNoop) return { _id: id }
          state.set(
            path,
            (state.get(path) ?? []).filter(existing => existing !== id),
          )
          return { _id: id }
        },
      }
    },
  }
  return { app, state, singleRemoves }
}

describe('truncateMasterTables', () => {
  it('leert alle Master-Services, auch ohne Bulk-Remove-Erlaubnis', async () => {
    const { app, state, singleRemoves } = makeApp()

    await expect(truncateMasterTables(app as never, TENANT, MASTER_SERVICES)).resolves.toBeUndefined()

    for (const service of MASTER_SERVICES) {
      expect(state.get(service), `${service} nicht geleert`).toEqual([])
    }
    // 8 Services x 2 Rows — alle ueber den Einzel-Pfad.
    expect(singleRemoves).toHaveLength(16)
  })

  it('nutzt den Bulk-Pfad, wo der Adapter ihn erlaubt (products)', async () => {
    const { app, state, singleRemoves } = makeApp({ products: { allowsBulkRemove: true } })

    await truncateMasterTables(app as never, TENANT, MASTER_SERVICES)

    expect(state.get('products')).toEqual([])
    expect(singleRemoves.filter(entry => entry.startsWith('products:'))).toHaveLength(0)
    expect(singleRemoves).toHaveLength(14)
  })

  it('bricht ab, wenn ein Service nicht leer wird — kein stiller Erfolg', async () => {
    const { app } = makeApp({ users: { removeIsNoop: true } })

    await expect(truncateMasterTables(app as never, TENANT, MASTER_SERVICES)).rejects.toThrow(/\[service=users\].*TRUNCATE unvollstaendig/s)
  })

  it('bricht beim ersten unvollstaendigen Service ab, statt weiterzulaufen', async () => {
    // `locations` ist der erste Eintrag in MASTER_DATA_SERVICES.
    const { app, state } = makeApp({ locations: { removeIsNoop: true } })

    await expect(truncateMasterTables(app as never, TENANT, MASTER_SERVICES)).rejects.toThrow(/service=locations/)
    // Nachgelagerte Services wurden nicht mehr angefasst.
    expect(state.get('customers')).toHaveLength(2)
  })

  it('kommt mit bereits leeren Tabellen zurecht (idempotent)', async () => {
    const { app, singleRemoves } = makeApp(Object.fromEntries(MASTER_SERVICES.map(s => [s, { rows: 0 }])))

    await expect(truncateMasterTables(app as never, TENANT, MASTER_SERVICES)).resolves.toBeUndefined()
    expect(singleRemoves).toHaveLength(0)
  })
})
