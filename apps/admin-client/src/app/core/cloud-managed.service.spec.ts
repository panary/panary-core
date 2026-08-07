import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { ConnectionService } from '@panary/shared/data-access'
import { beforeEach, describe, expect, it } from 'vitest'

import { CloudManagedService } from './cloud-managed.service'

interface StubState {
  healthLoaded: boolean
  cloudPaired: boolean
  emergencyOverride: boolean
  cloudUnreachable: boolean
  /** Kein Cloud-Kontakt bekannt (frisch gepairt, Cloud nie erreicht). */
  cloudContactUnknown?: boolean
}

function setup(state: StubState): CloudManagedService {
  const stub = {
    healthLoaded: signal(state.healthLoaded),
    cloudPaired: signal(state.cloudPaired),
    emergencyOverrideActive: signal(state.emergencyOverride),
    emergencyOverrideSinceMin: signal<number | null>(null),
    cloudUnreachable: signal(state.cloudUnreachable),
    cloudContactUnknown: signal(state.cloudContactUnknown ?? false),
    refreshHealth: () => Promise.resolve(),
  }
  TestBed.configureTestingModule({
    providers: [CloudManagedService, { provide: ConnectionService, useValue: stub }],
  })
  return TestBed.inject(CloudManagedService)
}

beforeEach(() => {
  TestBed.resetTestingModule()
})

describe('CloudManagedService', () => {
  // Die Wahrheitstabelle IST der Vertrag: sie muss exakt die Backend-Matrix aus
  // cloud-managed.hook.ts spiegeln (ungepairt frei / gepairt gesperrt /
  // gepairt+Notfall nur Drucker frei).
  const cases: Array<{
    name: string
    state: StubState
    readOnly: boolean
    printerWritable: boolean
    printerEmergency: boolean
  }> = [
    {
      name: 'ungepairt → alles schreibbar',
      state: { healthLoaded: true, cloudPaired: false, emergencyOverride: false, cloudUnreachable: false },
      readOnly: false,
      printerWritable: true,
      printerEmergency: false,
    },
    {
      name: 'gepairt ohne Notfall → alles gesperrt, auch Drucker',
      state: { healthLoaded: true, cloudPaired: true, emergencyOverride: false, cloudUnreachable: false },
      readOnly: true,
      printerWritable: false,
      printerEmergency: false,
    },
    {
      name: 'gepairt mit Notfall → nur Drucker schreibbar',
      state: { healthLoaded: true, cloudPaired: true, emergencyOverride: true, cloudUnreachable: false },
      readOnly: true,
      printerWritable: true,
      printerEmergency: true,
    },
    {
      name: 'Zustand unbekannt → fail-open, Backend bleibt die Autorität',
      state: { healthLoaded: false, cloudPaired: true, emergencyOverride: false, cloudUnreachable: false },
      readOnly: false,
      printerWritable: true,
      printerEmergency: false,
    },
  ]

  it.each(cases)('$name', ({ state, readOnly, printerWritable, printerEmergency }) => {
    const svc = setup(state)

    expect(svc.readOnly()).toBe(readOnly)
    expect(svc.printerWritable()).toBe(printerWritable)
    expect(svc.printerEmergency()).toBe(printerEmergency)
  })

  describe('canOfferEmergency', () => {
    it('bietet den Notfall-Modus an, wenn gepairt und Cloud unerreichbar', () => {
      const svc = setup({ healthLoaded: true, cloudPaired: true, emergencyOverride: false, cloudUnreachable: true })

      expect(svc.canOfferEmergency()).toBe(true)
    })

    it('bietet ihn nicht an, wenn er bereits aktiv ist', () => {
      const svc = setup({ healthLoaded: true, cloudPaired: true, emergencyOverride: true, cloudUnreachable: true })

      expect(svc.canOfferEmergency()).toBe(false)
    })

    it('bietet ihn nicht an, solange die Cloud erreichbar ist', () => {
      const svc = setup({ healthLoaded: true, cloudPaired: true, emergencyOverride: false, cloudUnreachable: false })

      expect(svc.canOfferEmergency()).toBe(false)
    })

    // `cloudUnreachable` liefert bei nie erfolgtem Kontakt bewusst false — sonst
    // meldete ein frisch gepairter Edge sofort einen Ausfall. Ohne diesen Zweig
    // waere der Button im dringlichsten Szenario („seit dem Pairing nie
    // erreicht, Drucker gesperrt") nie sichtbar.
    it('bietet ihn an, wenn seit dem Pairing nie Cloud-Kontakt bestand', () => {
      const svc = setup({
        healthLoaded: true,
        cloudPaired: true,
        emergencyOverride: false,
        cloudUnreachable: false,
        cloudContactUnknown: true,
      })

      expect(svc.canOfferEmergency()).toBe(true)
    })

    it('bietet ihn ohne Pairing nicht an', () => {
      const svc = setup({ healthLoaded: true, cloudPaired: false, emergencyOverride: false, cloudUnreachable: true })

      expect(svc.canOfferEmergency()).toBe(false)
    })
  })
})
