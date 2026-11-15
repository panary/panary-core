import { describe, expect, it } from 'vitest'

import { buildDeviceSocketAuth } from './device-socket-auth'

const config = { apiKey: 'schluessel', deviceId: '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7e4', deviceName: 'Kasse 1' }

describe('buildDeviceSocketAuth', () => {
  it('sendet die Version dieses Builds als clientVersion mit', () => {
    expect(buildDeviceSocketAuth(config, '26.11.15')).toEqual({
      apiKey: 'schluessel',
      deviceId: config.deviceId,
      deviceName: 'Kasse 1',
      clientVersion: '26.11.15',
    })
  })

  it.each([undefined, null, '', '   '])('lässt clientVersion bei %j ganz weg', appVersion => {
    expect(buildDeviceSocketAuth(config, appVersion)).not.toHaveProperty('clientVersion')
  })

  it('erfindet den Gerätenamen aus der Geräte-ID, wenn keiner gesetzt ist', () => {
    expect(buildDeviceSocketAuth({ ...config, deviceName: undefined }, '26.11.15').deviceName).toBe('POS-01927d4f')
  })
})
