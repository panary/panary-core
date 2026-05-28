import { beforeEach, describe, expect, it, vi } from 'vitest'

// Domain-Module + uuidv7 werden gemockt, damit Vitest keine Domain-Source
// kompilieren muss und die Outbox-Werte deterministisch sind.
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

const isSyncPushBlockedRole = vi.fn(() => false)
const stripUserEdgeLocalFields = vi.fn((record: Record<string, unknown>) => record)
vi.mock('@panary/users/domain', () => ({
  isSyncPushBlockedRole: (role: unknown) => isSyncPushBlockedRole(role),
  stripUserEdgeLocalFields: (record: Record<string, unknown>) => stripUserEdgeLocalFields(record),
}))
vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { recordSyncOutbox } from './sync-outbox-recorder.hook'

const noopNext = (async () => {}) as any

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
  isSyncPushBlockedRole.mockReturnValue(false)
  stripUserEdgeLocalFields.mockImplementation((record) => record)
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

  it('überspringt Users mit sync-blockierter Rolle (Defense-in-Depth)', async () => {
    isSyncPushBlockedRole.mockReturnValue(true)
    const { ctx, outboxCreate } = makeContext({
      path: 'users',
      method: 'create',
      result: { _id: 'u-1', role: 'tenant:owner' },
    })

    await recordSyncOutbox(ctx as any, noopNext)

    expect(outboxCreate).not.toHaveBeenCalled()
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
