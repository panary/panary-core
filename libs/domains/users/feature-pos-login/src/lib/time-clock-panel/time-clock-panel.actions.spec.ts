// JIT-Compiler zuerst laden (wie login.component.spec): ohne Linker faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { TenantSuspensionService } from '@panary/shared/data-access'
import { UserService } from '@panary/users/data-access'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TimeClockPanelComponent } from './time-clock-panel.component'

// panary/panary-core#810: `UserService.endBreak` & Co. fangen jeden Serverfehler ab
// (`handleError` gibt void zurück) und lösen mit `undefined` auf. Die Zeiterfassung am
// POS-Login meldete daraufhin „erfolgreich“, obwohl api-cloud mit 403 abgelehnt hatte.

const MAX = { _id: 'u-max', firstName: 'Max', lastName: 'Manager', stampingId: 'wt-1' }

function setup(options: { endBreakResult?: unknown; suspended?: boolean; suspendDuringCall?: boolean } = {}) {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })

  const suspended = signal(options.suspended ?? false)
  const result = 'endBreakResult' in options ? options.endBreakResult : MAX
  // Wie ServiceHelper.handleError bei TENANT_SUSPENDED: Sperre setzen, void zurückgeben.
  const endBreak = vi.fn(async () => {
    if (options.suspendDuringCall) suspended.set(true)
    return result
  })
  const userService = { find: vi.fn().mockResolvedValue({ data: [MAX] }), endBreak }
  const injector = Injector.create({
    providers: [
      { provide: UserService, useValue: userService },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: TenantSuspensionService, useValue: { suspended } },
    ],
  })
  const component = runInInjectionContext(injector, () => new TimeClockPanelComponent())
  const confirmed = vi.fn()
  component.actionConfirmed.subscribe(confirmed)
  component.selectedAction.set('break-end')
  component.pinInput.set('906182')
  return { component, endBreak, confirmed }
}

describe('TimeClockPanel — Rückmeldung nach der Stempel-Aktion (core#810)', () => {
  it('Server antwortet mit dem User → Erfolgsmeldung', async () => {
    const { component, endBreak, confirmed } = setup()
    await component.confirmAction()
    expect(endBreak).toHaveBeenCalledWith('u-max')
    expect(component.successMessage()).toBe('TIME_CLOCK.ACTION_SUCCESS')
    expect(component.errorMessage()).toBeNull()
    expect(confirmed).toHaveBeenCalledTimes(1)
  })

  it('verschluckter Serverfehler (undefined) → Fehlermeldung statt Erfolg', async () => {
    const { component, confirmed } = setup({ endBreakResult: undefined })
    await component.confirmAction()
    expect(component.successMessage()).toBeNull()
    expect(component.errorMessage()).toBe('TIME_CLOCK.ACTION_FAILED')
    expect(component.pinError()).toBe(true)
    expect(confirmed).not.toHaveBeenCalled()
  })

  it('Sperre erst durch diese Aktion erkannt → Sperr-Hinweis statt „fehlgeschlagen“', async () => {
    const { component, endBreak, confirmed } = setup({ endBreakResult: undefined, suspendDuringCall: true })
    await component.confirmAction()
    expect(endBreak).toHaveBeenCalledTimes(1)
    expect(component.successMessage()).toBeNull()
    expect(component.errorMessage()).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
    expect(confirmed).not.toHaveBeenCalled()
  })

  it('Mandant gesperrt → Aktion wird gar nicht gesendet, Sperr-Hinweis', async () => {
    const { component, endBreak, confirmed } = setup({ suspended: true })
    await component.confirmAction()
    expect(endBreak).not.toHaveBeenCalled()
    expect(component.successMessage()).toBeNull()
    expect(component.errorMessage()).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
    expect(confirmed).not.toHaveBeenCalled()
  })
})
