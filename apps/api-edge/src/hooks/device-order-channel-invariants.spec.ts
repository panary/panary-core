import { describe, expect, it } from 'vitest'

import {
  DEVICE_ORDER_CHANNEL_WRITE_ROLES,
  DeviceOrderChannel,
  deviceDataSchema,
  SELF_PATCHABLE_DEVICE_FIELDS,
} from '@panary/devices/domain'
import { OrderChannel } from '@panary/orders/domain'
import { RolePermissions, UserSystemRole } from '@panary/users/domain'

// Invarianten der Standard-Bestellart (panary/panary-core#1166). Sie koennen nur hier stehen:
// die devices-Domain haelt die Werte als String-Literale, weil sie orders-/users-Domain
// nicht importieren darf (CLAUDE.md §2.1); api-edge sieht alle drei Libs.
describe('Standard-Bestellart: Domain-Literale gegen die Quellen der Wahrheit', () => {
  it('DeviceOrderChannel spiegelt OrderChannel.POS und OrderChannel.TELEPHONE', () => {
    expect(DeviceOrderChannel.POS).toBe(OrderChannel.POS)
    expect(DeviceOrderChannel.TELEPHONE).toBe(OrderChannel.TELEPHONE)
    expect(Object.keys(DeviceOrderChannel).sort()).toEqual(['POS', 'TELEPHONE'])
  })

  it('Schreibrollen sind echte Rollen der Matrix', () => {
    const known = new Set<string>(Object.keys(RolePermissions))
    for (const role of DEVICE_ORDER_CHANNEL_WRITE_ROLES) expect(known.has(role), role).toBe(true)
    expect(DEVICE_ORDER_CHANNEL_WRITE_ROLES.has(UserSystemRole.TENANT_OWNER)).toBe(true)
    expect(DEVICE_ORDER_CHANNEL_WRITE_ROLES.has(UserSystemRole.TENANT_TECHNICIAN)).toBe(false)
  })

  it('das Feld ist weder self-patchbar noch Teil von deviceDataSchema', () => {
    expect(SELF_PATCHABLE_DEVICE_FIELDS.has('defaultOrderChannel')).toBe(false)
    expect(Object.keys(deviceDataSchema.properties)).not.toContain('defaultOrderChannel')
  })
})
