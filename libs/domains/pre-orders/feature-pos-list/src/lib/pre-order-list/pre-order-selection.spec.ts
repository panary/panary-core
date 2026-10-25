import type { PreOrder } from '@panary/pre-orders/data-access'
import { describe, expect, it, vi } from 'vitest'
import { findRequestedPreOrder } from './pre-order-selection'

const preOrder = (id: string, status: string) => ({ _id: id, status }) as unknown as PreOrder

describe('findRequestedPreOrder (core#1025)', () => {
  it('nimmt die Vorbestellung aus der geladenen Liste, ohne nachzuladen', async () => {
    const load = vi.fn()
    const listed = [preOrder('a', 'pending'), preOrder('b', 'pending')]
    expect(await findRequestedPreOrder('b', listed, load)).toBe(listed[1])
    expect(load).not.toHaveBeenCalled()
  })

  it('holt eine heute schon fällige, noch offene Vorbestellung einzeln', async () => {
    const overdue = preOrder('c', 'pending')
    const load = vi.fn().mockResolvedValue(overdue)
    expect(await findRequestedPreOrder('c', [preOrder('a', 'pending')], load)).toBe(overdue)
    expect(load).toHaveBeenCalledWith('c')
  })

  it('liefert null für eine abgeholte oder stornierte Vorbestellung', async () => {
    expect(await findRequestedPreOrder('c', [], vi.fn().mockResolvedValue(preOrder('c', 'converted')))).toBeNull()
    expect(await findRequestedPreOrder('c', [], vi.fn().mockResolvedValue(preOrder('c', 'canceled')))).toBeNull()
  })

  it('liefert null, wenn das Nachladen scheitert', async () => {
    expect(await findRequestedPreOrder('x', [], vi.fn().mockRejectedValue(new Error('NotFound')))).toBeNull()
  })
})
