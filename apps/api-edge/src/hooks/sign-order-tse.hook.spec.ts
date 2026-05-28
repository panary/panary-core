import { beforeEach, describe, expect, it, vi } from 'vitest'

// Domain-Module werden gemockt, damit Vitest die Source-Index der
// `@panary/<domain>/domain`-Libs nicht kompilieren muss (bekannter
// Resolution-Konflikt im Workspace) und die Helfer deterministisch sind.
const requiresFiscalSignature = vi.fn((input: { operationMode?: string | null }) => input.operationMode === 'pos-cashier')

vi.mock('@panary/tse/domain', () => ({
  requiresFiscalSignature: (input: { operationMode?: string | null }) => requiresFiscalSignature(input),
  tseInfoFromStart: (ref: any) => ({ status: 'started', ...ref }),
  tseInfoFromSignature: (base: any, sig: any) => ({ ...base, status: 'signed', signatureValue: sig.signatureValue }),
  tseInfoFromError: (input: any) => ({
    status: 'failed',
    transactionNumber: input.transactionNumber,
    clientId: input.clientId,
    provider: input.provider ?? 'unknown',
    errorReason: input.error instanceof Error ? input.error.message : String(input.error),
  }),
  tseCancellationFromSignature: (sig: any, canceledAt: string) => ({
    status: 'canceled',
    canceledAt,
    signatureValue: sig.signatureValue,
  }),
  tseCancellationFromError: (error: unknown, canceledAt: string) => ({
    status: 'failed',
    canceledAt,
    errorReason: error instanceof Error ? error.message : String(error),
  }),
  tseRefFromInfo: (info: any) => ({
    transactionNumber: info.transactionNumber,
    clientId: info.clientId,
    startedAt: info.startedAt,
    provider: info.provider,
    simulated: info.simulated,
  }),
}))

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const allocateFiscalCounter = vi.fn()
vi.mock('../services/fiscal-counters/fiscal-counters', () => ({
  allocateFiscalCounter: (...args: unknown[]) => allocateFiscalCounter(...args),
}))

import { signOrderTseStart, signOrderTseFinish, signOrderTseCancel } from './sign-order-tse.hook'

// Minimaler Feathers-HookContext-Stub. `tsePort` wird über app.get('tsePort')
// geliefert; businessdays/orders-Services über app.service(path).
function makeContext(opts: {
  tsePort?: Record<string, ReturnType<typeof vi.fn>> | null
  data?: any
  id?: string | null
  businessDay?: any
  currentOrder?: any
  user?: any
}): any {
  const services: Record<string, any> = {
    businessdays: { get: vi.fn().mockResolvedValue(opts.businessDay ?? { operationMode: 'pos-cashier' }) },
    orders: { get: vi.fn().mockResolvedValue(opts.currentOrder ?? {}) },
  }
  return {
    app: {
      get: (key: string) => (key === 'tsePort' ? (opts.tsePort ?? undefined) : undefined),
      service: (path: string) => services[path],
    },
    params: { user: opts.user ?? { deviceId: 'pos-1' } },
    data: opts.data,
    id: opts.id ?? null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requiresFiscalSignature.mockImplementation((input) => input.operationMode === 'pos-cashier')
  allocateFiscalCounter.mockResolvedValue(42)
})

describe('signOrderTseStart', () => {
  it('setzt einen started-TSE-Snapshot bei aktiver TSE im pos-cashier-Modus', async () => {
    const startTransaction = vi.fn().mockResolvedValue({
      transactionNumber: 42,
      clientId: 'pos-1',
      provider: 'SIMULATOR',
      simulated: true,
      startedAt: '2026-05-29T10:00:00.000Z',
    })
    const data = { dailySequenceNumber: 7, businessDayId: 'bd-1', tenantId: 't-1', locationId: 'l-1' }
    const ctx = makeContext({ tsePort: { startTransaction }, data, businessDay: { operationMode: 'pos-cashier' } })

    await signOrderTseStart(ctx)

    expect(startTransaction).toHaveBeenCalledTimes(1)
    expect(data).toHaveProperty('tse')
    expect((data as any).tse.status).toBe('started')
  })

  it('ist ein No-Op ohne aktive TSE (kein tsePort gesetzt)', async () => {
    const data = { dailySequenceNumber: 7 }
    const ctx = makeContext({ tsePort: null, data })

    await signOrderTseStart(ctx)

    expect((data as any).tse).toBeUndefined()
  })

  it('signiert orders-only-Vorgänge NICHT (Fiskal-Gate)', async () => {
    const startTransaction = vi.fn()
    const data = { dailySequenceNumber: 7, businessDayId: 'bd-1' }
    const ctx = makeContext({ tsePort: { startTransaction }, data, businessDay: { operationMode: 'orders-only' } })

    await signOrderTseStart(ctx)

    expect(startTransaction).not.toHaveBeenCalled()
    expect((data as any).tse).toBeUndefined()
  })

  it('Idempotenz: bereits gesetzter tse-Snapshot verhindert erneutes Signieren', async () => {
    const startTransaction = vi.fn()
    const data = { dailySequenceNumber: 7, businessDayId: 'bd-1', tse: { status: 'started' } }
    const ctx = makeContext({ tsePort: { startTransaction }, data })

    await signOrderTseStart(ctx)

    expect(startTransaction).not.toHaveBeenCalled()
  })

  it('§146a: TSE-Start-Fehler blockiert nicht — Order bleibt mit failed-Snapshot', async () => {
    const startTransaction = vi.fn().mockRejectedValue(new Error('TSE down'))
    const data = { dailySequenceNumber: 7, businessDayId: 'bd-1', tenantId: 't-1', locationId: 'l-1' }
    const ctx = makeContext({ tsePort: { startTransaction }, data, businessDay: { operationMode: 'pos-cashier' } })

    await expect(signOrderTseStart(ctx)).resolves.toBeDefined()
    expect((data as any).tse.status).toBe('failed')
  })
})

describe('signOrderTseFinish', () => {
  it('schreibt die Signatur beim Übergang auf completed', async () => {
    const finishTransaction = vi.fn().mockResolvedValue({ signatureValue: 'SIG-abc' })
    const data: any = { status: 'completed', payment: { totalAmount: 19.9 } }
    const ctx = makeContext({
      tsePort: { finishTransaction },
      data,
      id: 'order-1',
      currentOrder: { tse: { status: 'started', transactionNumber: 42, clientId: 'pos-1', provider: 'SIMULATOR' } },
    })

    await signOrderTseFinish(ctx)

    expect(finishTransaction).toHaveBeenCalledTimes(1)
    expect(data.tse.status).toBe('signed')
    expect(data.tse.signatureValue).toBe('SIG-abc')
  })

  it('Idempotenz: ein bereits signierter Vorgang wird nicht erneut abgeschlossen', async () => {
    const finishTransaction = vi.fn()
    const data: any = { status: 'completed', payment: { totalAmount: 10 } }
    const ctx = makeContext({
      tsePort: { finishTransaction },
      data,
      id: 'order-1',
      currentOrder: { tse: { status: 'signed', transactionNumber: 42, clientId: 'pos-1' } },
    })

    await signOrderTseFinish(ctx)

    expect(finishTransaction).not.toHaveBeenCalled()
  })

  it('No-Op bei einem anderen Status als completed', async () => {
    const finishTransaction = vi.fn()
    const data: any = { status: 'active' }
    const ctx = makeContext({ tsePort: { finishTransaction }, data, id: 'order-1' })

    await signOrderTseFinish(ctx)

    expect(finishTransaction).not.toHaveBeenCalled()
  })
})

describe('signOrderTseCancel', () => {
  it('signiert den Storno beim Übergang auf aborted', async () => {
    const cancelTransaction = vi.fn().mockResolvedValue({ signatureValue: 'CANCEL-1' })
    const data: any = { status: 'aborted', cancellation: { canceledAt: '2026-05-29T12:00:00.000Z' } }
    const ctx = makeContext({
      tsePort: { cancelTransaction },
      data,
      id: 'order-1',
      currentOrder: { tse: { status: 'signed', transactionNumber: 42, clientId: 'pos-1', provider: 'SIMULATOR' } },
    })

    await signOrderTseCancel(ctx)

    expect(cancelTransaction).toHaveBeenCalledTimes(1)
    expect(data.tse.cancellation.status).toBe('canceled')
  })

  it('Idempotenz: ein bereits stornierter Vorgang wird nicht erneut signiert', async () => {
    const cancelTransaction = vi.fn()
    const data: any = { status: 'aborted' }
    const ctx = makeContext({
      tsePort: { cancelTransaction },
      data,
      id: 'order-1',
      currentOrder: { tse: { status: 'signed', cancellation: { status: 'canceled' }, transactionNumber: 42, clientId: 'pos-1' } },
    })

    await signOrderTseCancel(ctx)

    expect(cancelTransaction).not.toHaveBeenCalled()
  })

  it('§146a: ein Storno-Fehler blockiert nicht — cancellation wird als failed markiert', async () => {
    const cancelTransaction = vi.fn().mockRejectedValue(new Error('TSE down'))
    const data: any = { status: 'aborted', cancellation: { canceledAt: '2026-05-29T12:00:00.000Z' } }
    const ctx = makeContext({
      tsePort: { cancelTransaction },
      data,
      id: 'order-1',
      currentOrder: { tse: { status: 'signed', transactionNumber: 42, clientId: 'pos-1', provider: 'SIMULATOR' } },
    })

    await expect(signOrderTseCancel(ctx)).resolves.toBeDefined()
    expect(data.tse.cancellation.status).toBe('failed')
  })
})
