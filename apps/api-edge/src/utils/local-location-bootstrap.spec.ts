// #677: Der Start-Bootstrap darf an einem gepairten Edge keinen lokalen Standort erfinden.

import { describe, expect, it } from 'vitest'

import { isCloudPairedConnection } from './local-location-bootstrap'

describe('isCloudPairedConnection', () => {
  it.each(['connected', 'pairing'])('gilt bei pairingStatus %s als gepairt', status => {
    expect(isCloudPairedConnection({ pairingStatus: status })).toBe(true)
  })

  it.each(['disconnected', 'error'])('gilt bei pairingStatus %s nicht als gepairt', status => {
    expect(isCloudPairedConnection({ pairingStatus: status })).toBe(false)
  })

  it('gilt ohne cloud-connection-Zeile nicht als gepairt (Ersteinrichtung)', () => {
    expect(isCloudPairedConnection(undefined)).toBe(false)
    expect(isCloudPairedConnection({ pairingStatus: null })).toBe(false)
  })
})
