import { describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', async importOriginal => ({
  ...(await importOriginal<typeof import('@panary/shared-backend')>()),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { orderDataResolver } from './orders.schema'

// core#1311: Eine Geraete-Session ohne Bediener-Token landete mit der Geraete-UUID als `createdBy`.
const DEVICE_ID = '01a19ef5-e2c5-7ff7-85a9-dc0f0b4fbaed'
const resolve = (params: Record<string, unknown>, creationContext?: Record<string, unknown>) =>
  orderDataResolver.resolve({ creationContext } as never, { params, app: { service: vi.fn() } } as never) as Promise<{
    creationContext?: { createdBy?: string }
  }>

describe('orderDataResolver.creationContext — Bediener statt Geraet (core#1311)', () => {
  it('nimmt in einer Geraete-Session ohne Token den Body-Wert, nie die Geraete-UUID', async () => {
    const result = await resolve({ user: { _id: `device:${DEVICE_ID}` } }, { createdBy: 'bediener-1' })
    expect(result.creationContext?.createdBy).toBe('bediener-1')
  })

  it('bevorzugt das Bediener-Token', async () => {
    const result = await resolve(
      { user: { _id: `device:${DEVICE_ID}` }, posOperator: { userId: 'bediener-2' } },
      { createdBy: 'bediener-1' },
    )
    expect(result.creationContext?.createdBy).toBe('bediener-2')
  })

  it('behaelt die JWT-Session des Users', async () => {
    const result = await resolve({ user: { _id: 'user-9' } }, { createdBy: 'bediener-1' })
    expect(result.creationContext?.createdBy).toBe('user-9')
  })
})
