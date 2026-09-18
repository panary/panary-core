import { UserSystemRole } from '@panary/users/domain'
import { describe, expect, it } from 'vitest'

import { APIKEY_DEVICE_ROLES, apikeyDataSchema, apikeySchema } from './apikey.schema'

/**
 * Anker fuer panary/panary-core#334.
 *
 * Das Schema liegt hier, wirkt aber in BEIDEN Repos: panary-cloud zieht
 * `apikeyDataSchema` aus dem Registry-Paket `@panary/apikeys/domain` und
 * definiert kein eigenes. Ein Test in api-edge allein wuerde die Cloud-Seite
 * nicht abdecken — dieser hier gehoert deshalb an die Quelle.
 *
 * Geprueft wird die Schema-FORM (welche Werte das Enum traegt). Dass der
 * Validator daraus tatsaechlich einen 400 macht, prueft
 * `apps/api-edge/src/services/apikeys/apikeys.schema.spec.ts` gegen den echten
 * `apikeyDataValidator`.
 */

/** Liest die zulaessigen Werte aus einem `StringEnum`-Knoten. */
const enumValues = (node: unknown): string[] => (node as { enum?: string[] }).enum ?? []

// `Type.Intersect` loest unter TypeBox 0.25 FLACH auf: Das Ergebnis ist ein
// einzelnes Objekt-Schema mit zusammengefuehrten `properties`/`required`, kein
// `allOf`-Array. Gemessen am 2026-09-18; bei einem TypeBox-Bump mitpruefen.
const dataRoleNode = apikeyDataSchema.properties['role']

describe('APIKEY_DEVICE_ROLES', () => {
  it('ist genau die Menge der DEVICE_*-Rollen', () => {
    // Gegenprobe aus dem Enum statt einer zweiten Literal-Liste: Kommt eine
    // fuenfte Geraeterolle dazu, faellt dieser Test auf und zwingt zu einer
    // Entscheidung, statt sie stillschweigend auszusperren.
    const deviceRoles = Object.values(UserSystemRole).filter(role => role.startsWith('device:'))
    expect([...APIKEY_DEVICE_ROLES].sort()).toEqual([...deviceRoles].sort())
  })

  it('enthaelt keine Tenant- oder Plattform-Rolle', () => {
    for (const role of APIKEY_DEVICE_ROLES) {
      expect(role.startsWith('tenant:'), `${role} ist keine Geraeterolle`).toBe(false)
      expect(role.startsWith('platform:'), `${role} ist keine Geraeterolle`).toBe(false)
    }
  })
})

describe('apikeyDataSchema.role — der Deckel bei der Anlage', () => {
  it('laesst nur die vier Geraeterollen zu', () => {
    expect(enumValues(dataRoleNode).sort()).toEqual([...APIKEY_DEVICE_ROLES].sort())
  })

  it('kennt platform:owner nicht mehr', () => {
    expect(enumValues(dataRoleNode)).not.toContain(UserSystemRole.PLATFORM_OWNER)
    expect(enumValues(dataRoleNode)).not.toContain(UserSystemRole.TENANT_OWNER)
  })

  it('bleibt optional — ohne Angabe leitet der Resolver aus device.type ab', () => {
    expect(apikeyDataSchema.required ?? []).not.toContain('role')
  })
})

describe('apikeySchema.role — das Lese-Schema bleibt weit', () => {
  // 🚨 Der eigentliche Punkt dieses Blocks: Wuerde jemand die Einschraenkung
  // „konsequenterweise" auch hier nachziehen, wuerfe jeder `find`, der eine vor
  // #334 angelegte Zeile beruehrt, einen Validierungsfehler — die Admin-Liste
  // waere fuer den Mandanten tot, samt des Schluessels, den er sperren will.
  it('akzeptiert weiterhin jeden UserSystemRole-Wert', () => {
    expect(enumValues(apikeySchema.properties.role).sort()).toEqual([...Object.values(UserSystemRole)].sort())
  })

  it('kennt insbesondere die Bestands-Rollen tenant:owner und platform:owner', () => {
    expect(enumValues(apikeySchema.properties.role)).toContain(UserSystemRole.TENANT_OWNER)
    expect(enumValues(apikeySchema.properties.role)).toContain(UserSystemRole.PLATFORM_OWNER)
  })
})
