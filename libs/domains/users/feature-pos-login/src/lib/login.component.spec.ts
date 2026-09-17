// JIT-Compiler zuerst laden: @angular/common (ueber den ConnectionService-Barrel)
// ist partial-compiled; ohne Linker (kein analogjs-Plugin in dieser
// node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { computed, Injector, runInInjectionContext, signal } from '@angular/core'
import { Router } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'
import { DeviceAssignmentService } from '@panary/devices/data-access'
import { DeviceAccessMode, type DeviceAccessModeValue } from '@panary/devices/domain'
import { ConnectionService, LanguageService } from '@panary/shared/data-access'
import { APP_CONFIG, DeviceConfigService } from '@panary/shared/data-access-config'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { UpdateService } from '@panary/shared/data-access-updater'
import { describe, expect, it, vi } from 'vitest'

import { LoginComponent } from './login.component'

// Die Einstiegs-Weiche des Login-Screens (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
// Auf einem zugewiesenen Geraet mit genau einem Mitarbeiter waere die
// Benutzerauswahl eine Liste mit einem Eintrag — ein Klick, den niemand
// braucht. Bleibt die Liste leer, ist die Zuweisung kaputt; ein Rueckfall auf
// die volle Liste waere dann genau das Leck, das die Zuweisung verhindern soll.

interface UserFixture {
  _id: string
  firstName: string
  lastName: string
}

const USERS: UserFixture[] = [
  { _id: 'u-anna', firstName: 'Anna', lastName: 'Alt' },
  { _id: 'u-bruno', firstName: 'Bruno', lastName: 'Berg' },
  { _id: 'u-clara', firstName: 'Clara', lastName: 'Cord' },
  { _id: 'u-dora', firstName: 'Dora', lastName: 'Dahl' },
  { _id: 'u-emil', firstName: 'Emil', lastName: 'Ernst' },
]

/** Signal-gestuetzter Ersatz fuer den DeviceAssignmentService (eigene Spec). */
function fakeAssignment(mode: DeviceAccessModeValue, assignedUserIds: string[] = []) {
  const accessMode = signal(mode)
  const ids = signal(assignedUserIds)
  return {
    accessMode: accessMode.asReadonly(),
    assignedUserIds: ids.asReadonly(),
    loaded: signal(true).asReadonly(),
    isAssigned: computed(() => accessMode() === DeviceAccessMode.ASSIGNED),
    isShared: computed(() => accessMode() !== DeviceAccessMode.ASSIGNED),
    refresh: vi.fn().mockResolvedValue(undefined),
  }
}

interface SetupOptions {
  mode?: DeviceAccessModeValue
  /** Was `users.find` liefert — serverseitig bereits auf den erlaubten Kreis verengt. */
  users?: UserFixture[]
  assignedUserIds?: string[]
  /** Das Geraet schuldet eine Bestaetigung nach langer Offline-Phase (#325). */
  reverificationRequired?: boolean
}

function setup(options: SetupOptions = {}) {
  const {
    mode = DeviceAccessMode.SHARED,
    users = USERS,
    assignedUserIds = users.map(u => u._id),
    reverificationRequired = false,
  } = options

  const assignment = fakeAssignment(mode, assignedUserIds)
  const find = vi.fn().mockResolvedValue({ data: users })
  const navigate = vi.fn()

  // Je Test angelegt (testing.md §10): Die Signals sind Aufzeichnungs- UND
  // Steuerzustand; im describe-Scope wuerde ein Nachzuegler in den Mock des
  // naechsten Tests schreiben.
  const connection = {
    connect: vi.fn(),
    // Sofort 'authenticated' → waitForConnection() loest im ersten Poll auf,
    // ohne Timer und ohne Fake-Clock.
    connectionState: signal({ status: 'authenticated' }),
    deviceAuthRejection: signal<string | null>(null),
    // Standardfall: keine Bestaetigung ausstehend (panary/panary-core#325).
    // Ueber `options.reverificationRequired` schaltbar — der Zweig gehoert in
    // `#resolveEntryStep` VOR die Zuweisungs-Logik und muss deshalb hier belegt
    // sein, sonst kippt jeder Einstiegsschritt in 'error'.
    deviceReverificationRequired: signal(reverificationRequired),
    deviceOfflineSince: signal<string | null>(reverificationRequired ? '2026-09-08T06:00:00.000Z' : null),
    markDeviceReverified: vi.fn(),
    usersService: { find },
    isConfiguredFor: () => true,
  }

  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: { navigate } },
      {
        provide: DeviceConfigService,
        useValue: { getConfig: () => ({ deviceId: 'terminal-1', deviceName: 'Kasse 1' }), clearConfig: vi.fn() },
      },
      { provide: ConnectionService, useValue: connection },
      { provide: DeviceAssignmentService, useValue: assignment },
      { provide: ThemeServiceService, useValue: { theme: 'light', setTheme: vi.fn() } },
      { provide: LanguageService, useValue: { currentLanguage: signal('de'), setLanguage: vi.fn() } },
      { provide: UpdateService, useValue: {} },
      { provide: APP_CONFIG, useValue: { appVersion: '0.0.0-test' } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
  })

  const component = runInInjectionContext(injector, () => new LoginComponent())

  return {
    component,
    connection,
    find,
    navigate,
    /**
     * Faehrt den echten Ladepfad (connect → warten → Zuweisung → Benutzer →
     * Einstiegsschritt). Bracket-Zugriff, weil `ngOnInit` das Promise nicht
     * herausgibt — ueber `retry()` waere der Test auf einen Flush angewiesen,
     * hier ist er deterministisch.
     */
    load: () => component['connectAndLoadUsers'](),
  }
}

describe('LoginComponent — Einstiegsschritt auf zugewiesenem Geraet', () => {
  it('springt bei genau einem Mitarbeiter direkt in die PIN-Eingabe', async () => {
    const { component } = setup({ mode: DeviceAccessMode.ASSIGNED, users: [USERS[0]] })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('enter-pin')
    // Ohne vorausgewaehlten Mitarbeiter liefe verifyPin() ins Leere.
    expect(component.selectedUser()?._id).toBe('u-anna')
    expect(component.pinInput()).toBe('')
    expect(component.pinError()).toBe(false)
  })

  it.each([2, 3, 4, 5])('zeigt bei %i Mitarbeitern die Benutzerauswahl', async count => {
    const { component } = setup({ mode: DeviceAccessMode.ASSIGNED, users: USERS.slice(0, count) })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('select-user')
    expect(component.selectedUser()).toBeNull()
  })

  it('meldet eine leere Liste als kaputte Zuweisung statt in die Auswahl zu fallen', async () => {
    const { component } = setup({ mode: DeviceAccessMode.ASSIGNED, users: [], assignedUserIds: ['u-geloescht'] })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('assignment-error')
    expect(component.selectedUser()).toBeNull()
  })

  it('ueberspringt die Auswahl auf einem geteilten Geraet auch bei einem Mitarbeiter nicht', async () => {
    const { component } = setup({ mode: DeviceAccessMode.SHARED, users: [USERS[0]] })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('select-user')
  })
})

describe('LoginComponent — isSingleUserDevice', () => {
  it('ist nur auf einem zugewiesenen Geraet mit genau einem Mitarbeiter wahr', async () => {
    const single = setup({ mode: DeviceAccessMode.ASSIGNED, users: [USERS[0]] })
    await single.component['connectAndLoadUsers']()
    expect(single.component.isSingleUserDevice()).toBe(true)

    const many = setup({ mode: DeviceAccessMode.ASSIGNED, users: USERS.slice(0, 2) })
    await many.component['connectAndLoadUsers']()
    expect(many.component.isSingleUserDevice()).toBe(false)

    // Ein geteiltes Geraet mit nur einem angelegten Mitarbeiter ist kein
    // Ein-Personen-Geraet — der Zurueck-Pfeil muss dort bleiben.
    const shared = setup({ mode: DeviceAccessMode.SHARED, users: [USERS[0]] })
    await shared.component['connectAndLoadUsers']()
    expect(shared.component.isSingleUserDevice()).toBe(false)
  })
})

describe('LoginComponent — cancelChangePin', () => {
  it('landet auf dem Einstiegsschritt statt fest auf der Benutzerauswahl', async () => {
    // Frueher immer 'select-user': Auf einem Ein-Personen-Geraet landete der
    // Bediener damit auf einem Screen mit einer einzigen Kachel, die er nie
    // gesehen hatte.
    const { component } = setup({ mode: DeviceAccessMode.ASSIGNED, users: [USERS[0]] })
    await component['connectAndLoadUsers']()

    component.currentStep.set('change-pin')
    component.newPin.set('1234')
    component.changePinPhase.set('confirm')

    component.cancelChangePin()

    expect(component.currentStep()).toBe('enter-pin')
    expect(component.selectedUser()?._id).toBe('u-anna')
    // Eingaben des abgebrochenen Wechsels duerfen nicht stehenbleiben.
    expect(component.newPin()).toBe('')
    expect(component.confirmPin()).toBe('')
    expect(component.changePinPhase()).toBe('new')
    expect(component.pinInput()).toBe('')
  })

  it('fuehrt auf einem geteilten Geraet weiterhin in die Benutzerauswahl', async () => {
    const { component } = setup({ mode: DeviceAccessMode.SHARED, users: USERS.slice(0, 3) })
    await component['connectAndLoadUsers']()

    component.currentStep.set('change-pin')
    component.cancelChangePin()

    expect(component.currentStep()).toBe('select-user')
    expect(component.selectedUser()).toBeNull()
  })

  it('fuehrt bei kaputter Zuweisung nicht in die Benutzerauswahl zurueck', async () => {
    const { component } = setup({ mode: DeviceAccessMode.ASSIGNED, users: [], assignedUserIds: ['u-geloescht'] })
    await component['connectAndLoadUsers']()

    component.currentStep.set('change-pin')
    component.cancelChangePin()

    expect(component.currentStep()).toBe('assignment-error')
  })
})

describe('LoginComponent — backToUsers', () => {
  it('bleibt auf einem Ein-Personen-Geraet in der PIN-Eingabe (Escape-Pfad)', async () => {
    const { component } = setup({ mode: DeviceAccessMode.ASSIGNED, users: [USERS[0]] })
    await component['connectAndLoadUsers']()

    component.pinInput.set('12')
    component.backToUsers()

    expect(component.currentStep()).toBe('enter-pin')
    expect(component.pinInput()).toBe('')
  })

  it('fuehrt auf einem geteilten Geraet zurueck in die Auswahl', async () => {
    const { component } = setup({ mode: DeviceAccessMode.SHARED })
    await component['connectAndLoadUsers']()

    component.selectUser(component.posUsers()[1])
    expect(component.currentStep()).toBe('enter-pin')

    component.backToUsers()

    expect(component.currentStep()).toBe('select-user')
    expect(component.selectedUser()).toBeNull()
  })
})

describe('LoginComponent — Ladepfad', () => {
  it('holt die Zuweisung vor den Benutzern und uebersteht einen Fehler dabei', async () => {
    const { component, find } = setup({ mode: DeviceAccessMode.SHARED, users: USERS.slice(0, 2) })
    const assignmentService = component['deviceAssignment'] as unknown as { refresh: ReturnType<typeof vi.fn> }
    assignmentService.refresh.mockRejectedValueOnce(new Error('devices nicht erreichbar'))

    await component['connectAndLoadUsers']()

    // Der Server-Scope wirkt ohnehin — ein Fehler beim Zuweisungs-Abruf darf den
    // Login nicht in die Fehlermaske kippen.
    expect(component.currentStep()).toBe('select-user')
    expect(find).toHaveBeenCalledOnce()
  })

  it('fordert nur die fuer den Login noetigen Felder an', async () => {
    const { component, find } = setup()

    await component['connectAndLoadUsers']()

    const query = find.mock.calls[0][0].query
    // employeeNumber ist das alleinige Credential fuer Time-Clock-Aktionen —
    // sie darf nicht in der Liste aller Mitarbeiter auf dem Terminal landen.
    expect(query.$select).not.toContain('employeeNumber')
    expect(query.$select).toContain('tenantId')
    expect(query.isPosUser).toBe(true)
  })
})

describe('LoginComponent — Re-Verifikation nach langer Offline-Phase (#325)', () => {
  it('schickt ein wartendes Geraet in den Bestaetigungsschritt statt in den Login', async () => {
    // Bewusst ein geteiltes Geraet mit mehreren Mitarbeitern: Ohne den neuen
    // Zweig waere das Ergebnis 'select-user' — der Bediener koennte sich
    // anmelden und erst beim ersten Bon auf eine unerklaerliche 503 laufen.
    const { component } = setup({ mode: DeviceAccessMode.SHARED, reverificationRequired: true })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('reverify')
  })

  it('schlaegt die Zuweisungs-Logik: auch ein Ein-Personen-Geraet wartet erst', async () => {
    const { component } = setup({
      mode: DeviceAccessMode.ASSIGNED,
      users: USERS.slice(0, 1),
      reverificationRequired: true,
    })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('reverify')
  })

  it('nimmt nach der Freigabe den regulaeren Einstiegsschritt auf', async () => {
    // Nach der Freigabe steht das Signal auf false (der ConnectionService
    // quittiert sie in `markDeviceReverified`); der Login laeuft dann normal an.
    const { component, connection } = setup({
      mode: DeviceAccessMode.SHARED,
      users: USERS.slice(0, 2),
      reverificationRequired: true,
    })
    await component['connectAndLoadUsers']()
    expect(component.currentStep()).toBe('reverify')

    connection.deviceReverificationRequired.set(false)
    component['onReverified']()

    expect(component.currentStep()).toBe('select-user')
  })

  it('laesst den Alltagsbetrieb unberuehrt', async () => {
    const { component } = setup({ mode: DeviceAccessMode.SHARED, users: USERS.slice(0, 2) })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('select-user')
  })
})
