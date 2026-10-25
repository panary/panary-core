// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext } from '@angular/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService, DATA_ACCESS_AUTO_LOAD, ServiceHelper } from '@panary/shared/data-access'

import { WriteOffService } from './write-offs.service'

// core#760: Nach dem Speichern standen „Abschreibung wurde erstellt“ (Realtime) und
// „Abschreibung gespeichert“ (Dialog) uebereinander. Aufbau wie order.service.spec
// (#657): echte Instanz, alle inject()-Tokens als Mocks, alles je Test.
function setup() {
  const notifications = new NotificationService()
  const notify = vi.spyOn(notifications, 'notify')
  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { writeOffService: {} } },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: NotificationService, useValue: notifications },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })
  const service = runInInjectionContext(injector, () => new WriteOffService())
  const show = (key: string) => (service as unknown as { showSnackbar: (k: string) => void }).showSnackbar(key)
  return { notify, show }
}

describe('WriteOffService — Realtime-Meldung (#760)', () => {
  it('zeigt keine „erstellt“-Meldung', () => {
    const { notify, show } = setup()

    show('SNACKBAR.CREATED')
    show('SNACKBAR.CREATED_PLURAL')

    expect(notify).not.toHaveBeenCalled()
  })

  it('zeigt weiterhin die übrigen Meldungen', () => {
    const { notify, show } = setup()

    show('SNACKBAR.DELETED')

    expect(notify).toHaveBeenCalledTimes(1)
  })
})
