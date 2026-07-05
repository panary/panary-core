import { describe, expect, it } from 'vitest'

import { fiscalSignContextFromBusinessDay, requiresFiscalSignature, resolveFiscalSignContext } from './fiscal-gate'

describe('requiresFiscalSignature', () => {
  it('pos-cashier → true', () => {
    expect(requiresFiscalSignature({ operationMode: 'pos-cashier' })).toBe(true)
  })

  it('orders-only → false', () => {
    expect(requiresFiscalSignature({ operationMode: 'orders-only' })).toBe(false)
  })

  it('undefined/null → false (kein fiskalischer Vorgang)', () => {
    expect(requiresFiscalSignature({})).toBe(false)
    expect(requiresFiscalSignature({ operationMode: null })).toBe(false)
  })
})

describe('fiscalSignContextFromBusinessDay', () => {
  it('pos-cashier → sign:true mit Zähler-Scope aus dem Snapshot', () => {
    expect(
      fiscalSignContextFromBusinessDay({ operationMode: 'pos-cashier', tenantId: 't-1', locationId: 'l-1' }),
    ).toEqual({ sign: true, tenantId: 't-1', locationId: 'l-1' })
  })

  it('orders-only → sign:false (einziger Fall, der die Signatur unterdrückt)', () => {
    expect(
      fiscalSignContextFromBusinessDay({ operationMode: 'orders-only', tenantId: 't-1', locationId: 'l-1' }),
    ).toEqual({ sign: false, tenantId: 't-1', locationId: 'l-1' })
  })

  it('fail-safe: fehlender operationMode → sign:true, Scope bleibt erhalten', () => {
    expect(fiscalSignContextFromBusinessDay({ tenantId: 't-1', locationId: 'l-1' })).toEqual({
      sign: true,
      tenantId: 't-1',
      locationId: 'l-1',
    })
  })

  it('fail-safe: fehlender Snapshot → sign:true ohne Scope', () => {
    expect(fiscalSignContextFromBusinessDay(undefined)).toEqual({
      sign: true,
      tenantId: undefined,
      locationId: undefined,
    })
  })

  it('locationId null → undefined (Zähler-Scope braucht eine konkrete Filiale)', () => {
    expect(
      fiscalSignContextFromBusinessDay({ operationMode: 'pos-cashier', tenantId: 't-1', locationId: null }),
    ).toEqual({ sign: true, tenantId: 't-1', locationId: undefined })
  })
})

describe('resolveFiscalSignContext', () => {
  it('kein businessDayId → fail-safe sign:true ohne Loader-Aufruf', async () => {
    let called = false
    const result = await resolveFiscalSignContext(undefined, async () => {
      called = true
      return { operationMode: 'orders-only' }
    })
    expect(result).toEqual({ sign: true })
    expect(called).toBe(false)
  })

  it('Loader-Fehler → fail-safe sign:true (§146a: lieber über-signieren)', async () => {
    const result = await resolveFiscalSignContext('bd-1', async () => {
      throw new Error('lookup failed')
    })
    expect(result).toEqual({ sign: true })
  })

  it('geladener orders-only-Snapshot unterdrückt die Signatur', async () => {
    const result = await resolveFiscalSignContext('bd-1', async () => ({
      operationMode: 'orders-only',
      tenantId: 't-1',
      locationId: 'l-1',
    }))
    expect(result).toEqual({ sign: false, tenantId: 't-1', locationId: 'l-1' })
  })

  it('geladener pos-cashier-Snapshot signiert mit Scope', async () => {
    const result = await resolveFiscalSignContext('bd-1', async () => ({
      operationMode: 'pos-cashier',
      tenantId: 't-1',
      locationId: 'l-1',
    }))
    expect(result).toEqual({ sign: true, tenantId: 't-1', locationId: 'l-1' })
  })
})
