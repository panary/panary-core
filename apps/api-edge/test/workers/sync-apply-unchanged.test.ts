// Integrationstest zu panary/panary-core#1105 gegen die ECHTE Test-SQLite und die
// volle Hook-Kette von `businessdays`.
//
// Nach einem Voll-Pull (leerer Cursor nach Bootstrap) kam jeder Geschaeftstag erneut an
// und wurde gepatcht, obwohl sich nichts geaendert hatte. Jeder Patch stempelte
// `updatedAt` und schickte ein `patched`-Event an den POS — „Geschaeftstag wurde
// geaendert +43". Der Fokus-Test (sync-apply.test.ts) prueft den Vergleich gegen einen
// Speicher-Mock; nur hier zeigt sich, ob die Zeile, die SQLite + Resolver zurueckgeben,
// dem Cloud-Record wirklich gleicht (0/1 statt boolean, JSON-Spalten, `null`).
import assert from 'assert'
import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'

import { app } from '../../src/app'
import { applyPulledRecords } from '../../src/workers/sync-apply'

const cloudBusinessDay = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
  const id = uuidv7()
  return {
    _id: id,
    tenantId: uuidv7(),
    locationId: uuidv7(),
    date: '2026-09-14',
    status: 'closed',
    openedAt: '2026-09-14T04:00:00.000Z',
    closedAt: '2026-09-14T22:00:00.000Z',
    openedBy: 'cloud-user',
    closedBy: 'cloud-user',
    isOpen: false,
    operationMode: 'pos-cashier',
    reportId: null,
    reportErrorMessage: null,
    createdAt: '2026-09-14T04:00:00.000Z',
    updatedAt: '2026-09-14T22:00:00.000Z',
    ...overrides,
  }
}

describe('sync-apply — unveraenderte Geschaeftstage (#1105)', () => {
  beforeAll(async () => {
    await app.setup()
  })

  const seed = async (record: Record<string, unknown>) => {
    const id = record['_id'] as string
    onTestFinished(async () => {
      await app
        .service('businessdays')
        .remove(id, { provider: undefined } as never)
        .catch(() => undefined)
    })
    const first = await applyPulledRecords(app, 'businessdays', [
      { _id: id, updatedAt: record['updatedAt'] as string, record },
    ])
    assert.strictEqual(first.rejected, 0, JSON.stringify(first.details))
    return (await app.service('businessdays').get(id, { provider: undefined } as never)) as Record<string, unknown>
  }

  const watchPatched = () => {
    const patchedIds: string[] = []
    const listener = (row: { _id: string }) => patchedIds.push(row._id)
    app.service('businessdays').on('patched', listener)
    onTestFinished(() => {
      app.service('businessdays').removeListener('patched', listener)
    })
    return patchedIds
  }

  it('patcht einen erneut gepullten, unveraenderten Tag nicht und sendet kein `patched`', async () => {
    const record = cloudBusinessDay()
    const before = await seed(record)
    const patchedIds = watchPatched()

    const second = await applyPulledRecords(app, 'businessdays', [
      { _id: record['_id'] as string, updatedAt: record['updatedAt'] as string, record },
    ])

    assert.strictEqual(second.rejected, 0, JSON.stringify(second.details))
    assert.strictEqual(second.unchanged, 1)
    assert.deepStrictEqual(patchedIds, [])
    const after = (await app.service('businessdays').get(
      record['_id'] as string,
      {
        provider: undefined,
      } as never,
    )) as Record<string, unknown>
    assert.strictEqual(after['updatedAt'], before['updatedAt'])
  })

  it('patcht und meldet weiter, wenn die Cloud den Tag wirklich geaendert hat', async () => {
    const record = cloudBusinessDay()
    await seed(record)
    const patchedIds = watchPatched()

    const changed = { ...record, reportErrorMessage: 'Bericht fehlgeschlagen' }
    const second = await applyPulledRecords(app, 'businessdays', [
      { _id: record['_id'] as string, updatedAt: '2026-10-26T11:50:42.000Z', record: changed },
    ])

    assert.strictEqual(second.rejected, 0, JSON.stringify(second.details))
    assert.strictEqual(second.unchanged, 0)
    assert.deepStrictEqual(patchedIds, [record['_id']])
    const after = (await app.service('businessdays').get(
      record['_id'] as string,
      {
        provider: undefined,
      } as never,
    )) as Record<string, unknown>
    assert.strictEqual(after['reportErrorMessage'], 'Bericht fehlgeschlagen')
  })
})
