// `openAuthorized` schickt das Bediener-Token mit (panary/panary-core#631, ADR 0053),
// ebenso `find`/`get` (panary/panary-core#713): Der Edge beschraenkt die Laden am
// Geraet auf den per Token belegten Kassierer, ohne Token auf `device:<uuid>`.
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
  const find = vi.fn(async () => ({ total: 1, limit: 1, skip: 0, data: [{ _id: 'lade-1' }] }))
  const get = vi.fn(async () => ({ _id: 'lade-1' }))
  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { cashSessionService: { openAuthorized, find, get } } },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })
  const service = runInInjectionContext(injector, () => new CashSessionService())
  return { service, openAuthorized, find, get }
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

describe('CashSessionService — Lesezugriffe mit Bediener-Token (#713)', () => {
  const OPEN_QUERY = {
    businessDayId: 'bd-1',
    openedBy: 'u-kassierer',
    status: { $in: ['open', 'counting'] },
    $limit: 1,
  }

  it('findOpenForUser schickt das Token mit und findet die offene Lade', async () => {
    const { service, find } = setup('tok-kassierer')

    await expect(service.findOpenForUser('bd-1', 'u-kassierer')).resolves.toEqual({ _id: 'lade-1' })

    expect(find).toHaveBeenCalledWith({ query: { ...OPEN_QUERY, operatorToken: 'tok-kassierer' } })
  })

  it('loadForBusinessDay schickt das Token mit', async () => {
    const { service, find } = setup('tok-kassierer')

    await service.loadForBusinessDay('bd-1')

    expect(find).toHaveBeenCalledWith({
      query: { businessDayId: 'bd-1', $sort: { createdAt: 1 }, $limit: 100, operatorToken: 'tok-kassierer' },
    })
  })

  it('get schickt das Token mit', async () => {
    const { service, get } = setup('tok-kassierer')

    await service.get('lade-1')

    expect(get).toHaveBeenCalledWith('lade-1', { query: { operatorToken: 'tok-kassierer' } })
  })

  it('count schickt das Token mit', async () => {
    const { service, find } = setup('tok-kassierer')

    await expect(service.count({ businessDayId: 'bd-1' })).resolves.toBe(1)

    expect(find).toHaveBeenCalledWith({ query: { businessDayId: 'bd-1', $limit: 0, operatorToken: 'tok-kassierer' } })
  })

  it('ohne angemeldeten Bediener bleibt die Query unveraendert', async () => {
    const { service, find } = setup(null)

    await service.findOpenForUser('bd-1', 'u-kassierer')

    expect(find).toHaveBeenCalledWith({ query: OPEN_QUERY })
  })
})
