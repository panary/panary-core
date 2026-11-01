import { describe, expect, it } from 'vitest'

import {
  checkDeviceOrderChannelWrite,
  DEVICE_ORDER_CHANNEL_WRITE_ROLES,
  resolveDeviceOrderChannel,
  touchesDeviceOrderChannel,
} from './device-order-channel'

describe('checkDeviceOrderChannelWrite', () => {
  const body = { defaultOrderChannel: 'telephone' }

  it.each(['tenant:owner', 'platform:owner'])('%s darf setzen', role => {
    expect(checkDeviceOrderChannelWrite({ role }, body)).toBeNull()
  })

  it.each([
    'tenant:technician',
    'tenant:manager',
    'tenant:staff',
    'platform:admin',
    'platform:support',
    'device:pos-client',
    'device:tablet',
  ])('%s → FORBIDDEN_ROLE', role => {
    expect(checkDeviceOrderChannelWrite({ role }, body)?.reason).toBe('FORBIDDEN_ROLE')
  })

  it('Actor ohne Rolle oder fehlender Actor → FORBIDDEN_ROLE', () => {
    expect(checkDeviceOrderChannelWrite({}, body)?.reason).toBe('FORBIDDEN_ROLE')
    expect(checkDeviceOrderChannelWrite(undefined, body)?.reason).toBe('FORBIDDEN_ROLE')
  })

  it('interner Aufruf ist erlaubt (Pairing, Seeds)', () => {
    expect(checkDeviceOrderChannelWrite({ internal: true }, body)).toBeNull()
    expect(checkDeviceOrderChannelWrite(undefined, body)).not.toBeNull()
  })

  it('Zuruecksetzen mit null hat dasselbe Rollen-Gate wie Setzen', () => {
    expect(checkDeviceOrderChannelWrite({ role: 'tenant:technician' }, { defaultOrderChannel: null })?.reason).toBe(
      'FORBIDDEN_ROLE',
    )
    expect(checkDeviceOrderChannelWrite({ role: 'tenant:owner' }, { defaultOrderChannel: null })).toBeNull()
  })

  it('auch ein Key mit undefined ist gegated', () => {
    expect(
      checkDeviceOrderChannelWrite({ role: 'tenant:technician' }, { defaultOrderChannel: undefined })?.reason,
    ).toBe('FORBIDDEN_ROLE')
  })

  it('Body ohne das Feld wird nie beanstandet', () => {
    expect(checkDeviceOrderChannelWrite({ role: 'tenant:technician' }, { name: 'Kasse 1' })).toBeNull()
    expect(checkDeviceOrderChannelWrite(undefined, undefined)).toBeNull()
  })

  it.each(['online', 'app', 'POS', '', 1, true, {}])('unbekannter Wert %j → INVALID_CHANNEL', value => {
    expect(checkDeviceOrderChannelWrite({ role: 'tenant:owner' }, { defaultOrderChannel: value })?.reason).toBe(
      'INVALID_CHANNEL',
    )
  })

  it('Rollen-Gate kommt vor der Wertpruefung (kein Wert-Orakel fuer Unberechtigte)', () => {
    expect(checkDeviceOrderChannelWrite({ role: 'tenant:technician' }, { defaultOrderChannel: 'online' })?.reason).toBe(
      'FORBIDDEN_ROLE',
    )
  })

  it('Schreibrollen sind abschliessend genau Owner und platform:owner', () => {
    expect([...DEVICE_ORDER_CHANNEL_WRITE_ROLES].sort()).toEqual(['platform:owner', 'tenant:owner'])
  })
})

describe('resolveDeviceOrderChannel', () => {
  it('liefert die beiden gueltigen Werte', () => {
    expect(resolveDeviceOrderChannel({ defaultOrderChannel: 'pos' })).toBe('pos')
    expect(resolveDeviceOrderChannel({ defaultOrderChannel: 'telephone' })).toBe('telephone')
  })

  it.each([null, undefined, 'online', 'POS', 7, {}])('%j → null', value => {
    expect(resolveDeviceOrderChannel({ defaultOrderChannel: value })).toBeNull()
  })

  it('fehlendes Geraet → null', () => {
    expect(resolveDeviceOrderChannel(null)).toBeNull()
    expect(resolveDeviceOrderChannel(undefined)).toBeNull()
  })
})

describe('touchesDeviceOrderChannel', () => {
  it('erkennt den Key auch mit null', () => {
    expect(touchesDeviceOrderChannel({ defaultOrderChannel: null })).toBe(true)
    expect(touchesDeviceOrderChannel({})).toBe(false)
    expect(touchesDeviceOrderChannel('x')).toBe(false)
  })
})
