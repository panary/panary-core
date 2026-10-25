// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import type { BaseDocument } from '@panary/shared-common'
import { ServiceHelper } from '../utils/service-helper.service'
import { BaseService } from './base.service'
import { ConnectionService } from './connection.service'
import { DATA_ACCESS_AUTO_LOAD } from './auto-load.token'
import { OFFLINE_CACHE } from './offline-cache.token'
import { POS_OPERATOR_TOKEN_STORAGE_KEY } from '../utils/pos-operator-token'

// core#649: Offline hing `count()` am gepufferten Socket-Emit, und jeder Lader, der
// zuerst die Seitenzahl ermittelt, blieb leer (POS: keine Produktgruppen im Bestelldialog).

type Row = BaseDocument & { status: string; name: string }

class TestService extends BaseService<Row> {
  protected override cachePolicy = 'master-data' as const
  protected override cacheStoreName = 'things'

  constructor(service: unknown) {
    super(service, 'testService')
  }

  protected override loadDocuments(): void {
    /* empty */
  }

  protected override fileReaderOnLoad(): void {
    /* empty */
  }
}

/** Wie ein Dienst mit Self-Scope am Edge (`cash-sessions`, #713). */
class TokenReadingService extends TestService {
  protected override readsCarryPosOperatorToken = true
}

const CACHED: Row[] = [
  { _id: '1', status: 'ACTIVE', name: 'C' },
  { _id: '2', status: 'ARCHIVED', name: 'B' },
  { _id: '3', status: 'ACTIVE', name: 'A' },
]

function setup(options: {
  offline: boolean
  serverFind?: () => Promise<unknown>
  serviceClass?: new (service: unknown) => TestService
}) {
  // Wie offline der Socket: Der Emit wird gepuffert, das Promise loest nie auf.
  const serverFind = vi.fn(options.serverFind ?? (() => new Promise(() => undefined)))
  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        useValue: { connectionState: signal({ status: options.offline ? 'disconnected' : 'authenticated' }) },
      },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: NotificationService, useValue: new NotificationService() },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
      {
        provide: OFFLINE_CACHE,
        useValue: {
          isReady: () => true,
          readAll: () => Promise.resolve(CACHED.map(row => ({ ...row }))),
          upsertMany: () => Promise.resolve(),
        },
      },
    ],
  })
  // Kein `on` am Mock → BaseService ueberspringt die Socket-Listener.
  const ServiceClass = options.serviceClass ?? TestService
  const service = runInInjectionContext(injector, () => new ServiceClass({ find: serverFind }))
  return { service, serverFind }
}

describe('BaseService offline — count und paginierter find aus dem Cache (core#649)', () => {
  it('count() antwortet offline aus dem Cache, ohne den Socket zu fragen', async () => {
    const { service, serverFind } = setup({ offline: true })

    await expect(service.count({ status: 'ACTIVE' })).resolves.toBe(2)
    expect(serverFind).not.toHaveBeenCalled()
  })

  it('ein paginierender Lader bekommt offline jede aktive Zeile genau einmal, sortiert', async () => {
    const { service } = setup({ offline: true })
    const limit = 1

    const total = await service.count({ status: 'ACTIVE' })
    const all: Row[] = []
    for (let skip = 0; skip < total; skip += limit) {
      const page = await service.find({ query: { status: 'ACTIVE', $sort: { name: 1 }, $skip: skip, $limit: limit } })
      all.push(...(Array.isArray(page) ? page : page.data))
    }

    expect(all.map(row => row._id)).toEqual(['3', '1'])
  })

  it('online fragt count() weiter den Server', async () => {
    const { service, serverFind } = setup({
      offline: false,
      serverFind: () => Promise.resolve({ total: 7, limit: 0, skip: 0, data: [] }),
    })

    await expect(service.count({ status: 'ACTIVE' })).resolves.toBe(7)
    expect(serverFind).toHaveBeenCalledWith({ query: { status: 'ACTIVE', $limit: 0 } })
  })

  it('scheitert count() online, faellt es auf den Cache zurueck', async () => {
    const { service } = setup({ offline: false, serverFind: () => Promise.reject(new Error('Timeout')) })

    await expect(service.count({ status: 'ACTIVE' })).resolves.toBe(2)
  })
})

describe('BaseService — Bediener-Token an Lesezugriffen (#713)', () => {
  function stubToken() {
    const raw = JSON.stringify({ operatorToken: 'tok-1', operatorTokenExpiresAt: '2099-01-01T00:00:00.000Z' })
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === POS_OPERATOR_TOKEN_STORAGE_KEY ? raw : null) })
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
  }

  it('ohne Opt-in geht kein Token an find', async () => {
    stubToken()
    const { service, serverFind } = setup({ offline: false, serverFind: () => Promise.resolve([]) })

    await service.find({ query: { status: 'ACTIVE' } })

    expect(serverFind).toHaveBeenCalledWith({ query: { status: 'ACTIVE' } })
  })

  it('mit Opt-in geht das Token an den Server, der Cache-Rueckfall filtert ohne es', async () => {
    stubToken()
    const { service, serverFind } = setup({
      offline: false,
      serverFind: () => Promise.reject(new Error('Timeout')),
      serviceClass: TokenReadingService,
    })

    const rows = await service.find({ query: { status: 'ACTIVE' } })

    expect(serverFind).toHaveBeenCalledWith({ query: { status: 'ACTIVE', operatorToken: 'tok-1' } })
    expect((Array.isArray(rows) ? rows : rows.data).map(row => row._id)).toEqual(['1', '3'])
  })
})
