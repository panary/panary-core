import { describe, expect, it } from 'vitest'
import { BadRequest } from '@feathersjs/errors'

// Anders als `validate-staff-meal-exclusivity.hook.spec.ts` wird die Domain-Funktion
// hier NICHT gemockt: Der Hook hat keine Merge-Logik, die ein Mock sichtbar machen
// müsste — er entscheidet allein am Payload. Mit der echten Funktion liest sich die
// Spec als Verhalten („ein Create mit discount wird abgelehnt") statt als
// Aufruf-Protokoll, und die Domain-Regel ist zusätzlich in
// `discount-mutex.spec.ts` abgedeckt.
import { rejectLegacyDiscount } from './reject-legacy-discount.hook'
import type { HookContext } from '@feathersjs/feathers'

const legacyDiscount = { discountType: 'percent' as const, discount: 10 }

const appliedDiscount = {
  _id: 'ad-1',
  name: 'Happy Hour',
  method: 'manual',
  target: 'order',
  valueType: 'percent',
  valuePercent: 10,
  valueCents: 0,
  computedAmountCents: 0,
  appliedAt: '2026-08-13T10:00:00.000Z',
}

const buildContext = (opts: { method?: string; provider?: string; data?: unknown }): HookContext =>
  ({
    method: opts.method ?? 'patch',
    id: '1',
    data: opts.data ?? {},
    params: { provider: opts.provider },
  }) as unknown as HookContext

describe('rejectLegacyDiscount (Edge)', () => {
  it('interne Aufrufe (kein provider) werden NIE geprüft — sonst wäre Sync-Apply terminal rejected', async () => {
    const ctx = buildContext({ method: 'create', data: { discount: legacyDiscount } })
    await expect(rejectLegacyDiscount(ctx)).resolves.toBe(ctx)
  })

  it('greift nicht bei find/get/remove', async () => {
    for (const method of ['find', 'get', 'remove']) {
      const ctx = buildContext({ method, provider: 'rest', data: { discount: legacyDiscount } })
      await expect(rejectLegacyDiscount(ctx)).resolves.toBe(ctx)
    }
  })

  describe('create', () => {
    it('gesetzter Legacy-discount → BadRequest (400)', async () => {
      const ctx = buildContext({ method: 'create', provider: 'rest', data: { discount: legacyDiscount } })
      await expect(rejectLegacyDiscount(ctx)).rejects.toBeInstanceOf(BadRequest)
    })

    it('prüft jeden Eintrag eines Multi-Creates', async () => {
      const ctx = buildContext({
        method: 'create',
        provider: 'rest',
        data: [{ appliedDiscounts: [appliedDiscount] }, { discount: legacyDiscount }],
      })
      await expect(rejectLegacyDiscount(ctx)).rejects.toBeInstanceOf(BadRequest)
    })

    it('appliedDiscounts allein passiert', async () => {
      const ctx = buildContext({
        method: 'create',
        provider: 'rest',
        data: { appliedDiscounts: [appliedDiscount] },
      })
      await expect(rejectLegacyDiscount(ctx)).resolves.toBe(ctx)
    })
  })

  describe('patch', () => {
    it('gesetzter Legacy-discount → BadRequest (400), auch neben appliedDiscounts', async () => {
      const ctx = buildContext({
        method: 'patch',
        provider: 'socketio',
        data: { discount: legacyDiscount, appliedDiscounts: [appliedDiscount] },
      })
      await expect(rejectLegacyDiscount(ctx)).rejects.toBeInstanceOf(BadRequest)
    })

    // Der Kernfall aus #181: Firmenkunde auf eine Order, die bereits appliedDiscounts
    // trägt. Der Hook braucht dafür KEINEN Vorzustand — der Schreibzugriff selbst ist
    // verboten, unabhängig davon, was in der DB steht.
    it('lehnt einen reinen discount-Patch ohne Blick in die DB ab', async () => {
      const ctx = buildContext({
        method: 'patch',
        provider: 'rest',
        data: { customerPaymentInfo: { customerId: 'c1' }, discount: legacyDiscount },
      })
      await expect(rejectLegacyDiscount(ctx)).rejects.toBeInstanceOf(BadRequest)
    })

    // Seit das Feld auch aus `orderSchema` entfernt ist, gibt es keinen erlaubten
    // Wert mehr — der Guard feuert auf die Anwesenheit des Schluessels, damit die
    // sprechende Meldung greift statt einer generischen Schema-Verletzung.
    it('auch discount: null wird abgelehnt', async () => {
      const ctx = buildContext({
        method: 'patch',
        provider: 'rest',
        data: { appliedDiscounts: [appliedDiscount], discount: null },
      })
      await expect(rejectLegacyDiscount(ctx)).rejects.toBeInstanceOf(BadRequest)
    })

    it('Patches ohne discount-Feld passieren unverändert', async () => {
      const ctx = buildContext({ method: 'patch', provider: 'rest', data: { status: 'completed' } })
      await expect(rejectLegacyDiscount(ctx)).resolves.toBe(ctx)
    })
  })
})
