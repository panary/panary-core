import { describe, expect, it } from 'vitest'

import { corporateCustomerDataResolver } from './corporate-customers.schema'

import type { HookContext } from '../../declarations'

// #511: Die Edge setzte für Firmenkunden ohne Status `DRAFT` — ein Wert, den die Cloud nicht
// kennt (`active | disabled | blocked | archived`, Default `active` seit panary/panary-cloud#932).
// Ein an der Edge angelegter Kunde stand dort als „Ohne Status“ und fiel durch jeden Filter.
const context = { method: 'create', params: {} } as unknown as HookContext

const resolveStatus = async (status?: string) => {
  const data = { name1: 'Edge GmbH', ...(status === undefined ? {} : { status }) }
  const resolved = (await corporateCustomerDataResolver.resolve(data as never, context as never)) as { status?: string }
  return resolved.status
}

describe('corporateCustomerDataResolver (Edge) — status (#511)', () => {
  it('ohne status → active, nicht DRAFT', async () => {
    expect(await resolveStatus()).toBe('active')
  })

  it('leerer status → active', async () => {
    expect(await resolveStatus('')).toBe('active')
  })

  it.each(['disabled', 'blocked', 'archived', 'DRAFT'])('mitgeschicktes %s bleibt erhalten (Sync, POS)', async s => {
    expect(await resolveStatus(s)).toBe(s)
  })
})
