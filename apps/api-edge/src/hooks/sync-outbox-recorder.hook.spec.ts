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

  it('überspringt Users mit sync-blockierter Rolle (Defense-in-Depth, echte Domain-Funktion)', async () => {
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'create',
      result: { _id: 'u-1', role: 'tenant:owner' },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).not.toHaveBeenCalled()
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
