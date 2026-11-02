// Hinweis auf einen fehlenden Geschäftstag vor dem Absenden (panary/panary-core#1171).
//
// Hauptrisiko sind Falschwarnungen: `systemMode` startet mit `standalone`, und am cloud-direkten POS ist der
// Pairing-Status `null`, was dort nicht „offline" heißt. Die Tabelle prüft deshalb jeden Ausschluss einzeln
// gegen einen Zustand, der ohne ihn einen Hinweis ergäbe.

import { describe, expect, it } from 'vitest'

import { businessDayHint, type BusinessDayHintState } from './business-day-hint'

const cloudDirectOhneTag: BusinessDayHintState = {
  healthLoaded: true,
  tier: 'cloud-direct',
  cloudPaired: false,
  offlineOverrideActive: false,
  online: true,
  locationLoaded: true,
  businessDayOpen: false,
}

const edgeGepairtOhneTag: BusinessDayHintState = {
  ...cloudDirectOhneTag,
  tier: 'edge-with-cloud',
  cloudPaired: true,
}

describe('businessDayHint', () => {
  it('cloud-direkt ohne Tag: Hinweis mit Eröffnen am Gerät', () => {
    expect(businessDayHint(cloudDirectOhneTag)).toBe('open-here')
  })

  it('Edge gepairt ohne Tag: Hinweis auf den Cloud-Admin', () => {
    expect(businessDayHint(edgeGepairtOhneTag)).toBe('open-in-admin')
  })

  it('cloud-direkt: der Pairing-Status `null` (cloudPaired false) führt nicht in den Edge-Zweig', () => {
    expect(businessDayHint({ ...cloudDirectOhneTag, cloudPaired: false })).toBe('open-here')
  })

  it.each<[string, Partial<BusinessDayHintState>]>([
    ['Tag offen', { businessDayOpen: true }],
    ['Betriebsart noch nicht geladen', { healthLoaded: false }],
    ['offline', { online: false }],
    ['Filiale nicht geladen (Sperr-Overlay steht)', { locationLoaded: false }],
  ])('kein Hinweis, cloud-direkt: %s', (_, patch) => {
    expect(businessDayHint({ ...cloudDirectOhneTag, ...patch })).toBeNull()
  })

  it.each<[string, Partial<BusinessDayHintState>]>([
    ['Tag offen', { businessDayOpen: true }],
    ['Betriebsart noch nicht geladen', { healthLoaded: false }],
    ['offline', { online: false }],
    ['Offline-Override aktiv — die Edge rotiert selbst', { offlineOverrideActive: true }],
    ['ohne Pairing — die erste Bestellung legt den Tag an', { cloudPaired: false }],
    ['Standalone-Edge', { tier: 'standalone', cloudPaired: false }],
  ])('kein Hinweis, Edge: %s', (_, patch) => {
    expect(businessDayHint({ ...edgeGepairtOhneTag, ...patch })).toBeNull()
  })

  it('Pairing zählt, nicht `systemMode`: Edge im Modus standalone, aber gepairt, verweist auf den Cloud-Admin', () => {
    // Die Edge prüft nur den Pairing-Status (`getConnectedCloudConnection`), `system.mode` ist Reporting.
    expect(businessDayHint({ ...edgeGepairtOhneTag, tier: 'standalone' })).toBe('open-in-admin')
  })
})
