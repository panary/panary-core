import { beforeEach, describe, expect, it, vi } from 'vitest'

// uuidv7 + Enum-Module werden gemockt, damit die Outbox-Werte deterministisch
// sind. @panary/users/domain wird bewusst NICHT gemockt: der
// USER_EDGE_LOCAL_FIELDS-Strip und der Rollen-Block sind sicherheitsrelevante
// Domain-Logik — die Spec muss die ECHTEN Funktionen treffen, sonst testet sie
// eine Identitaets-Attrappe (Review-Befund Stufe 4 #47).
vi.mock('uuidv7', () => ({ uuidv7: () => 'fixed-uuid' }))
vi.mock('@panary/edge-pairing/domain', () => ({
  SyncableTransactionService: {
    ORDERS: 'orders',
    ORDER_INTERACTIONS: 'order-interactions',
    WORKING_TIMES: 'working-times',
    CASH_SESSIONS: 'cash-sessions',
    AUDIT_EVENTS: 'audit-events',
    USERS: 'users',
  },
}))
vi.mock('@panary/sync/domain', () => ({
  SyncOp: { CREATE: 'create', PATCH: 'patch', REMOVE: 'remove' },
  SyncSource: { LIVE: 'live', BACKFILL: 'backfill' },
}))
vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { SYNC_PUSH_BLOCKED_USER_ROLES } from '@panary/users/domain'

import { recordSyncOutbox } from './sync-outbox-recorder.hook'

const noopNext = (async () => undefined) as any

// Stub-Context: `outboxCreate` ist der zu beobachtende sync-outbox.create().
function makeContext(opts: {
  path: string
  method: string
  result?: any
  id?: string
  outboxCreate?: ReturnType<typeof vi.fn>
  params?: any
}): { ctx: any; outboxCreate: ReturnType<typeof vi.fn> } {
  const outboxCreate = opts.outboxCreate ?? vi.fn().mockResolvedValue({})
  const ctx = {
    path: opts.path,
    method: opts.method,
    result: opts.result,
    id: opts.id,
    params: opts.params ?? {},
    app: { service: (path: string) => (path === 'sync-outbox' ? { create: outboxCreate } : { create: vi.fn() }) },
  }
  return { ctx, outboxCreate }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recordSyncOutbox', () => {
  it('schreibt einen create-Eintrag für einen sync-pflichtigen Pfad (orders)', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'orders',
      method: 'create',
      result: { _id: 'order-1', updatedAt: '2026-05-29T10:00:00.000Z' },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).toHaveBeenCalledTimes(1)
    const [payload] = outboxCreate.mock.calls[0]
    expect(payload).toMatchObject({ service: 'orders', op: 'create', entityId: 'order-1', syncSource: 'live' })
  })

  it('schreibt bei patch den PATCH-Op', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'working-times',
      method: 'patch',
      result: { _id: 'wt-1' },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate.mock.calls[0][0]).toMatchObject({ op: 'patch', entityId: 'wt-1' })
  })

  it('schreibt bei remove einen REMOVE-Op mit null-payload und nutzt context.id', async () => {
    const { ctx, outboxCreate } = makeContext({ path: 'orders', method: 'remove', id: 'order-9' })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate.mock.calls[0][0]).toMatchObject({ op: 'remove', entityId: 'order-9', payload: null })
  })

  it('ignoriert nicht-sync-pflichtige Pfade (No-Op)', async () => {
    const { ctx, outboxCreate } = makeContext({ path: 'products', method: 'create', result: { _id: 'p-1' } })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).not.toHaveBeenCalled()
  })

  it('nimmt den sync-outbox-Service selbst NICHT rekursiv auf', async () => {
    const { ctx, outboxCreate } = makeContext({ path: 'sync-outbox', method: 'create', result: { _id: 's-1' } })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).not.toHaveBeenCalled()
  })

  it('überspringt Cloud→Edge-Applies (params.fromSync) — kein Sync-Echo', async () => {
    // Pull-Apply/Bootstrap/Reconciliation patchen mit { fromSync: true } —
    // solche Mutationen stammen AUS der Cloud und duerfen nie zurueckgepusht
    // werden (Echo wuerde juengere Cloud-Staende ueberschreiben).
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'patch',
      result: { _id: 'u-sync', role: 'tenant:staff' },
      params: { fromSync: true },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).not.toHaveBeenCalled()
  })

  it('überspringt das ANLEGEN von Users mit sync-blockierter Rolle (Defense-in-Depth, echte Domain-Funktion)', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'create',
      result: { _id: 'u-1', role: 'tenant:owner' },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).not.toHaveBeenCalled()
  })

  // --- #220: die Pull/Push-Asymmetrie ---------------------------------------
  //
  // `tenant:owner` wird zum Edge GEPULLT (der Inhaber steht selbst an der
  // Kasse), stand aber im selben Skip wie `create`. Sein PIN-Wechsel am POS
  // landete deshalb nie in der Outbox — und der naechste Pull holte den alten
  // Hash samt `mustChangePosPin` zurueck.
  it('pusht einen PATCH auf tenant:owner — sonst erreicht der PIN-Wechsel die Cloud nie', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'patch',
      result: {
        _id: 'owner-1',
        role: 'tenant:owner',
        loginname: 'inhaber',
        posPin: 'edge-bcrypt-hash',
        mustChangePosPin: false,
      },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).toHaveBeenCalledTimes(1)
    const [entry] = outboxCreate.mock.calls[0]
    expect(entry.entityId).toBe('owner-1')
    // Der Edge schickt bewusst den VOLLEN Record — die Verengung auf
    // posPin/mustChangePosPin macht der Cloud-Receiver (panary-cloud#284,
    // ADR 0055). Eine zweite Feldliste hier waere eine Driftquelle.
    expect(entry.payload).toMatchObject({
      _id: 'owner-1',
      role: 'tenant:owner',
      posPin: 'edge-bcrypt-hash',
      mustChangePosPin: false,
    })
  })

  it('strippt USER_EDGE_LOCAL_FIELDS auch im Owner-Patch', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'patch',
      result: {
        _id: 'owner-1',
        role: 'tenant:owner',
        posPin: 'h',
        stampingId: 'wt-7',
        startBreakAt: '2026-08-14T09:00:00.000Z',
      },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    const [entry] = outboxCreate.mock.calls[0]
    expect(entry.payload).not.toHaveProperty('stampingId')
    expect(entry.payload).not.toHaveProperty('startBreakAt')
  })

  // Der eigentliche Regressionsschutz: Nicht „Owner geht durch", sondern
  // „was gepullt wird, kann zurueckschreiben". Der Cloud-Pull-Filter
  // (`sync-pull-strategies.ts`, users → `role: { $nin: [...] }`) schliesst
  // ausschliesslich `platform:*` aus. Jede Rolle der Push-Blockliste OHNE
  // dieses Praefix landet also am Edge und muss ihre Aenderungen zurueckbringen
  // koennen. Waechst die Blockliste um eine weitere tenant-Rolle und wandert
  // der Skip wieder auf alle Ops, faellt das hier auf — nicht erst, wenn ein
  // Kunde meldet, dass sein PIN „nicht bleibt".
  it.each([...SYNC_PUSH_BLOCKED_USER_ROLES].filter(role => !role.startsWith('platform:')).map(role => [role] as const))(
    'gepullte, aber push-gesperrte Rolle %s kann patchen (Asymmetrie-Guard)',
    async role => {
      const { ctx, outboxCreate } = makeContext({
        path: 'users',
        method: 'patch',
        result: { _id: 'u-x', role, posPin: 'h', mustChangePosPin: false },
      })

      await recordSyncOutbox(ctx as any, noopNext)

      expect(outboxCreate).toHaveBeenCalledTimes(1)
    },
  )

  it('remove bleibt unveraendert — der Rollen-Skip hat es nie erfasst', async () => {
    // Bei `remove` traegt `context.result` keine Rolle; der Filter griff hier
    // noch nie. Festgehalten, damit der Umbau von `op !== REMOVE` auf
    // `op === CREATE` nicht unbemerkt etwas an diesem Pfad verschiebt.
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'remove',
      id: 'owner-1',
      result: { _id: 'owner-1', role: 'tenant:owner' },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).toHaveBeenCalledTimes(1)
    expect(outboxCreate.mock.calls[0][0].payload).toBeNull()
  })

  it('pusht Users mit erlaubter Rolle und stript USER_EDGE_LOCAL_FIELDS (echte Domain-Funktion)', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'patch',
      result: {
        _id: 'u-2',
        role: 'tenant:staff',
        loginname: 'staff-1',
        stampingId: 'wt-42',
        startBreakAt: '2026-07-06T09:00:00.000Z',
      },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).toHaveBeenCalledTimes(1)
    const [payload] = outboxCreate.mock.calls[0]
    expect(payload.entityId).toBe('u-2')
    expect(payload.payload).toMatchObject({ _id: 'u-2', role: 'tenant:staff', loginname: 'staff-1' })
    expect(payload.payload).not.toHaveProperty('stampingId')
    expect(payload.payload).not.toHaveProperty('startBreakAt')
    // Original-Result bleibt unangetastet (stripUserEdgeLocalFields kopiert flach).
    expect(ctx.result.stampingId).toBe('wt-42')
  })

  it('übernimmt syncSource aus den params (backfill)', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'orders',
      method: 'create',
      result: { _id: 'order-2' },
      params: { syncSource: 'backfill' },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate.mock.calls[0][0]).toMatchObject({ syncSource: 'backfill' })
  })

  it('Best-Effort: ein Outbox-Schreibfehler bricht den Haupt-Flow NICHT ab', async () => {
    const outboxCreate = vi.fn().mockRejectedValue(new Error('disk full'))
    const { ctx } = makeContext({ path: 'orders', method: 'create', result: { _id: 'order-3' }, outboxCreate })

    await expect(recordSyncOutbox(ctx as any, noopNext)).resolves.toBe(ctx)
  })
})
