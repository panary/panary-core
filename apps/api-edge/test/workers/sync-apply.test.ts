// Fokus-Test fuer das geteilte Sync-Apply-Modul (`applyPulledRecords`).
//
// Kein App-Boot: das Modul braucht nur `app.service(<name>)` mit
// find/create/patch/remove. Alles in-memory gemockt — geprueft werden die
// Apply-Semantik (create+patch gemischt, remove via deletedAt), der GEBATCHTE
// Existenz-Check (EIN find pro Seite, NIE get pro Record), die Idempotenz bei
// doppelt angewandter Seite (Upsert) sowie der insert-Modus des
// Bootstrap-Pfads (kein find nach Truncate).
import assert from 'assert'

import { SyncOp, SyncRunRecordStatus, type SyncPullResponse } from '@panary/sync/domain'

import { vi } from 'vitest'

import type { Application } from '../../src/declarations'
import { logger } from '@panary/shared-backend'
import { applyPulledRecords, detectForeignTenantId } from '../../src/workers/sync-apply'

type PullRecord = SyncPullResponse['records'][number]

interface ServiceCalls {
  find: Array<Record<string, unknown>>
  get: string[]
  create: Array<Record<string, unknown>>
  patch: Array<{ id: string; data: Record<string, unknown> }>
  remove: string[]
}

describe('sync-apply — applyPulledRecords', () => {
  let store: Map<string, Record<string, unknown>>
  let calls: ServiceCalls
  // Optional: create fuer bestimmte IDs fehlschlagen lassen (AJV-Simulation).
  let failCreateIds: Set<string>
  // Fremd-Mandanten-Raste (#337).
  let connectionRow: { _id: string; foreignTenantRecordsCount?: number | null } | undefined
  let connectionPatches: Array<{ id: string; data: Record<string, unknown> }>

  const service = {
    find: async (params: { query: { _id: { $in: string[] } } }) => {
      calls.find.push(params.query as unknown as Record<string, unknown>)
      return params.query._id.$in.filter(id => store.has(id)).map(id => ({ _id: id }))
    },
    get: async (id: string) => {
      calls.get.push(id)
      const row = store.get(id)
      if (!row) throw new Error(`NotFound: ${id}`)
      return row
    },
    create: async (data: Record<string, unknown>) => {
      const id = data['_id'] as string
      calls.create.push(data)
      if (failCreateIds.has(id)) {
        const err = new Error('validation failed') as Error & { data: unknown }
        err.data = [{ instancePath: '/name', message: 'must be string', keyword: 'type' }]
        throw err
      }
      if (store.has(id)) throw new Error(`UNIQUE constraint failed: ${id}`)
      store.set(id, data)
      return data
    },
    patch: async (id: string, data: Record<string, unknown>) => {
      calls.patch.push({ id, data })
      const row = store.get(id)
      if (!row) throw new Error(`NotFound: ${id}`)
      const next = { ...row, ...data }
      store.set(id, next)
      return next
    },
    remove: async (id: string) => {
      calls.remove.push(id)
      store.delete(id)
      return { _id: id }
    },
  }

  // `cloud-connection` traegt die Fremd-Mandanten-Raste (#337). Der Stub bildet nur
  // ab, was `stampForeignTenantLatch` braucht: ein `find` auf die eine Zeile und ein
  // `_patch` darauf.
  const connectionService = {
    find: async () => (connectionRow ? [connectionRow] : []),
    _patch: async (id: string, data: Record<string, unknown>) => {
      connectionPatches.push({ id, data })
      connectionRow = { ...(connectionRow as Record<string, unknown>), ...data } as typeof connectionRow
      return connectionRow
    },
  }

  const app = {
    service: (path: string) => {
      // `orders`/`discounts` fuer den Legacy-`discount`-Strip (#310): Der Strip greift
      // nur bei `orders`, `discounts` ist die Gegenprobe.
      if (path === 'products' || path === 'orders' || path === 'discounts') return service
      if (path === 'cloud-connection') return connectionService
      throw new Error(`Unerwarteter Service-Zugriff im Test: ${path}`)
    },
  } as unknown as Application

  const now = new Date().toISOString()
  const pullRecord = (id: string, extra: Partial<PullRecord> = {}): PullRecord => ({
    _id: id,
    updatedAt: now,
    record: { _id: id, name: `Produkt ${id}`, tenantId: 't-1' },
    ...extra,
  })

  beforeEach(() => {
    store = new Map()
    failCreateIds = new Set()
    calls = { find: [], get: [], create: [], patch: [], remove: [] }
    connectionRow = { _id: 'conn-1', foreignTenantRecordsCount: 0 }
    connectionPatches = []
  })

  // Spies zentral zuruecknehmen, NICHT am Ende des jeweiligen Tests: Ein dort
  // stehendes `mockRestore()` wird bei einem fehlgeschlagenen assert nie erreicht,
  // der Spy leckt in den Folgetest und macht ihn aus fremder Ursache rot. Genau so
  // gemessen bei der Mutationsprobe zu #310 — eine Mutation kippte zwei Tests, von
  // denen nur einer etwas mit ihr zu tun hatte.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wendet create + patch gemischt an und entfernt deletedAt-Records', async () => {
    store.set('p-1', { _id: 'p-1', name: 'Alt' })
    store.set('p-0', { _id: 'p-0', name: 'Wird geloescht' })
    const page = [pullRecord('p-1'), pullRecord('p-2'), pullRecord('p-0', { deletedAt: now, record: undefined })]

    const result = await applyPulledRecords(app, 'products', page)

    assert.strictEqual(result.applied, 3)
    assert.strictEqual(result.rejected, 0)
    assert.deepStrictEqual(
      result.details.map(d => [d.entityId, d.op, d.status]),
      [
        ['p-1', SyncOp.PATCH, SyncRunRecordStatus.ACCEPTED],
        ['p-2', SyncOp.CREATE, SyncRunRecordStatus.ACCEPTED],
        ['p-0', SyncOp.REMOVE, SyncRunRecordStatus.ACCEPTED],
      ],
    )
    assert.deepStrictEqual(
      calls.patch.map(p => p.id),
      ['p-1'],
    )
    assert.deepStrictEqual(
      calls.create.map(c => c['_id']),
      ['p-2'],
    )
    assert.deepStrictEqual(calls.remove, ['p-0'])
    assert.strictEqual((store.get('p-1') as { name: string }).name, 'Produkt p-1')
  })

  it('batcht den Existenz-Check: EIN find pro Seite, NIE get pro Record', async () => {
    store.set('p-1', { _id: 'p-1' })
    const page = [pullRecord('p-1'), pullRecord('p-2'), pullRecord('p-3'), pullRecord('p-4', { deletedAt: now })]

    await applyPulledRecords(app, 'products', page)

    assert.strictEqual(calls.find.length, 1)
    assert.strictEqual(calls.get.length, 0)
    // deletedAt-Records gehoeren NICHT in den $in-Existenz-Check.
    assert.deepStrictEqual(calls.find[0], {
      _id: { $in: ['p-1', 'p-2', 'p-3'] },
      $select: ['_id'],
    })
  })

  it('ist idempotent bei doppelt angewandter Seite (zweiter Lauf nur Patches)', async () => {
    const page = [pullRecord('p-1'), pullRecord('p-2')]

    const first = await applyPulledRecords(app, 'products', page)
    const second = await applyPulledRecords(app, 'products', page)

    assert.strictEqual(first.rejected, 0)
    assert.strictEqual(second.rejected, 0)
    assert.strictEqual(second.applied, 2)
    // Erster Lauf: 2 creates. Zweiter Lauf: 0 creates, 2 patches.
    assert.strictEqual(calls.create.length, 2)
    assert.deepStrictEqual(
      calls.patch.map(p => p.id),
      ['p-1', 'p-2'],
    )
    assert.strictEqual(store.size, 2)
    assert.ok(second.details.every(d => d.status === SyncRunRecordStatus.ACCEPTED && d.op === SyncOp.PATCH))
  })

  it('insert-Modus (Bootstrap nach Truncate): direkter create ohne Existenz-Find', async () => {
    const page = [pullRecord('p-1'), pullRecord('p-2')]

    const result = await applyPulledRecords(app, 'products', page, { mode: 'insert' })

    assert.strictEqual(calls.find.length, 0)
    assert.strictEqual(calls.get.length, 0)
    assert.strictEqual(calls.create.length, 2)
    assert.strictEqual(result.applied, 2)
  })

  it('markiert fehlgeschlagene Applies als REJECTED, ohne den Rest der Seite zu blockieren', async () => {
    failCreateIds.add('p-2')
    const page = [pullRecord('p-1'), pullRecord('p-2'), pullRecord('p-3')]

    const result = await applyPulledRecords(app, 'products', page)

    assert.strictEqual(result.applied, 2)
    assert.strictEqual(result.rejected, 1)
    const rejectedDetail = result.details.find(d => d.entityId === 'p-2')
    assert.strictEqual(rejectedDetail?.status, SyncRunRecordStatus.REJECTED)
    assert.match(rejectedDetail?.reason ?? '', /validation failed/)
    // p-1 und p-3 sind trotz Fehler in p-2 angekommen.
    assert.ok(store.has('p-1') && store.has('p-3') && !store.has('p-2'))
  })

  it('liefert bei leerer Seite ein leeres Ergebnis ohne Service-Calls', async () => {
    const result = await applyPulledRecords(app, 'products', [])

    assert.deepStrictEqual(result, { applied: 0, rejected: 0, details: [], foreignTenant: 0 })
    assert.strictEqual(calls.find.length + calls.create.length + calls.patch.length, 0)
  })

  // --- Legacy-`discount`-Strip (#310) ----------------------------------------------
  //
  // Bestands-Orders von vor ADR 0030 tragen `order.discount`. Ohne Strip lehnt
  // `validateData` sie ab (`additionalProperties: false`) — und weil der Pull-Cursor
  // unabhaengig vom Ergebnis vorrueckt, kaeme die Bestellung NIE wieder an. Der Strip
  // ist deshalb kein Aufraeumen, sondern Verlustschutz.

  it('strippt `discount` aus Bestands-Orders und laesst sie ankommen', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const page = [pullRecord('o-1', { record: { _id: 'o-1', tenantId: 't-1', discount: 5, total: 100 } })]

    const result = await applyPulledRecords(app, 'orders', page)

    assert.strictEqual(result.applied, 1)
    assert.strictEqual(result.rejected, 0)
    // Das Feld erreicht den Service nicht — sonst schluege validateData zu.
    assert.ok(!('discount' in calls.create[0]), '`discount` darf nicht am Service ankommen')
    // Der Rest der Order bleibt unangetastet.
    assert.strictEqual(calls.create[0]['total'], 100)
    // Die Log-Zeile ist der Zweck der Uebung: Sie beantwortet, ob es den Fall gibt.
    const events = warn.mock.calls.map(([arg]) => (arg as { event?: string })?.event)
    assert.ok(events.includes('sync.pull.legacy_discount_stripped'), 'Strip muss geloggt werden')
  })

  it('laesst `discount` bei ANDEREN Services unangetastet (Gegenprobe)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    // `discountSchema` fuehrt `discount` voellig legitim — ein pauschaler Strip ueber
    // alle Services wuerde Stammdaten beschaedigen.
    const page = [pullRecord('d-1', { record: { _id: 'd-1', tenantId: 't-1', discount: 10 } })]

    await applyPulledRecords(app, 'discounts', page)

    assert.strictEqual(calls.create[0]['discount'], 10)
    const events = warn.mock.calls.map(([arg]) => (arg as { event?: string })?.event)
    assert.ok(!events.includes('sync.pull.legacy_discount_stripped'), 'kein Strip ausserhalb von orders')
  })

  it('loggt nichts, wenn eine Order das Feld gar nicht traegt', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const page = [pullRecord('o-2', { record: { _id: 'o-2', tenantId: 't-1', total: 42 } })]

    const result = await applyPulledRecords(app, 'orders', page)

    assert.strictEqual(result.applied, 1)
    const events = warn.mock.calls.map(([arg]) => (arg as { event?: string })?.event)
    assert.ok(!events.includes('sync.pull.legacy_discount_stripped'), 'kein Log ohne Strip')
  })
  // --- Fremd-Mandanten-Guard (#337) ------------------------------------------------
  //
  // Cloud-seitig ist der Pull hart auf `{ tenantId: user.tenantId }` gescopet. Der
  // Guard ist die ZWEITE Linie: Ein Fehler in der Cloud-Filterung, ein falsch
  // ausgestelltes Edge-Token oder ein Bug in einer kuenftigen `applyScope`-Strategie
  // landete sonst ungebremst als Fremdzeile in der Edge-DB.
  //
  // 🚫 Der Guard LEHNT NICHT AB. `upsertCursor` rueckt unabhaengig vom Apply-Ergebnis
  // vor — ein hier verworfener Record kaeme nie wieder. Erkennen und melden ist das
  // Maximum, das ohne Verlustrisiko zu haben ist.

  it('erkennt einen fremden Mandanten, schreibt den Record aber TROTZDEM', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const page = [pullRecord('p-9', { record: { _id: 'p-9', name: 'Fremd', tenantId: 't-FREMD' } })]

    const result = await applyPulledRecords(app, 'products', page, { expectedTenantId: 't-1' })

    // Der Befund …
    assert.strictEqual(result.foreignTenant, 1)
    const warnCall = warn.mock.calls.find(([arg]) => (arg as { event?: string })?.event === 'sync.pull.foreign_tenant_record')
    assert.ok(warnCall, 'Fremd-Mandant muss geloggt werden')
    assert.strictEqual((warnCall?.[0] as { foreignTenantId?: string }).foreignTenantId, 't-FREMD')

    // … aendert nichts daran, dass der Record ankommt. Das ist der Kern des Designs.
    assert.strictEqual(result.applied, 1)
    assert.strictEqual(result.rejected, 0)
    assert.strictEqual(calls.create.length, 1)
    assert.strictEqual(calls.create[0]['tenantId'], 't-FREMD')
    assert.ok(store.has('p-9'), 'der Record muss geschrieben sein')
  })

  it('stempelt die Raste auf cloud-connection — kumulativ, nicht ueberschreibend', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    connectionRow = { _id: 'conn-1', foreignTenantRecordsCount: 4 }
    const page = [
      pullRecord('p-9', { record: { _id: 'p-9', tenantId: 't-FREMD' } }),
      pullRecord('p-8', { record: { _id: 'p-8', tenantId: 't-ANDERS' } }),
    ]

    await applyPulledRecords(app, 'products', page, { expectedTenantId: 't-1' })

    assert.strictEqual(connectionPatches.length, 1, 'genau EIN Patch pro Seite, nicht einer je Record')
    const patched = connectionPatches[0].data
    assert.strictEqual(patched['foreignTenantRecordsCount'], 6, '4 vorher + 2 dieser Seite')
    assert.strictEqual(patched['foreignTenantRecordsLastTenantId'], 't-ANDERS')
    assert.ok(typeof patched['foreignTenantRecordsAt'] === 'string')
  })

  it('verdichtet: viele Fremdrecords ergeben EINE Logzeile und EINEN Patch', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    // Eine gebrochene Cloud-Filterung liefert nicht einen Fremdrecord, sondern eine
    // ganze Seite. 20 Logzeilen und 20 Patches je Seite waeren die Kosten, die die
    // Cloud-AlertEngine schon einmal in eine Mailflut getrieben haben (ADR 0058).
    const page = Array.from({ length: 20 }, (_, i) =>
      pullRecord(`f-${i}`, { record: { _id: `f-${i}`, tenantId: 't-FREMD' } }),
    )

    const result = await applyPulledRecords(app, 'products', page, { expectedTenantId: 't-1' })

    assert.strictEqual(result.foreignTenant, 20)
    assert.strictEqual(result.applied, 20, 'alle 20 werden angewandt')
    const foreignWarns = warn.mock.calls.filter(
      ([arg]) => (arg as { event?: string })?.event === 'sync.pull.foreign_tenant_record',
    )
    assert.strictEqual(foreignWarns.length, 1, 'genau eine Logzeile je Seite')
    assert.strictEqual((foreignWarns[0][0] as { count?: number }).count, 20)
    // Die Stichprobe ist gedeckelt — sonst waere die Logzeile bei 500er-Seiten selbst
    // das Problem.
    assert.strictEqual((foreignWarns[0][0] as { sampleEntityIds?: string[] }).sampleEntityIds?.length, 5)
    assert.strictEqual(connectionPatches.length, 1)
  })

  it('laesst den eigenen Mandanten unberuehrt', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const page = [pullRecord('p-1'), pullRecord('p-2')]

    const result = await applyPulledRecords(app, 'products', page, { expectedTenantId: 't-1' })

    assert.strictEqual(result.foreignTenant, 0)
    assert.strictEqual(result.applied, 2)
    assert.strictEqual(connectionPatches.length, 0, 'kein Patch ohne Befund')
    const events = warn.mock.calls.map(([arg]) => (arg as { event?: string })?.event)
    assert.ok(!events.includes('sync.pull.foreign_tenant_record'))
  })

  it('laesst Records OHNE tenantId durch (z. B. `tenants` — Identitaet steckt in `_id`)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    // Ein Guard, der bei `undefined` anschlaegt, sperrt harmlose Services aus. Die
    // Edge-Replica von `tenants` hat nicht einmal eine `tenantId`-Spalte.
    const page = [pullRecord('p-3', { record: { _id: 'p-3', name: 'Ohne Mandant' } })]

    const result = await applyPulledRecords(app, 'products', page, { expectedTenantId: 't-1' })

    assert.strictEqual(result.foreignTenant, 0)
    assert.strictEqual(result.applied, 1)
    assert.strictEqual(connectionPatches.length, 0)
    const events = warn.mock.calls.map(([arg]) => (arg as { event?: string })?.event)
    assert.ok(!events.includes('sync.pull.foreign_tenant_record'))
  })

  it('ist AUS, solange kein erwarteter Mandant bekannt ist (fail-open)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const page = [pullRecord('p-9', { record: { _id: 'p-9', tenantId: 't-FREMD' } })]

    // Erstinstallation / Pairing vor dem Restamp: Ein Guard, der hier anschlaegt,
    // meldete jeden regulaeren Bootstrap als Vorfall.
    const undef = await applyPulledRecords(app, 'products', page, { expectedTenantId: undefined })
    assert.strictEqual(undef.foreignTenant, 0)

    store.clear()
    const nul = await applyPulledRecords(app, 'products', page, { expectedTenantId: null })
    assert.strictEqual(nul.foreignTenant, 0)

    assert.strictEqual(connectionPatches.length, 0)
    const events = warn.mock.calls.map(([arg]) => (arg as { event?: string })?.event)
    assert.ok(!events.includes('sync.pull.foreign_tenant_record'))
  })

  it('laesst den Pull-Apply nicht scheitern, wenn die Raste nicht schreibbar ist', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    // Die Diagnose darf nie die Daten kosten, die sie schuetzen soll.
    connectionRow = undefined
    const page = [pullRecord('p-9', { record: { _id: 'p-9', tenantId: 't-FREMD' } })]

    const result = await applyPulledRecords(app, 'products', page, { expectedTenantId: 't-1' })

    assert.strictEqual(result.applied, 1)
    assert.strictEqual(result.foreignTenant, 1)
    const events = warn.mock.calls.map(([arg]) => (arg as { event?: string })?.event)
    assert.ok(events.includes('sync.pull.foreign_tenant_record'), 'der Befund bleibt im Log')
  })

  it('detectForeignTenantId: die Fallunterscheidung isoliert', () => {
    assert.strictEqual(detectForeignTenantId('t-1', { tenantId: 't-2' }), 't-2')
    assert.strictEqual(detectForeignTenantId('t-1', { tenantId: 't-1' }), null)
    assert.strictEqual(detectForeignTenantId('t-1', {}), null, 'Service ohne tenantId')
    assert.strictEqual(detectForeignTenantId('t-1', { tenantId: '' }), null, 'Leerstring ist kein Mismatch')
    assert.strictEqual(detectForeignTenantId('t-1', { tenantId: 42 }), null, 'Nicht-String ist kein Mismatch')
    assert.strictEqual(detectForeignTenantId(undefined, { tenantId: 't-2' }), null)
    assert.strictEqual(detectForeignTenantId(null, { tenantId: 't-2' }), null)
    assert.strictEqual(detectForeignTenantId('', { tenantId: 't-2' }), null)
  })
})
