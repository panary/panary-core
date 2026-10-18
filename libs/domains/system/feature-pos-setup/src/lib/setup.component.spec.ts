// JIT-Compiler zuerst laden — siehe order-dialog.component.spec.ts (ADR 0011).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import {
  DestroyRef,
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { LanguageService } from '@panary/shared/data-access'
import {
  APP_CONFIG,
  DeviceConfigService,
  HubDiscoveryService,
  type AdminLoginOptions,
  type AdminLoginResult,
  type SetupCredentials,
} from '@panary/shared/data-access-config'
import { ThemeServiceService } from '@panary/shared/data-access-theme'

import { SetupComponent } from './setup.component'

/**
 * Admin-Login-Weiche im POS-Setup (core#754): Auswahl, Abweisung im Formular, Wechsel in den
 * Code-Modus und der Hub-Button. Was `adminLogin()` am Socket tut, prüft
 * `device-config.admin-login.spec.ts` in data-access-config.
 *
 * Aufbau wie `unpair-device-dialog.component.spec.ts`: echte Instanz ohne TestBed, alle
 * `inject()`-Tokens als `useValue`-Mocks in einem eigenen Injector. Alles je Test angelegt
 * (`.claude/rules/testing.md` §10).
 */
function setup(results: AdminLoginResult[] = [{ kind: 'ok' }]) {
  const calls: SetupCredentials[] = []
  const options: (AdminLoginOptions | undefined)[] = []
  const queue = [...results]
  const configService = {
    registrationStatus: signal('idle'),
    registrationError: signal<string | null>(null),
    organizations: signal([{ _id: 't1', name: 'Backstube' }]),
    locations: signal([{ _id: 'l1', name: 'Altstadt', tenantId: 't1' }]),
    getLanguage: () => 'de',
    resetStatus: () => undefined,
    adminLogin: vi.fn((credentials: SetupCredentials, opts?: AdminLoginOptions) => {
      calls.push(credentials)
      options.push(opts)
      return Promise.resolve(queue.shift() ?? { kind: 'ok' })
    }),
  }

  const injector = Injector.create({
    providers: [
      { provide: DeviceConfigService, useValue: configService },
      { provide: HubDiscoveryService, useValue: { hubs: signal([]), scanning: signal(false), isTauri: false } },
      { provide: ThemeServiceService, useValue: { theme: 'light', setTheme: () => undefined } },
      { provide: LanguageService, useValue: { currentLanguage: () => 'de', setLanguage: () => undefined } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: APP_CONFIG, useValue: { appVersion: 'test', cloudUrl: 'https://api.panary.test' } },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: () => undefined } },
      {
        provide: ɵEffectScheduler,
        useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined },
      },
      { provide: DestroyRef, useValue: { onDestroy: () => () => undefined } },
    ],
  })
  const component = runInInjectionContext(injector, () => new SetupComponent())

  return { component, calls, options, configService }
}

const fillAdminForm = (component: SetupComponent) => {
  component.email = 'owner@example.invalid'
  component.password = 'geheim'
}

describe('SetupComponent — Admin-Login im Cloud-Pfad', () => {
  it('meldet sich gegen die Cloud an und wechselt danach zur Organisationswahl', async () => {
    const { component, calls } = setup()
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)

    await component.submitStep1()

    expect(calls).toEqual([
      { serverUrl: 'https://api.panary.test', email: 'owner@example.invalid', password: 'geheim', target: 'cloud' },
    ])
    expect(component.currentStep()).toBe('select-org')
    expect(component.selectedTenantId).toBe('t1')
    expect(component.selectedLocationId).toBe('l1')
  })

  it('zeigt bei mehreren Mitgliedschaften die Auswahl und koppelt die gewählte', async () => {
    const memberships = [
      { membershipId: 'm1', tenantId: 't1', tenantName: 'Backstube', role: 'tenant:owner' },
      { membershipId: 'm2', tenantId: 't2', tenantName: 'Café Hafen', role: 'tenant:manager' },
    ]
    const { component, calls } = setup([{ kind: 'selection', memberships }, { kind: 'ok' }])
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)

    await component.submitStep1()

    expect(component.currentStep()).toBe('server-login')
    expect(component.loginMemberships()).toEqual(memberships)

    await component.submitStep1('m2')

    expect(calls[1]).toEqual(expect.objectContaining({ membershipId: 'm2', password: 'geheim', target: 'cloud' }))
    expect(component.loginMemberships()).toEqual([])
    expect(component.currentStep()).toBe('select-org')
  })

  it('wechselt bei verlangtem zweitem Faktor mit Meldung in den Code-Modus', async () => {
    const { component } = setup([{ kind: 'rejected', rejection: { kind: 'mfa-required' } }])
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)

    await component.submitStep1()

    expect(component.currentStep()).toBe('server-login')
    expect(component.serverLoginMode()).toBe('code')
    expect(component.loginRejectionMessage()?.key).toBe('SETUP.LOGIN_MFA_REQUIRED')
  })

  it('leert bei falschem Passwort das Passwortfeld und bleibt im Formular', async () => {
    const { component } = setup([{ kind: 'rejected', rejection: { kind: 'invalid-credentials' } }])
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)

    await component.submitStep1()

    expect(component.currentStep()).toBe('server-login')
    expect(component.serverLoginMode()).toBe('admin')
    expect(component.password).toBe('')
    expect(component.loginRejectionMessage()?.key).toBe('SETUP.LOGIN_INVALID_CREDENTIALS')
  })

  it('lässt bei Drosselung das Passwort stehen und nennt die Wartezeit', async () => {
    const { component } = setup([{ kind: 'rejected', rejection: { kind: 'rate-limited', retryAfter: 42 } }])
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)

    await component.submitStep1()

    expect(component.password).toBe('geheim')
    expect(component.loginRejectionMessage()).toEqual({ key: 'SETUP.LOGIN_RATE_LIMITED', params: { seconds: 42 } })
  })

  it('verwirft eine alte Abweisung beim Wechsel des Formulars', async () => {
    const { component } = setup([{ kind: 'rejected', rejection: { kind: 'invalid-credentials' } }])
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)
    await component.submitStep1()

    component.switchServerLoginMode('code')

    expect(component.loginRejectionMessage()).toBeNull()
  })
})

describe('SetupComponent — Login-Nachweis (core#755)', () => {
  it('reicht einen Löser an adminLogin weiter', async () => {
    const { component, options } = setup()
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)

    await component.submitStep1()

    expect(typeof options[0]?.solveLoginProof).toBe('function')
  })

  it('sagt die laufende Sicherheitsprüfung an und sperrt das Formular', () => {
    const { component, configService } = setup()

    configService.registrationStatus.set('solving')

    expect(component.isLoading()).toBe(true)
    expect(component.loginBusyKey()).toBe('SETUP.STATUS_PROOF')
  })

  it('zeigt einen gescheiterten Nachweis im Formular und lässt das Passwort stehen', async () => {
    const { component } = setup([{ kind: 'rejected', rejection: { kind: 'proof-failed' } }])
    component.chooseCloud()
    component.switchServerLoginMode('admin')
    fillAdminForm(component)

    await component.submitStep1()

    expect(component.currentStep()).toBe('server-login')
    expect(component.password).toBe('geheim')
    expect(component.loginRejectionMessage()?.key).toBe('SETUP.LOGIN_PROOF_FAILED')
  })
})

describe('SetupComponent — Hub-Pfad', () => {
  it('öffnet über den Hub-Button direkt das Admin-Formular', () => {
    const { component } = setup()
    component.chooseLocalHub()

    component.goToServerLogin()

    expect(component.currentStep()).toBe('server-login')
    expect(component.serverLoginMode()).toBe('admin')
  })

  it('meldet sich am Hub mit target hub an', async () => {
    const { component, calls } = setup()
    component.chooseLocalHub()
    component.serverUrl = 'http://192.168.1.5:3030'
    component.goToServerLogin()
    fillAdminForm(component)

    await component.submitStep1()

    expect(calls[0]).toEqual(expect.objectContaining({ serverUrl: 'http://192.168.1.5:3030', target: 'hub' }))
  })
})
