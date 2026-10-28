// Die Lifecycle-Aufrufe laufen als Custom Methods am rohen Feathers-Client. Der kennt nur, was
// `ConnectionService` registriert — am cloud-direct-POS fehlten `openDay`/`closeDay`, und „Geschäftstag
// eröffnen" scheiterte mit „service.openDay is not a function" (panary/panary-core#1120).
//
// Der Fake bildet den Client nach: Er trägt genau die Methoden aus `BUSINESSDAYS_CLIENT_METHODS`.
// Aufbau wie `cash-session.service.spec.ts`: echte Instanz ohne TestBed, Mocks je Test (testing.md §10).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext } from '@angular/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import {
  BUSINESSDAYS_CLIENT_METHODS,
  ConnectionService,
  DATA_ACCESS_AUTO_LOAD,
  ServiceHelper,
} from '@panary/shared/data-access'

import { BusinessDayService } from './business-day.service'

function setup(status = 'authenticated') {
  const client = Object.fromEntries(
    BUSINESSDAYS_CLIENT_METHODS.map(name => [name, vi.fn(async () => ({ _id: 'bd-1', isOpen: true }))]),
  )
  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        useValue: { businessDayService: client, connectionState: () => ({ status }) },
      },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: NotificationService, useValue: new NotificationService() },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })
  const service = runInInjectionContext(injector, () => new BusinessDayService())
  return { service, client }
}

describe('BusinessDayService — registrierte Client-Methoden (core#1120)', () => {
  it('eröffnet und schließt den Tag über die registrierten Custom Methods', async () => {
    const { service, client } = setup()

    await service.openDay({ locationId: 'loc-1' })
    await service.closeDay({ businessDayId: 'bd-1' })

    expect(client['openDay'].mock.calls).toEqual([[{ locationId: 'loc-1' }]])
    expect(client['closeDay'].mock.calls).toEqual([[{ businessDayId: 'bd-1' }]])
  })

  it('fragt die Ruhetag-Freigabe über die registrierten Custom Methods an', async () => {
    const { service, client } = setup()

    await service.getClosedDayStatus()
    await service.approveClosedDay({ authorizedByUserId: 'u-manager', pin: '1234' })

    expect(client['getClosedDayStatus'].mock.calls).toEqual([[{}]])
    expect(client['approveClosedDay'].mock.calls).toEqual([[{ authorizedByUserId: 'u-manager', pin: '1234' }]])
  })
})

// panary/panary-core#1185: Offline hing `getClosedDayStatus()` am Socket, und das Anlegen einer Bestellung wartete
// davor, statt in die Offline-Outbox zu gehen. Ohne Verbindung lehnt die Vorabfrage sofort ab;
// `ensureClosedDayApproval` ist fail-open und lässt den Verkauf weiterlaufen.
describe('BusinessDayService — Ruhetag-Vorabfrage offline (core#1185)', () => {
  it.each(['disconnected', 'error', 'connected'])(
    'lehnt bei Status %s sofort ab, ohne den Server zu fragen',
    async status => {
      const { service, client } = setup(status)

      await expect(service.getClosedDayStatus()).rejects.toThrow('OFFLINE_CLOSED_DAY_STATUS')
      expect(client['getClosedDayStatus']).not.toHaveBeenCalled()
    },
  )
})
