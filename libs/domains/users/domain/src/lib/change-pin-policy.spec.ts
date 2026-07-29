import { describe, expect, it } from 'vitest'

import { checkChangePinRequest, POS_PIN_PATTERN } from './change-pin-policy'
import { UserSystemRole } from './user.schema'

const VALID = { userId: 'u1', currentPin: '1234', newPin: '5678' }

const devicePos = { _id: 'device:d1', role: UserSystemRole.DEVICE_POS }
const staff = { _id: 'u1', role: UserSystemRole.TENANT_STAFF }
const owner = { _id: 'u9', role: UserSystemRole.TENANT_OWNER }

describe('checkChangePinRequest', () => {
  it('gültiger Request → keine Verletzung', () => {
    expect(checkChangePinRequest(devicePos, VALID)).toBeNull()
  })

  it.each([
    ['userId', { ...VALID, userId: undefined }],
    ['currentPin', { ...VALID, currentPin: undefined }],
    ['newPin', { ...VALID, newPin: undefined }],
  ])('fehlendes %s → MISSING_INPUT', (_field, input) => {
    expect(checkChangePinRequest(devicePos, input)?.reason).toBe('MISSING_INPUT')
  })

  // Der POS-Ziffernblock akzeptiert genau vier Stellen. Alles andere wuerde
  // den Mitarbeiter aussperren.
  it.each(['123', '12345', '123456', 'abcd', '12 4', ''])('newPin "%s" → INVALID_FORMAT', bad => {
    expect(checkChangePinRequest(devicePos, { ...VALID, newPin: bad })?.reason).toBe(
      bad === '' ? 'MISSING_INPUT' : 'INVALID_FORMAT',
    )
  })

  it('newPin === currentPin → SAME_PIN', () => {
    expect(checkChangePinRequest(devicePos, { ...VALID, newPin: VALID.currentPin })?.reason).toBe('SAME_PIN')
  })

  it('Geräte-Rollen dürfen für jeden Mitarbeiter aufrufen (Terminal bedient alle)', () => {
    expect(checkChangePinRequest(devicePos, { ...VALID, userId: 'irgendwer' })).toBeNull()
  })

  it('echte User-Session darf nur den eigenen PIN ändern', () => {
    expect(checkChangePinRequest(staff, { ...VALID, userId: 'u1' })).toBeNull()
    expect(checkChangePinRequest(staff, { ...VALID, userId: 'u2' })?.reason).toBe('FOREIGN_RECORD')
  })

  it('privilegierte Rollen dürfen fremde PINs setzen', () => {
    expect(checkChangePinRequest(owner, { ...VALID, userId: 'u2' })).toBeNull()
  })

  it('POS_PIN_PATTERN akzeptiert führende Nullen', () => {
    expect(POS_PIN_PATTERN.test('0000')).toBe(true)
    expect(POS_PIN_PATTERN.test('0042')).toBe(true)
  })
})
