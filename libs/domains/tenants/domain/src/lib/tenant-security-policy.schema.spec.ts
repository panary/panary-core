import { describe, expect, it } from 'vitest'

import { securityPolicySchema } from './tenant.schema'

describe('securityPolicySchema', () => {
  const props = securityPolicySchema.properties as Record<string, unknown>

  it('kennt nur mfaRequired und mfaGracePeriodDays', () => {
    expect(Object.keys(props).sort()).toEqual(['mfaGracePeriodDays', 'mfaRequired'])
  })

  it('kennt die gestrichenen Felder ohne Leser nicht mehr (#1496)', () => {
    expect(props['passwordMinLength']).toBeUndefined()
    expect(props['sessionMaxAgeHours']).toBeUndefined()
  })

  it('lehnt unbekannte Felder weiterhin ab', () => {
    expect(securityPolicySchema.additionalProperties).toBe(false)
  })
})
