// JIT-Compiler zuerst laden (wie login.component.spec): ohne Linker faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { TenantSuspensionService } from '@panary/shared/data-access'
import { UserService } from '@panary/users/data-access'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { TimeClockPanelComponent } from './time-clock-panel.component'

// panary/panary-core#810: Die Zeiterfassung am POS-Login meldete „erfolgreich“, obwohl der Server abgelehnt hatte.
// panary/panary-core#1198: Das Panel loest die Nummer nicht mehr selbst auf, sondern fragt den Server
// (`lookupByEmployeeNumber` → Bestaetigung → `stampByEmployeeNumber`). Edge und Cloud bieten denselben Vertrag.

const LOOKUP = { firstName: 'Max', lastNameInitial: 'M' }
const BOOKED = { _id: 'u-max', firstName: 'Max', action: 'checkin', state: 'IN' }

/** Fehler wie ihn der Feathers-Client liefert: `code` ist der HTTP-Status, der stabile Code steckt in `data`. */
const feathersError = (code: number, message: string, data?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, data })
const rejected = () =>
  feathersError(403, 'Personalnummer ungueltig oder nicht zulaessig.', { code: 'STAMP_NUMBER_REJECTED' })
const locked = (retryAfterSeconds = 45) =>
  feathersError(429, 'Zu viele Fehlversuche.', { code: 'STAMP_LOCKED', retryAfterSeconds })

function setup(
  options: {
    lookup?: () => Promise<unknown>
    stamp?: () => Promise<unknown>
    suspended?: boolean
    action?: 'clock-in' | 'clock-out' | 'break-start' | 'break-end'
  } = {},
) {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })

  const suspended = signal(options.suspended ?? false)
  const markSuspended = vi.fn(() => suspended.set(true))
  const lookupByEmployeeNumber = vi.fn(options.lookup ?? (async () => LOOKUP))
  const stampByEmployeeNumber = vi.fn(options.stamp ?? (async () => BOOKED))
  const userService = { lookupByEmployeeNumber, stampByEmployeeNumber, find: vi.fn() }
  const injector = Injector.create({
    providers: [
      { provide: UserService, useValue: userService },
      {
        provide: TranslateService,
        useValue: {
          instant: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}|${JSON.stringify(params)}` : key,
        },
      },
      { provide: TenantSuspensionService, useValue: { suspended, markSuspended } },
    ],
  })
  const component = runInInjectionContext(injector, () => new TimeClockPanelComponent())
  component.selectedAction.set(options.action ?? 'break-end')
  component.employeeNumberInput.set('906182')
  return { component, lookupByEmployeeNumber, stampByEmployeeNumber, userService, markSuspended }
}

describe('TimeClockPanel — Bestätigungsschritt (core#1198)', () => {
  it('Nummer → Vorschau vom Server, nichts wird gebucht, Nummer bleibt String', async () => {
    const { component, lookupByEmployeeNumber, stampByEmployeeNumber, userService } = setup()
    await component.lookupEmployee()
    expect(lookupByEmployeeNumber).toHaveBeenCalledWith('906182')
    expect(stampByEmployeeNumber).not.toHaveBeenCalled()
    expect(userService.find).not.toHaveBeenCalled()
    expect(component.confirmation()).toEqual({ displayName: 'Max M.' })
    expect(component.successMessage()).toBeNull()
  })

  it('führende Nullen gehen nicht verloren', async () => {
    const { component, lookupByEmployeeNumber } = setup()
    component.employeeNumberInput.set('001234')
    await component.lookupEmployee()
    expect(lookupByEmployeeNumber).toHaveBeenCalledWith('001234')
  })

  it('Bestätigen bucht mit der zur Aktion passenden Methode', async () => {
    const cases = [
      ['clock-in', 'checkin'],
      ['clock-out', 'checkout'],
      ['break-start', 'startBreak'],
      ['break-end', 'endBreak'],
    ] as const
    for (const [panelAction, stampAction] of cases) {
      const { component, stampByEmployeeNumber } = setup({ action: panelAction })
      await component.lookupEmployee()
      await component.confirmAction()
      expect(stampByEmployeeNumber).toHaveBeenCalledWith('906182', stampAction)
      expect(component.successMessage()).toContain('TIME_CLOCK.ACTION_SUCCESS')
      expect(component.successMessage()).toContain('Max M.')
    }
  })

  it('Abbrechen → keine Buchung, Eingabe zurückgesetzt', async () => {
    const { component, stampByEmployeeNumber } = setup()
    await component.lookupEmployee()
    component.cancelConfirmation()
    expect(component.confirmation()).toBeNull()
    expect(component.employeeNumberInput()).toBe('')
    expect(stampByEmployeeNumber).not.toHaveBeenCalled()
  })

  it('ohne Bestätigung wird nie gebucht', async () => {
    const { component, stampByEmployeeNumber } = setup()
    await component.confirmAction()
    expect(stampByEmployeeNumber).not.toHaveBeenCalled()
  })

  it('unvollständige Nummer → kein Aufruf', async () => {
    const { component, lookupByEmployeeNumber } = setup()
    component.employeeNumberInput.set('9061')
    await component.lookupEmployee()
    expect(lookupByEmployeeNumber).not.toHaveBeenCalled()
    expect(component.errorMessage()).toBe('TIME_CLOCK.INVALID_6_DIGIT')
  })
})

describe('TimeClockPanel — Ablehnung und Sperre (core#1198)', () => {
  it('abgelehnte Nummer → Einheitsmeldung, Eingabe leer, keine Bestätigung', async () => {
    const { component } = setup({ lookup: async () => Promise.reject(rejected()) })
    await component.lookupEmployee()
    expect(component.errorMessage()).toBe('TIME_CLOCK.NUMBER_REJECTED')
    expect(component.pinError()).toBe(true)
    expect(component.confirmation()).toBeNull()
    expect(component.employeeNumberInput()).toBe('')
  })

  it('Sperre → Wartezeit im Text, Eingabe gesperrt, Countdown, danach frei', async () => {
    const { component, lookupByEmployeeNumber } = setup({ lookup: async () => Promise.reject(locked(3)) })
    await component.lookupEmployee()
    expect(component.isLocked()).toBe(true)
    expect(component.lockSecondsLeft()).toBe(3)
    expect(component.errorMessage()).toContain('TIME_CLOCK.LOCKED')
    expect(component.errorMessage()).toContain('"seconds":3')

    component.addDigit('1')
    expect(component.employeeNumberInput()).toBe('')

    await vi.advanceTimersByTimeAsync(1000)
    expect(component.errorMessage()).toContain('"seconds":2')

    await vi.advanceTimersByTimeAsync(2000)
    expect(component.isLocked()).toBe(false)
    expect(component.errorMessage()).toBeNull()
    component.addDigit('1')
    expect(component.employeeNumberInput()).toBe('1')
    expect(lookupByEmployeeNumber).toHaveBeenCalledTimes(1)
  })

  it('während der Sperre wird nichts gesendet', async () => {
    const { component, lookupByEmployeeNumber } = setup({ lookup: async () => Promise.reject(locked()) })
    await component.lookupEmployee()
    component.employeeNumberInput.set('906182')
    await component.lookupEmployee()
    expect(lookupByEmployeeNumber).toHaveBeenCalledTimes(1)
  })

  it('Sperre ohne Wartezeit im Fehler → vorsichtiger Standard statt NaN', async () => {
    const { component } = setup({
      lookup: async () => Promise.reject(feathersError(429, 'x', { code: 'STAMP_LOCKED' })),
    })
    await component.lookupEmployee()
    expect(component.lockSecondsLeft()).toBe(60)
  })

  it('Zustandskonflikt (409) zeigt die Servermeldung', async () => {
    const { component } = setup({
      stamp: async () => Promise.reject(feathersError(409, 'Benutzer ist nicht eingestempelt')),
    })
    await component.lookupEmployee()
    await component.confirmAction()
    expect(component.errorMessage()).toBe('Benutzer ist nicht eingestempelt')
    expect(component.successMessage()).toBeNull()
  })

  it('unbekannter Fehler → „fehlgeschlagen“, nie Erfolg, keine Rohmeldung', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { component } = setup({
      lookup: async () => Promise.reject(feathersError(500, 'SQLITE_ERROR secret detail')),
    })
    await component.lookupEmployee()
    expect(component.errorMessage()).toBe('TIME_CLOCK.ACTION_FAILED')
    expect(component.successMessage()).toBeNull()
  })
})

describe('TimeClockPanel — Rückmeldung nach der Stempel-Aktion (core#810)', () => {
  it('Aufruf ohne Antwort (undefined) → Fehlermeldung statt Erfolg', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { component } = setup({ stamp: async () => undefined })
    await component.lookupEmployee()
    await component.confirmAction()
    expect(component.successMessage()).toBeNull()
    expect(component.errorMessage()).toBe('TIME_CLOCK.ACTION_FAILED')
    expect(component.pinError()).toBe(true)
  })

  it('Mandant gesperrt → Vorschau wird gar nicht gesendet, Sperr-Hinweis', async () => {
    const { component, lookupByEmployeeNumber } = setup({ suspended: true })
    await component.lookupEmployee()
    expect(lookupByEmployeeNumber).not.toHaveBeenCalled()
    expect(component.confirmation()).toBeNull()
    expect(component.errorMessage()).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
  })

  it('Mandant gesperrt zwischen Vorschau und Buchung → Buchung wird nicht gesendet', async () => {
    const { component, stampByEmployeeNumber, markSuspended } = setup()
    await component.lookupEmployee()
    markSuspended()
    await component.confirmAction()
    expect(stampByEmployeeNumber).not.toHaveBeenCalled()
    expect(component.successMessage()).toBeNull()
    expect(component.errorMessage()).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
  })

  it('Sperre erst durch diese Anfrage erkannt → Sperr-Hinweis statt „fehlgeschlagen“', async () => {
    const tenantSuspended = feathersError(403, 'TENANT_SUSPENDED: Mandant gesperrt', {
      code: 'TENANT_SUSPENDED',
      tenantStatus: 'SUSPENDED',
    })
    const { component, markSuspended } = setup({ stamp: async () => Promise.reject(tenantSuspended) })
    await component.lookupEmployee()
    await component.confirmAction()
    expect(markSuspended).toHaveBeenCalledTimes(1)
    expect(component.successMessage()).toBeNull()
    expect(component.errorMessage()).toBe('CLOUD_STATUS.TENANT_SUSPENDED')
  })
})
