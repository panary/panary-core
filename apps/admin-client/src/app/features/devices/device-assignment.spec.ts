import { ChangeDetectorRef, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateService } from '@ngx-translate/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { DeviceStatusService } from '../../core/device-status.service'
import { DeviceListComponent } from './device-list'

// Die Zuweisungs-Logik der Geraeteliste (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
// Getestet wird, was man sonst nur durch Klicken faende: die Warnung vor dem
// letzten geteilten Terminal, das Leeren der Liste beim Zurueckschalten und die
// Faehigkeits-Sonde am Pairing-Echo.

interface DeviceFixture {
  _id: string
  deviceId: string
  name: string
  type: string
  active: boolean
  locationId?: string
  deviceAccessMode?: string
  assignedUserIds?: string[]
}

const POS_USERS = [
  { _id: 'u-anna', firstName: 'Anna', lastName: 'Alt' },
  { _id: 'u-bruno', firstName: 'Bruno', lastName: 'Berg' },
]

function setup(devices: DeviceFixture[], opts: { requestCodeResponse?: Record<string, unknown> } = {}) {
  const patch = vi.fn().mockResolvedValue({})
  const create = vi.fn().mockResolvedValue(opts.requestCodeResponse ?? { code: '123456', deviceAccessMode: 'shared' })
  const api = {
    find: vi.fn((service: string) =>
      Promise.resolve({ data: service === 'devices' ? devices : POS_USERS, total: 0, limit: 0, skip: 0 }),
    ),
    patch,
    create,
    remove: vi.fn().mockResolvedValue({}),
    getResource: vi.fn().mockRejectedValue(new Error('kein health im Test')),
  }
  const deviceStatus = {
    connectedDeviceIds: signal(new Set<string>()),
    online: signal(0),
    total: signal(devices.length),
    refresh: vi.fn().mockResolvedValue(undefined),
  }

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: DeviceStatusService, useValue: deviceStatus },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      // Ausserhalb einer gerenderten Komponente gibt es keinen echten
      // ChangeDetectorRef — markForCheck ist hier ohne Wirkung und ohne Belang.
      { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined, detectChanges: () => undefined } },
    ],
  })

  // Direkt instanziieren statt `createComponent` (Muster: pager-settings.spec):
  // Geprueft wird die Logik, nicht das Rendering — das Template deckt der
  // AOT-Build ab, und ohne Rendering braucht es kein TranslateModule.
  // `protected` ist nur eine TS-Sichtbarkeit; zur Laufzeit sind die Member da.
  const component = TestBed.runInInjectionContext(() => new DeviceListComponent()) as unknown as Record<string, any>
  return { component, api, patch, create }
}

const sharedDevice = (id: string, locationId = 'loc-1'): DeviceFixture => ({
  _id: id,
  deviceId: `dev-${id}`,
  name: `Theke ${id}`,
  type: 'pos-counter',
  active: true,
  locationId,
})

const assignedDevice = (id: string, userIds: string[], locationId = 'loc-1'): DeviceFixture => ({
  ...sharedDevice(id, locationId),
  deviceAccessMode: 'assigned',
  assignedUserIds: userIds,
})

describe('Geraeteliste — Zuweisung', () => {
  beforeEach(() => TestBed.resetTestingModule())

  describe('Warnung vor dem letzten geteilten Terminal', () => {
    it('warnt, wenn das einzige geteilte Terminal zugewiesen werden soll', async () => {
      const { component } = setup([sharedDevice('a'), assignedDevice('b', ['u-anna'])])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      component['assignMode'].set('assigned')
      component['assignSelected'].set(['u-anna'])

      expect(component['lastSharedTerminal']()).toBe(true)
    })

    it('warnt nicht, solange ein weiteres geteiltes Terminal bleibt', async () => {
      const { component } = setup([sharedDevice('a'), sharedDevice('b')])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      component['assignMode'].set('assigned')

      expect(component['lastSharedTerminal']()).toBe(false)
    })

    it('warnt nicht bei einem geteilten Terminal an einem ANDEREN Standort', async () => {
      // Die Stempel-Station wird pro Standort gebraucht — ein Terminal in der
      // Nachbarfiliale hilft hier niemandem.
      const { component } = setup([sharedDevice('a', 'loc-1'), sharedDevice('b', 'loc-2')])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      component['assignMode'].set('assigned')

      expect(component['lastSharedTerminal']()).toBe(true)
    })

    it('warnt nicht, wenn das Geraet ohnehin schon zugewiesen war', async () => {
      const { component } = setup([assignedDevice('a', ['u-anna'])])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      expect(component['lastSharedTerminal']()).toBe(false)
    })

    it('inaktive Geraete zaehlen nicht als Stempel-Station', async () => {
      const { component } = setup([sharedDevice('a'), { ...sharedDevice('b'), active: false }])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      component['assignMode'].set('assigned')

      expect(component['lastSharedTerminal']()).toBe(true)
    })
  })

  describe('Speichern', () => {
    it('schreibt Modus und Auswahl', async () => {
      const { component, patch } = setup([sharedDevice('a')])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      component['assignMode'].set('assigned')
      component['assignSelected'].set(['u-anna', 'u-bruno'])
      await component['saveAssignment']()

      expect(patch).toHaveBeenCalledWith('devices', 'a', {
        deviceAccessMode: 'assigned',
        assignedUserIds: ['u-anna', 'u-bruno'],
      })
    })

    it('leert die Liste beim Zurueckschalten auf geteilt', async () => {
      // Eine stehengebliebene Liste saehe beim naechsten Blick in die DB wie
      // eine aktive Zuweisung aus.
      const { component, patch } = setup([assignedDevice('a', ['u-anna'])])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      component['assignMode'].set('shared')
      await component['saveAssignment']()

      expect(patch).toHaveBeenCalledWith('devices', 'a', { deviceAccessMode: 'shared', assignedUserIds: [] })
    })

    it('speichert nicht, solange „zugewiesen" ohne Mitarbeiter dasteht', async () => {
      const { component, patch } = setup([sharedDevice('a')])
      await component['ngOnInit']()

      component['openAssignment'](component['devices']()[0])
      component['assignMode'].set('assigned')
      component['assignSelected'].set([])

      expect(component['assignSelectionValid']()).toBe(false)
      await component['saveAssignment']()
      expect(patch).not.toHaveBeenCalled()
    })
  })

  describe('Spalten-Anzeige', () => {
    it('zeigt bei genau einem Zugewiesenen den Namen, sonst die Anzahl', async () => {
      const { component } = setup([assignedDevice('a', ['u-anna']), assignedDevice('b', ['u-anna', 'u-bruno'])])
      await component['ngOnInit']()

      expect(component['assignedLabel'](component['devices']()[0])).toBe('Anna Alt')
      expect(component['assignedLabel'](component['devices']()[1])).toBe('2')
      expect(component['assignedNames'](component['devices']()[1])).toBe('Anna Alt, Bruno Berg')
    })

    it('faellt auf die ID zurueck, wenn der Mitarbeiter nicht mehr existiert', async () => {
      // Genau der Offboarding-Fall: Die Zuweisung bleibt stehen, der Benutzer
      // ist weg. Die Liste darf deswegen nicht leer aussehen.
      const { component } = setup([assignedDevice('a', ['u-geloescht'])])
      await component['ngOnInit']()

      expect(component['assignedLabel'](component['devices']()[0])).toBe('u-geloescht')
    })
  })

  describe('Faehigkeits-Sonde am Pairing-Echo', () => {
    it('blendet die Zuweisung aus, wenn der Edge deviceAccessMode nicht echot', async () => {
      // Ein aelterer Edge kennt die Felder nicht. Ohne diese Sonde boete die UI
      // eine Auswahl an, die beim Redeem stillschweigend verloren ginge.
      const { component } = setup([sharedDevice('a')], { requestCodeResponse: { code: '654321' } })
      await component['ngOnInit']()

      await component['openPairing']()
      expect(component['pairingSupportsAssignment']()).toBe(false)
    })

    it('zeigt sie, sobald der Edge echot', async () => {
      const { component } = setup([sharedDevice('a')])
      await component['ngOnInit']()

      await component['openPairing']()
      expect(component['pairingSupportsAssignment']()).toBe(true)
    })

    it('schickt die Zuweisung mit dem Code-Request, nicht erst beim Redeem', async () => {
      const { component, create } = setup([sharedDevice('a')])
      await component['ngOnInit']()
      await component['openPairing']()

      component['onPairingModeChange']('assigned')
      component['onPairingSelectionChange'](['u-bruno'])
      expect(component['pairingAssignmentDirty']()).toBe(true)

      await component['regeneratePairing']()

      expect(create).toHaveBeenLastCalledWith('device-pairing/request-code', {
        deviceAccessMode: 'assigned',
        assignedUserIds: ['u-bruno'],
      })
      expect(component['pairingAssignmentDirty']()).toBe(false)
    })
  })
})
