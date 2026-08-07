import { describe, expect, it } from 'vitest'

import { checkGrantAssignment, extractAddedGrants } from './grant-assignment-policy'
import { UserSystemRole } from './user.schema'

const owner = { _id: 'owner-1', role: UserSystemRole.TENANT_OWNER }

describe('checkGrantAssignment', () => {
  it('leere addedGrants → erlaubt (auch ohne Actor)', () => {
    expect(checkGrantAssignment(owner, [])).toBeNull()
    expect(checkGrantAssignment(undefined, [])).toBeNull()
  })

  it('fehlender Actor bei nicht-leeren Grants → MISSING_USER', () => {
    const violation = checkGrantAssignment(undefined, ['grant:orders:read'])
    expect(violation?.reason).toBe('MISSING_USER')
    expect(violation?.message).toBe('Authentifizierter User fehlt.')
  })

  it('TENANT_OWNER vergibt Grant innerhalb der eigenen Decke → erlaubt', () => {
    // Owner hat products: MANAGE und orders: READ+UPDATE in der Matrix.
    expect(checkGrantAssignment(owner, ['grant:products:manage'])).toBeNull()
    expect(checkGrantAssignment(owner, ['grant:orders:read'])).toBeNull()
  })

  it('TENANT_OWNER vergibt Grant oberhalb der eigenen Decke → ESCALATION', () => {
    // `accounts` ist Plattform-only — kein Matrix-Eintrag fuer TENANT_OWNER.
    const violation = checkGrantAssignment(owner, ['grant:accounts:manage'])
    expect(violation).toEqual({
      reason: 'ESCALATION',
      grant: 'grant:accounts:manage',
      message: 'Sie dürfen die Berechtigung „grant:accounts:manage" nicht vergeben.',
    })
  })

  it('gemischte Liste: erster unzulaessiger Grant wird gemeldet', () => {
    const violation = checkGrantAssignment(owner, ['grant:orders:read', 'grant:platform-config:manage'])
    expect(violation?.reason).toBe('ESCALATION')
    expect(violation?.grant).toBe('grant:platform-config:manage')
  })

  it('unbekannte Ressource/Aktion oder Formatfehler → INVALID_GRANT', () => {
    expect(checkGrantAssignment(owner, ['grant:doesnotexist:manage'])?.reason).toBe('INVALID_GRANT')
    expect(checkGrantAssignment(owner, ['grant:orders:fly'])?.reason).toBe('INVALID_GRANT')
    expect(checkGrantAssignment(owner, ['grant:kaputt'])).toEqual({
      reason: 'INVALID_GRANT',
      grant: 'grant:kaputt',
      message: 'Ungültige Berechtigung: grant:kaputt',
    })
  })

  it('eigene additive Grants erweitern die Decke des Akteurs', () => {
    // Manager hat users: READ+UPDATE — ohne eigenen Grant keine users:manage-Vergabe.
    const manager = { _id: 'mgr-1', role: UserSystemRole.TENANT_MANAGER }
    expect(checkGrantAssignment(manager, ['grant:users:manage'])?.reason).toBe('ESCALATION')

    const managerWithGrant = { ...manager, permissions: ['grant:users:manage'] }
    expect(checkGrantAssignment(managerWithGrant, ['grant:users:manage'])).toBeNull()
  })

  it('Plattform-Akteur wird auf TENANT_OWNER gedeckelt', () => {
    const platformAdmin = { _id: 'pa-1', role: UserSystemRole.PLATFORM_ADMIN }
    // Owner-Niveau bleibt vergebbar …
    expect(checkGrantAssignment(platformAdmin, ['grant:products:manage'])).toBeNull()
    // … aber Plattform-Rechte des Operators (accounts: MANAGE) NICHT.
    expect(checkGrantAssignment(platformAdmin, ['grant:accounts:manage'])?.reason).toBe('ESCALATION')
  })

  it('Impersonation (actAs) deckelt ebenfalls auf TENANT_OWNER — eigene Grants zaehlen nicht', () => {
    const impersonating = {
      _id: 'op-1',
      role: UserSystemRole.TENANT_OWNER,
      permissions: ['grant:accounts:manage'],
      actAs: { originalRole: UserSystemRole.PLATFORM_SUPPORT },
    }
    expect(checkGrantAssignment(impersonating, ['grant:orders:read'])).toBeNull()
    expect(checkGrantAssignment(impersonating, ['grant:accounts:manage'])?.reason).toBe('ESCALATION')
  })
})

describe('extractAddedGrants', () => {
  it('filtert Nicht-grant-Tokens (AppAbilities) heraus', () => {
    expect(extractAddedGrants(['can_discount', 'grant:orders:read', 'can_refund'], [])).toEqual(['grant:orders:read'])
  })

  it('Delta-Semantik: bereits gesetzte Grants werden nicht erneut geprueft', () => {
    expect(extractAddedGrants(['grant:accounts:manage', 'grant:orders:read'], ['grant:accounts:manage'])).toEqual([
      'grant:orders:read',
    ])
  })

  it('ignoriert Nicht-String-Eintraege defensiv', () => {
    expect(extractAddedGrants([42, null, { grant: 'x' }, 'grant:orders:read'], [])).toEqual(['grant:orders:read'])
  })

  it('leeres permissions-Array → keine Added Grants', () => {
    expect(extractAddedGrants([], [])).toEqual([])
  })
})
