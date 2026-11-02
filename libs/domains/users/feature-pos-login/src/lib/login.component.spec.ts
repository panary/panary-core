// JIT-Compiler zuerst laden: @angular/common (ueber den ConnectionService-Barrel)
// ist partial-compiled; ohne Linker (kein analogjs-Plugin in dieser
// node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { computed, Injector, runInInjectionContext, signal } from '@angular/core'
import { Router } from '@angular/router'
import { PosSessionService, type PosLogoutReason } from '@panary/auth/data-access'
import { TranslateService } from '@ngx-translate/core'
import { DeviceAssignmentService, DeviceOrderChannelService } from '@panary/devices/data-access'
import { DeviceAccessMode, type DeviceAccessModeValue } from '@panary/devices/domain'
import { ConnectionService, LanguageService, OFFLINE_OUTBOX } from '@panary/shared/data-access'
import { APP_CONFIG, DeviceConfigService } from '@panary/shared/data-access-config'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { UpdateService } from '@panary/shared/data-access-updater'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { IDLE_NOTICE_DURATION_MS, LoginComponent } from './login.component'

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
  /** Ablehnungsgrund des Servers beim Handshake (`device:authenticated` mit `success: false`). */
  rejection?: string | null
  /** Noch nicht uebertragene Outbox-Eintraege; `undefined` = kein Outbox-Provider. */
  pendingOutbox?: number
  /** Grund des vorigen Sitzungsendes, den `PosSessionService` einmalig herausgibt (#604). */
  endReason?: PosLogoutReason | null
  /** Hat das vorige Sitzungsende einen offenen Dialog geschlossen (#941)? */
  endInterrupted?: boolean
}

function setup(options: SetupOptions = {}) {
  const {
    mode = DeviceAccessMode.SHARED,
    users = USERS,
    assignedUserIds = users.map(u => u._id),
    reverificationRequired = false,
    rejection = null,
    pendingOutbox,
    endReason = null,
    endInterrupted = false,
  } = options

  const assignment = fakeAssignment(mode, assignedUserIds)
  const orderChannel = { refresh: vi.fn().mockResolvedValue(undefined) }
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
    deviceAuthRejection: signal<string | null>(rejection),
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

  const clearConfig = vi.fn()
  const outboxPending = signal(pendingOutbox ?? 0)

  const injector = Injector.create({
    providers: [
      ...(pendingOutbox === undefined
        ? []
        : [{ provide: OFFLINE_OUTBOX, useValue: { pendingCount: () => outboxPending() } }]),
      { provide: Router, useValue: { navigate } },
      {
        provide: DeviceConfigService,
        // Bewusst ohne `unpair`: Die Neukopplung darf die Outbox nicht loeschen.
        // Ein Aufruf liefe hier auf einen TypeError und machte den Test rot.
        useValue: { getConfig: () => ({ deviceId: 'terminal-1', deviceName: 'Kasse 1' }), clearConfig },
      },
      { provide: ConnectionService, useValue: connection },
      { provide: DeviceAssignmentService, useValue: assignment },
      { provide: DeviceOrderChannelService, useValue: orderChannel },
      { provide: ThemeServiceService, useValue: { theme: 'light', setTheme: vi.fn() } },
      { provide: LanguageService, useValue: { currentLanguage: signal('de'), setLanguage: vi.fn() } },
      { provide: UpdateService, useValue: {} },
      { provide: APP_CONFIG, useValue: { appVersion: '0.0.0-test' } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      {
        provide: PosSessionService,
        useValue: {
          consumeEndReason: vi.fn().mockReturnValue(endReason),
          consumeEndInterrupted: vi.fn().mockReturnValue(endInterrupted),
        },
      },
    ],
  })

  const component = runInInjectionContext(injector, () => new LoginComponent())
  // `window.location.reload()` gibt es in der node-Umgebung nicht.
  const reload = vi
    .spyOn(component as unknown as { refreshPage: () => void }, 'refreshPage')
    .mockImplementation(() => undefined)

  return {
    component,
    connection,
    clearConfig,
    reload,
    outboxPending,
    find,
    navigate,
    orderChannel,
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

  it('holt die Standard-Bestellart bei jedem Ladepfad und uebersteht einen Fehler dabei (core#1166)', async () => {
    const { component, find, orderChannel } = setup({ mode: DeviceAccessMode.SHARED, users: USERS.slice(0, 2) })
    orderChannel.refresh.mockRejectedValueOnce(new Error('devices nicht erreichbar'))

    await component['connectAndLoadUsers']()
    expect(orderChannel.refresh).toHaveBeenCalledOnce()
    expect(component.currentStep()).toBe('select-user')
    expect(find).toHaveBeenCalledOnce()

    await component['connectAndLoadUsers']()
    expect(orderChannel.refresh).toHaveBeenCalledTimes(2)
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

describe('LoginComponent — Neukopplung nach abgelaufenem Schluessel (#524)', () => {
  it('fuehrt einen abgelaufenen Schluessel in die Fehlermaske mit Neukopplungs-Weg', async () => {
    const { component } = setup({ rejection: 'DEVICE_KEY_EXPIRED' })

    await component['connectAndLoadUsers']()

    expect(component.currentStep()).toBe('error')
    expect(component.errorKind()).toBe('device-key-expired')
    expect(component.errorMessage()).toBe('LOGIN.DEVICE_KEY_EXPIRED')
  })

  it('bietet einem deaktivierten Geraet keinen Weg am Geraet an', async () => {
    // Sonst wird aus der Sperre im Admin eine Einladung, sie am Geraet zu umgehen.
    const { component, clearConfig } = setup({ rejection: 'DEVICE_REJECTED' })
    await component['connectAndLoadUsers']()
    expect(component.errorKind()).toBe('device-rejected')

    component.requestRepair()
    component.confirmRepair()

    expect(component.currentStep()).toBe('error')
    expect(clearConfig).not.toHaveBeenCalled()
  })

  it('fragt vor dem Loesen der Kopplung nach und nennt die offene Outbox', async () => {
    const { component, clearConfig } = setup({ rejection: 'DEVICE_KEY_EXPIRED', pendingOutbox: 2 })
    await component['connectAndLoadUsers']()

    component.requestRepair()

    expect(component.currentStep()).toBe('repair-confirm')
    expect(component.pendingOutboxCount()).toBe(2)
    expect(clearConfig).not.toHaveBeenCalled()
  })

  it('verwirft beim Abbruch nichts', async () => {
    const { component, clearConfig, reload } = setup({ rejection: 'DEVICE_KEY_EXPIRED', pendingOutbox: 2 })
    await component['connectAndLoadUsers']()
    component.requestRepair()

    component.cancelRepair()

    expect(component.currentStep()).toBe('error')
    expect(clearConfig).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('loest nach Bestaetigung nur die Kopplung und startet in den Setup-Wizard', async () => {
    const { component, clearConfig, reload } = setup({ rejection: 'DEVICE_KEY_EXPIRED', pendingOutbox: 2 })
    await component['connectAndLoadUsers']()
    component.requestRepair()

    component.confirmRepair()

    // `clearConfig` statt `unpair`: Die Outbox bleibt fuer eine Kopplung an
    // dieselbe Filiale erhalten (der Fake-Service hat kein `unpair`).
    expect(clearConfig).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('zeigt ohne Outbox-Provider null offene Eintraege', async () => {
    const { component } = setup({ rejection: 'DEVICE_KEY_EXPIRED' })
    await component['connectAndLoadUsers']()

    expect(component.pendingOutboxCount()).toBe(0)
  })

  it('vergisst den Ablehnungsgrund beim naechsten Versuch', async () => {
    // Ein spaeterer Transportfehler darf nicht den Neukopplungs-Knopf erben.
    const { component, connection } = setup({ rejection: 'DEVICE_KEY_EXPIRED' })
    await component['connectAndLoadUsers']()
    expect(component.errorKind()).toBe('device-key-expired')

    connection.deviceAuthRejection.set(null)
    await component['connectAndLoadUsers']()

    expect(component.errorKind()).toBe('connection')
    expect(component.currentStep()).toBe('select-user')
  })
})

describe('LoginComponent — Hinweis nach Inaktivitaets-Logout (#604)', () => {
  // Der Auto-Logout schliesst eine offene Storno-Freigabe ohne Rueckmeldung. Der
  // Login sieht mit Personenwahl und Ziffernfeld aus wie deren PIN-Schritt — ohne
  // Hinweis meldete sich der Manager an, statt zu stornieren.
  it('zeigt den Hinweis, wenn die vorige Sitzung durch Inaktivitaet endete', () => {
    const { component } = setup({ endReason: 'idle' })

    component.ngOnInit()

    expect(component.idleLogoutNotice()).toBe(true)
  })

  it.each(['button', 'clock-out', null] as const)('zeigt ihn nicht bei Grund %s', reason => {
    const { component } = setup({ endReason: reason })

    component.ngOnInit()

    expect(component.idleLogoutNotice()).toBe(false)
  })

  // #941: Der Satz „eine offene Aktion wurde abgebrochen“ gilt nur, wenn der Logout einen Dialog geschlossen hat.
  it.each([true, false])('trägt den Abbruch-Satz nur bei geschlossenem Dialog (interrupted=%s)', interrupted => {
    const { component } = setup({ endReason: 'idle', endInterrupted: interrupted })

    component.ngOnInit()

    expect(component.idleLogoutInterrupted()).toBe(interrupted)
  })

  it.each(['select-user', 'enter-pin'] as const)('blendet ihn im Schritt %s ein', step => {
    const { component } = setup({ endReason: 'idle' })
    component.ngOnInit()

    component.currentStep.set(step)

    expect(component.showIdleLogoutNotice()).toBe(true)
  })

  it.each(['loading', 'reverify', 'change-pin', 'error', 'assignment-error', 'repair-confirm'] as const)(
    'blendet ihn im Schritt %s aus',
    step => {
      const { component } = setup({ endReason: 'idle' })
      component.ngOnInit()

      component.currentStep.set(step)

      expect(component.showIdleLogoutNotice()).toBe(false)
    },
  )
})

// #1170: Der Hinweis blendet sich nach IDLE_NOTICE_DURATION_MS selbst aus. Gezaehlt wird ab
// dem ersten Sichtbarwerden, ein Schrittwechsel oder erneutes Laden startet nicht neu.
describe('LoginComponent — Inaktivitaets-Hinweis blendet sich aus (#1170)', () => {
  function idleSetup(options: SetupOptions = {}) {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const ctx = setup({ endReason: 'idle', ...options })
    // Wie `ngOnInit`, aber ohne den unbeobachteten Ladeaufruf: den faehrt der Test selbst.
    ctx.component.idleLogoutNotice.set(true)
    ctx.component.idleLogoutInterrupted.set(options.endInterrupted ?? false)
    return ctx
  }

  it('dauert mindestens 15 Sekunden', () => {
    expect(IDLE_NOTICE_DURATION_MS).toBe(15_000)
  })

  it('steht bis kurz vor Ablauf und ist mit Ablauf weg', async () => {
    const { component, load } = idleSetup()
    await load()
    expect(component.showIdleLogoutNotice()).toBe(true)

    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS - 1)
    expect(component.showIdleLogoutNotice()).toBe(true)

    vi.advanceTimersByTime(1)
    expect(component.idleLogoutNotice()).toBe(false)
    expect(component.showIdleLogoutNotice()).toBe(false)
  })

  it('nimmt den Abbruch-Satz aus #941 mit', async () => {
    const { component, load } = idleSetup({ endInterrupted: true })
    await load()
    expect(component.idleLogoutInterrupted()).toBe(true)

    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS)

    expect(component.idleLogoutInterrupted()).toBe(false)
  })

  it('zaehlt die Ladephase nicht mit', async () => {
    const { component, load } = idleSetup()
    // Solange `loading` laeuft, ist das Banner unsichtbar — die Zeit darf nicht ablaufen.
    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS)
    expect(component.idleLogoutNotice()).toBe(true)

    await load()
    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS - 1)

    expect(component.showIdleLogoutNotice()).toBe(true)
  })

  it('startet bei Schrittwechseln nicht neu', async () => {
    const { component, load } = idleSetup()
    await load()
    vi.advanceTimersByTime(10_000)

    component.selectUser(component.posUsers()[0] as never)
    component.currentStep.set('change-pin')
    component.backToUsers()
    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS - 10_000)

    expect(component.idleLogoutNotice()).toBe(false)
  })

  it('startet bei erneutem Laden nicht neu', async () => {
    const { component, load } = idleSetup()
    await load()
    vi.advanceTimersByTime(10_000)

    await load()
    // Der Balken setzt an der verstrichenen Stelle fort, statt von vorn zu laufen.
    expect(component['idleNoticeAnimationDelayMs']()).toBe(-10_000)
    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS - 10_000)

    expect(component.idleLogoutNotice()).toBe(false)
  })

  it('haelt den Balken-Versatz zwischen zwei Auswertungen fest', async () => {
    const { component, load } = idleSetup()
    await load()
    const first = component['idleNoticeAnimationDelayMs']()

    vi.advanceTimersByTime(3_000)

    expect(component['idleNoticeAnimationDelayMs']()).toBe(first)
  })

  it('setzt den Balken nach dem Wiedereinblenden an der verstrichenen Stelle fort', async () => {
    const { component, load } = idleSetup()
    await load()
    vi.advanceTimersByTime(4_000)

    component.currentStep.set('change-pin')
    component.backToUsers()

    expect(component['idleNoticeAnimationDelayMs']()).toBe(-4_000)
  })

  it('startet nach der Re-Verifikation, nicht schon im Schritt reverify', async () => {
    const { component, connection, load } = idleSetup({ reverificationRequired: true })
    await load()
    expect(component.currentStep()).toBe('reverify')
    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS)
    expect(component.idleLogoutNotice()).toBe(true)

    connection.deviceReverificationRequired.set(false)
    component['onReverified']()
    vi.advanceTimersByTime(IDLE_NOTICE_DURATION_MS - 1)
    expect(component.showIdleLogoutNotice()).toBe(true)

    vi.advanceTimersByTime(1)
    expect(component.idleLogoutNotice()).toBe(false)
  })

  it('startet ohne Inaktivitaets-Logout keinen Timer', async () => {
    const { component, load } = idleSetup({ endReason: null })
    component.idleLogoutNotice.set(false)
    await load()

    expect(vi.getTimerCount()).toBe(0)
    expect(component.showIdleLogoutNotice()).toBe(false)
  })
})

// Bediener-Token (panary/panary-core#619, ADR 0053, Schritt 3): Der PIN-Login legt
// das Token aus `verifyPin` ab — und raeumt das eines vorigen Bedieners weg.
describe('LoginComponent — Bediener-Token', () => {
  function loginWith(verifyPinResult: Record<string, unknown>, initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    const ctx = setup()
    ;(ctx.connection.usersService as Record<string, unknown>)['verifyPin'] = vi.fn().mockResolvedValue(verifyPinResult)
    ctx.component.selectedUser.set({ _id: 'u-anna', firstName: 'Anna', lastName: 'Alt', initials: 'AA' } as never)
    ctx.component.pinInput.set('1234')
    return { ...ctx, store }
  }

  it('legt das Token aus verifyPin unter pos_operator_token ab', async () => {
    const { component, store } = loginWith({
      _id: 'u-anna',
      operatorToken: 'tok-anna',
      operatorTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    })

    await component.verifyPin()

    expect(JSON.parse(store.get('pos_operator_token') as string)).toEqual({
      operatorToken: 'tok-anna',
      operatorTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    })
    // Das Token gehoert nicht in pos_current_user — den lesen sieben Stellen.
    expect(store.get('pos_current_user')).not.toContain('tok-anna')
  })

  it('landet nach erfolgreicher PIN auf der Übersicht, nicht in der Kasse (core#907)', async () => {
    const { component, navigate } = loginWith({ _id: 'u-anna', firstName: 'Anna', lastName: 'Alt' })

    await component.verifyPin()

    expect(navigate.mock.calls).toEqual([[['/dashboard']]])
  })

  it('behaelt das Token aus verifyPin ueber den erzwungenen PIN-Wechsel', async () => {
    // `changePin` liefert kein Token — es stammt aus dem verifyPin davor.
    const { component, connection, store } = loginWith({
      _id: 'u-anna',
      mustChangePosPin: true,
      operatorToken: 'tok-anna',
      operatorTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    })
    ;(connection.usersService as Record<string, unknown>)['changePin'] = vi
      .fn()
      .mockResolvedValue({ _id: 'u-anna', mustChangePosPin: false })

    await component.verifyPin()
    expect(component.currentStep()).toBe('change-pin')
    expect(store.has('pos_operator_token')).toBe(false)

    component.newPin.set('5678')
    component.confirmPin.set('5678')
    await component.submitNewPin()

    expect(JSON.parse(store.get('pos_operator_token') as string)['operatorToken']).toBe('tok-anna')
  })

  it('entfernt das Token des vorigen Bedieners, wenn verifyPin keines liefert', async () => {
    const { component, store } = loginWith(
      { _id: 'u-anna' },
      {
        pos_operator_token: JSON.stringify({
          operatorToken: 'tok-bruno',
          operatorTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        }),
      },
    )

    await component.verifyPin()

    expect(store.has('pos_operator_token')).toBe(false)
  })
})

// Die installierte Version stand doppelt auf dem Login: im Seitenpanel neben dem
// Geraetenamen und im Footer links unten (panary/panary-core#1169). Sie bleibt nur im
// Footer, weil das Panel erst ab `lg` sichtbar ist. Die node-Vitest-Config rendert kein
// Template, deshalb wird die Quelle gezaehlt statt des gerenderten DOM.
describe('LoginComponent — Versionsanzeige', () => {
  const html = readFileSync(join(__dirname, 'login.component.html'), 'utf8')

  it('bindet die installierte Version genau einmal, im Footer', () => {
    const bindings = html.match(/\{\{\s*appVersion\s*\}\}/g) ?? []
    expect(bindings).toEqual(['{{ appVersion }}'])
    const footer = html.slice(html.indexOf('<!-- Footer with Connection Indicator -->'))
    expect(footer).toContain('Panary Terminal &bull; </span>v{{ appVersion }}')
  })

  it('zeigt im Seitenpanel nur den Geraetenamen', () => {
    const aside = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? ''
    expect(aside).toContain(`{{ deviceName() || 'POS Terminal' }}</p>`)
    expect(aside).not.toContain('appVersion')
  })
})
