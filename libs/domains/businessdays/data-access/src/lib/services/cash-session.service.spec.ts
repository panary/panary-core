// `openAuthorized` schickt das Bediener-Token mit (panary/panary-core#631, ADR 0053).
//
// Die Custom Method laeuft am rohen Feathers-Service — `BaseService` haengt das
// Token dort nicht an. Ohne Token rechnete der Edge die Lade dem Body-Wert zu.
// Aufbau wie `orders/data-access/.../order.service.spec.ts`: echte Instanz ohne
// TestBed, Mocks je Test (testing.md §10).
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import {
  ConnectionService,
  DATA_ACCESS_AUTO_LOAD,
  POS_OPERATOR_TOKEN_STORAGE_KEY,
  ServiceHelper,
} from '@panary/shared/data-access'

import { CashSessionService } from './cash-session.service'

function setup(token: string | null) {
  const store = new Map<string, string>()
  if (token) {
    store.set(
      POS_OPERATOR_TOKEN_STORAGE_KEY,
      JSON.stringify({ operatorToken: token, operatorTokenExpiresAt: '2099-01-01T00:00:00.000Z' }),
    )
  }
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null })
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })

  const openAuthorized = vi.fn(async () => ({ _id: 'lade-1' }))
  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { cashSessionService: { openAuthorized } } },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })
  const service = runInInjectionContext(injector, () => new CashSessionService())
  return { service, openAuthorized }
}

const INPUT = {
  businessDayId: 'bd-1',
  openedBy: 'u-kassierer',
  openingFloatCents: 0,
  label: 'Lade',
  authorizedByUserId: 'u-manager',
  pin: '1234',
}

describe('CashSessionService.openAuthorized — Bediener-Token', () => {
  it('schickt das Token des angemeldeten Bedieners in der Query mit', async () => {
    const { service, openAuthorized } = setup('tok-kassierer')

    await service.openAuthorized(INPUT)

    expect(openAuthorized).toHaveBeenCalledWith(INPUT, { query: { operatorToken: 'tok-kassierer' } })
  })

  it('ohne angemeldeten Bediener geht kein Token-Schluessel mit', async () => {
    const { service, openAuthorized } = setup(null)

    await service.openAuthorized(INPUT)

    expect(openAuthorized).toHaveBeenCalledWith(INPUT, {})
  })
})
