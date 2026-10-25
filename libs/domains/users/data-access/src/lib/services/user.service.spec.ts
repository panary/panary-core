// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import { AuthService } from '@panary/auth/data-access'
import { ConnectionService, DATA_ACCESS_AUTO_LOAD, ServiceHelper } from '@panary/shared/data-access'
import { UserService } from './user.service'

type RealtimeHandler = (item: unknown) => void

/** Jeder Test baut seine eigenen Fakes (testing.md §10): Aufzeichnungen bleiben im Test. */
function setup() {
  const handlers = new Map<string, RealtimeHandler>()
  const feathersUserService = {
    on(event: string, handler: RealtimeHandler) {
      handlers.set(event, handler)
      return feathersUserService
    },
  }
  const notifications = new NotificationService()
  const notify = vi.spyOn(notifications, 'notify')
  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        useValue: { userService: feathersUserService, isAuthenticated: () => false },
      },
      { provide: AuthService, useValue: { user: signal(undefined) } },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: NotificationService, useValue: notifications },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })
  const service = runInInjectionContext(injector, () => new UserService())
  const emit = (event: string, item: unknown) => handlers.get(event)?.(item)
  return { service, notify, emit }
}

// core#954: Jedes Stempeln aus der Rail patcht den Mitarbeiter (`stampingId`) und meldete „Benutzer wurde geändert“.
describe('UserService — Realtime-Meldung (core#954)', () => {
  it('Stempeln patcht den Mitarbeiter: keine „geändert“-Meldung, die Liste folgt trotzdem', () => {
    const { service, notify, emit } = setup()
    emit('created', { _id: 'u-max', stampingId: null })
    notify.mockClear()

    emit('patched', { _id: 'u-max', stampingId: 'wt-1' })

    expect(notify).not.toHaveBeenCalled()
    expect(service.users().find(user => user._id === 'u-max')?.stampingId).toBe('wt-1')
  })

  it('andere Realtime-Meldungen bleiben (Mitarbeiter entfernt)', () => {
    const { notify, emit } = setup()
    emit('removed', { _id: 'u-max' })
    expect(notify.mock.calls.map(call => call[1])).toEqual(['SNACKBAR.DELETED'])
  })
})
