import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequest } from '@feathersjs/errors'

// `@feathersjs/errors` bleibt echt (wir asserten auf den Fehlertyp). Die reine
// Transition-Funktion aus `@panary/orders/domain` wird gemockt — sie ist in
// `order-state-machine.spec.ts` (Domain-Projekt) erschöpfend getestet; hier
// interessiert nur die Hook-Orchestrierung (provider-/status-/id-Gates,
// Vorstatus-Load, BadRequest-Wrapping).
const assertValidOrderStatusTransition = vi.fn()
vi.mock('@panary/orders/domain', () => ({
  assertValidOrderStatusTransition: (...a: unknown[]) => assertValidOrderStatusTransition(...a),
}))

import { validateOrderStatusTransition } from './validate-order-status-transition.hook'
import type { HookContext } from '@feathersjs/feathers'

const buildContext = (opts: {
  method?: string
  id?: string | null
  provider?: string
  data?: Record<string, unknown>
  before?: { _id: string; status: string }
  getSpy?: ReturnType<typeof vi.fn>
}): HookContext => {
  const getSpy = opts.getSpy ?? vi.fn(async () => opts.before)
  return {
    method: opts.method ?? 'patch',
    id: opts.id === undefined ? (opts.before?._id ?? '1') : opts.id,
    data: opts.data ?? {},
    params: { provider: opts.provider },
    service: { get: getSpy },
  } as unknown as HookContext
}

describe('validateOrderStatusTransition (Edge, Security „order-status-fsm")', () => {
  beforeEach(() => {
    assertValidOrderStatusTransition.mockReset()
  })

  it('illegaler Übergang → BadRequest (400), Vorstatus wurde geladen', async () => {
    assertValidOrderStatusTransition.mockImplementation(() => {
      throw new Error('Ungültiger Order-Status-Übergang: completed → active')
    })
    const getSpy = vi.fn(async () => ({ _id: '1', status: 'completed' }))
    const ctx = buildContext({ provider: 'socketio', data: { status: 'active' }, getSpy })
    await expect(validateOrderStatusTransition(ctx)).rejects.toBeInstanceOf(BadRequest)
    expect(getSpy).toHaveBeenCalledWith('1', { provider: undefined })
    expect(assertValidOrderStatusTransition).toHaveBeenCalledWith('completed', 'active')
  })

  it('legaler Übergang → passiert (Helper wirft nicht)', async () => {
    assertValidOrderStatusTransition.mockImplementation(() => undefined)
    const ctx = buildContext({
      provider: 'socketio',
      data: { status: 'completed' },
      before: { _id: '1', status: 'produced' },
    })
    await expect(validateOrderStatusTransition(ctx)).resolves.toBe(ctx)
    expect(assertValidOrderStatusTransition).toHaveBeenCalledWith('produced', 'completed')
  })

  it('interner Aufruf (kein provider) → weder Vorstatus-Load noch Helper', async () => {
    const getSpy = vi.fn()
    const ctx = buildContext({ provider: undefined, data: { status: 'active' }, getSpy })
    await expect(validateOrderStatusTransition(ctx)).resolves.toBe(ctx)
    expect(getSpy).not.toHaveBeenCalled()
    expect(assertValidOrderStatusTransition).not.toHaveBeenCalled()
  })

  it('Patch ohne status → kein Vorstatus-Load', async () => {
    const getSpy = vi.fn()
    const ctx = buildContext({ provider: 'socketio', data: { table: 'T-1' }, getSpy })
    await expect(validateOrderStatusTransition(ctx)).resolves.toBe(ctx)
    expect(getSpy).not.toHaveBeenCalled()
    expect(assertValidOrderStatusTransition).not.toHaveBeenCalled()
  })

  it('greift nur bei patch — create wird durchgelassen', async () => {
    const getSpy = vi.fn()
    const ctx = buildContext({ method: 'create', provider: 'socketio', data: { status: 'active' }, getSpy })
    await expect(validateOrderStatusTransition(ctx)).resolves.toBe(ctx)
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('Multi-Patch ohne id → nicht geprüft', async () => {
    const getSpy = vi.fn()
    const ctx = buildContext({ provider: 'socketio', id: null, data: { status: 'active' }, getSpy })
    await expect(validateOrderStatusTransition(ctx)).resolves.toBe(ctx)
    expect(getSpy).not.toHaveBeenCalled()
    expect(assertValidOrderStatusTransition).not.toHaveBeenCalled()
  })
})
