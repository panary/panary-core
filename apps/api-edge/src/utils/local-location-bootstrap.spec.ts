// #677: Der Start-Bootstrap darf an einem gepairten Edge keinen lokalen Standort erfinden.

import { describe, expect, it } from 'vitest'

import { decideLocalLocationBootstrap, isCloudPairedConnection } from './local-location-bootstrap'

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

describe('decideLocalLocationBootstrap', () => {
  it('legt bei leerer Tabelle ohne Pairing lokal an (Ersteinrichtung)', () => {
    expect(decideLocalLocationBootstrap(0, undefined)).toBe('create')
    expect(decideLocalLocationBootstrap(0, { pairingStatus: 'disconnected' })).toBe('create')
  })

  it('legt bei leerer Tabelle am gepairten Edge nicht an (#677)', () => {
    expect(decideLocalLocationBootstrap(0, { pairingStatus: 'connected' })).toBe('skip-paired')
  })

  it('tut nichts, wenn schon eine Location existiert', () => {
    expect(decideLocalLocationBootstrap(1, undefined)).toBe('exists')
    expect(decideLocalLocationBootstrap(1, { pairingStatus: 'connected' })).toBe('exists')
  })
})
