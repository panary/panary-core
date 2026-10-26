// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext } from '@angular/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService, DATA_ACCESS_AUTO_LOAD, ServiceHelper } from '@panary/shared/data-access'

import { WorkingTimeService } from './working-time.service'

// core#962: Beim Stempeln standen zwei technische Meldungen („Arbeitszeit wurde erstellt“ u. a.)
// übereinander. Aufbau wie write-offs.service.spec: echte Instanz, alle Tokens als Mocks.
function setup() {
  const notifications = new NotificationService()
  const notify = vi.spyOn(notifications, 'notify')
  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { workingTimeService: {} } },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: NotificationService, useValue: notifications },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })
  const service = runInInjectionContext(injector, () => new WorkingTimeService())
  const show = (key: string) => (service as unknown as { showSnackbar: (k: string) => void }).showSnackbar(key)
  return { notify, show }
}

describe('WorkingTimeService — Realtime-Meldungen (#962)', () => {
  it('zeigt keine Standardmeldung', () => {
    const { notify, show } = setup()

    for (const key of ['SNACKBAR.CREATED', 'SNACKBAR.UPDATED', 'SNACKBAR.CHANGED', 'SNACKBAR.DELETED']) show(key)

    expect(notify).not.toHaveBeenCalled()
  })
})
