import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { SubscriptionStatus } from './tenant.enums'
import { tenantPatchSchema } from './tenant.schema'

/**
 * panary/panary-core#408: Die Cloud schreibt bei Self-Service-Kündigung
 * `subscription.cancelAtPeriodEnd` und beim Downgrade zum Periodenende
 * `subscription.pendingPlanCode`. `subscriptionSchema` kannte beide nicht
 * (`additionalProperties: false`), und `validateData` läuft auch für interne
 * Aufrufe — jeder solche Patch scheiterte mit „must NOT have additional properties".
 *
 * `pendingPlanCode` wird durch Weglassen entfernt, nie durch `null`
 * (`subscription` wird als Ganzes ersetzt). Der letzte Block hält fest, dass
 * `null` und `''` abgelehnt bleiben.
 */
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validate = getValidator(tenantPatchSchema, addFormats(new Ajv({}), formats))

const BASE = { planCode: 'starter', status: SubscriptionStatus.ACTIVE }

/**
 * Keywords der AJV-Fehler. Ein blankes `rejects.toThrow()` bliebe auch grün, wenn das
 * Feld fehlte — dann scheiterte der Patch an `additionalProperties`, nicht an der Regel,
 * die der Test benennt.
 */
async function rejectionKeywords(data: unknown): Promise<string[]> {
  try {
    await validate(data as never)
  } catch (error) {
    return ((error as { errors?: { keyword: string }[] }).errors ?? []).map(e => e.keyword)
  }
  throw new Error('Patch wurde angenommen, erwartet war eine Ablehnung')
}

describe('tenantPatchSchema — subscription.cancelAtPeriodEnd / pendingPlanCode', () => {
  it('nimmt die Self-Service-Kündigung an (cancelAtPeriodEnd: true + Grund)', async () => {
    const subscription = { ...BASE, cancelAtPeriodEnd: true, cancelReason: 'zu teuer' }
    await expect(validate({ subscription })).resolves.toBeTruthy()
  })

  it('nimmt einen vorgemerkten Downgrade an (pendingPlanCode)', async () => {
    await expect(validate({ subscription: { ...BASE, planCode: 'pro', pendingPlanCode: 'starter' } })).resolves.toBeTruthy()
  })

  it('nimmt eine subscription ohne beide Felder weiterhin an (Entfernen durch Weglassen)', async () => {
    await expect(validate({ subscription: { ...BASE } })).resolves.toBeTruthy()
  })

  it('lehnt pendingPlanCode: null ab — keine zweite Löschsemantik', async () => {
    expect(await rejectionKeywords({ subscription: { ...BASE, pendingPlanCode: null } })).toEqual(['type'])
  })

  it("lehnt pendingPlanCode: '' ab (minLength wie planCode)", async () => {
    expect(await rejectionKeywords({ subscription: { ...BASE, pendingPlanCode: '' } })).toEqual(['minLength'])
  })

  it('lehnt cancelAtPeriodEnd als String ab', async () => {
    expect(await rejectionKeywords({ subscription: { ...BASE, cancelAtPeriodEnd: 'true' } })).toEqual(['type'])
  })

  it('bleibt geschlossen: ein unbekanntes subscription-Feld wird weiter abgelehnt', async () => {
    expect(await rejectionKeywords({ subscription: { ...BASE, somethingElse: 1 } })).toEqual(['additionalProperties'])
  })
})
