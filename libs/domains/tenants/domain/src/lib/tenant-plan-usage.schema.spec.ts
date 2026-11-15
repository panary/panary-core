import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { SubscriptionStatus } from './tenant.enums'
import { PLATFORM_ONLY_TENANT_FIELDS, tenantPatchSchema, tenantSchema } from './tenant.schema'

/**
 * panary/panary-core#1434 (Teil von panary/panary-cloud#619): Die Plan-Limit-Zähler
 * liegen in `tenant.planUsage` statt in `subscription.current*Count`. Grund: 18 Schreiber
 * ersetzen `subscription` als Ganzes, ein dazwischen liegendes `$inc` ging verloren.
 * Die alten Felder bleiben als `@deprecated` im Schema, weil Bestandsdokumente sie tragen
 * und `additionalProperties: false` sie sonst ablehnte.
 */
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validate = getValidator(tenantPatchSchema, addFormats(new Ajv({}), formats))

const SUBSCRIPTION = { planCode: 'starter', status: SubscriptionStatus.ACTIVE }

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

describe('tenantPatchSchema — planUsage', () => {
  it('nimmt alle drei Zähler an', async () => {
    await expect(validate({ planUsage: { locations: 2, users: 5, devices: 3 } })).resolves.toBeTruthy()
  })

  it('nimmt Null-Zähler und ein leeres Objekt an (Bestandsmandant vor dem ersten Abgleich)', async () => {
    await expect(validate({ planUsage: { locations: 0, users: 0, devices: 0 } })).resolves.toBeTruthy()
    await expect(validate({ planUsage: {} })).resolves.toBeTruthy()
  })

  it('lehnt einen negativen Zähler ab', async () => {
    expect(await rejectionKeywords({ planUsage: { users: -1 } })).toEqual(['minimum'])
  })

  it('lehnt null und Nicht-Zahlen ab — kein zweiter Leer-Zustand', async () => {
    expect(await rejectionKeywords({ planUsage: { locations: null } })).toEqual(['type'])
    expect(await rejectionKeywords({ planUsage: { devices: '3' } })).toEqual(['type'])
  })

  it('lehnt ein unbekanntes Zählerfeld ab', async () => {
    expect(await rejectionKeywords({ planUsage: { locations: 1, kitchens: 1 } })).toEqual(['additionalProperties'])
  })

  it('ist Teil des Tenant-Schemas (nicht nur des Patch-Schemas)', () => {
    expect(tenantSchema.properties['planUsage']).toBeDefined()
  })
})

describe('tenantPatchSchema — subscription.current*Count (@deprecated)', () => {
  it('nimmt Bestandsdokumente mit den alten Zählern weiterhin an', async () => {
    const subscription = { ...SUBSCRIPTION, currentLocationCount: 1, currentUserCount: 4, currentDeviceCount: 2 }
    await expect(validate({ subscription })).resolves.toBeTruthy()
  })

  it('nimmt eine subscription ohne die alten Zähler an', async () => {
    await expect(validate({ subscription: { ...SUBSCRIPTION } })).resolves.toBeTruthy()
  })
})

describe('PLATFORM_ONLY_TENANT_FIELDS — planUsage', () => {
  it('enthält planUsage neben subscription', () => {
    expect(PLATFORM_ONLY_TENANT_FIELDS).toContain('planUsage')
    expect(PLATFORM_ONLY_TENANT_FIELDS).toContain('subscription')
  })
})
