// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext } from '@angular/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import type { BaseDocument } from '@panary/shared-common'
import { ServiceHelper } from '../utils/service-helper.service'
import { BaseService } from './base.service'
import { DATA_ACCESS_AUTO_LOAD } from './auto-load.token'

// core#1091: `payCash` faengt BD_6004 und oeffnet die Kassen-Freigabe. Die rohe 400-Meldung aus
// `handleError` stand trotzdem ueber dem Dialog. Der Opt-out gilt nur fuer den genannten Fehler.

class TestService extends BaseService<BaseDocument> {
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

const EXPECTED = { code: 400, data: { code: 'BD_6004' } }
const OTHER = { code: 400, data: { code: 'BD_6005' } }
const isExpected = (error: unknown) => error === EXPECTED

function setup(serverError: unknown) {
  const handleError = vi.fn()
  const patch = vi.fn(async () => {
    throw serverError
  })
  const injector = Injector.create({
    providers: [
      { provide: ServiceHelper, useValue: { handleError } },
      { provide: NotificationService, useValue: new NotificationService() },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })
  // Kein `on` am Mock → BaseService ueberspringt die Socket-Listener.
  const service = runInInjectionContext(injector, () => new TestService({ patch }))
  return { service, handleError, patch }
}

describe('BaseService.patch — erwarteter Fehler ohne Meldung (core#1091)', () => {
  it('meldet den vom Aufrufer erwarteten Fehler nicht und wirft ihn weiter', async () => {
    const { service, handleError } = setup(EXPECTED)

    await expect(service.patch('1', {}, { isExpectedError: isExpected })).rejects.toBe(EXPECTED)

    expect(handleError).not.toHaveBeenCalled()
  })

  it('meldet jeden anderen Fehler trotz Opt-out', async () => {
    const { service, handleError } = setup(OTHER)

    await expect(service.patch('1', {}, { isExpectedError: isExpected })).rejects.toBe(OTHER)

    expect(handleError).toHaveBeenCalledExactlyOnceWith('testService', OTHER)
  })

  it('meldet ohne Opt-out auch den sonst erwarteten Fehler', async () => {
    const { service, handleError } = setup(EXPECTED)

    await expect(service.patch('1', {})).rejects.toBe(EXPECTED)

    expect(handleError).toHaveBeenCalledExactlyOnceWith('testService', EXPECTED)
  })

  it('schickt den Opt-out nicht an den Server', async () => {
    const { service, patch } = setup(EXPECTED)

    await service.patch('1', {}, { query: { a: 1 }, isExpectedError: isExpected }).catch(() => undefined)

    expect(patch).toHaveBeenCalledExactlyOnceWith('1', {}, { query: { a: 1 } })
  })
})
