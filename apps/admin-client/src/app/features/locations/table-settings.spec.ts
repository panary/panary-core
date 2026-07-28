import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { TableSettingsComponent } from './table-settings'

function setup(opts: { settings?: Record<string, unknown>; cloudPaired?: boolean } = {}) {
  const api = {
    find: vi.fn().mockResolvedValue({ data: [{ _id: 'loc-1', settings: opts.settings ?? {} }] }),
    patch: vi.fn().mockResolvedValue({}),
  }
  const connection = {
    healthLoaded: signal(true),
    cloudPaired: signal(opts.cloudPaired ?? false),
    emergencyOverrideActive: signal(false),
    emergencyOverrideSinceMin: signal<number | null>(null),
    cloudUnreachable: signal(false),
    cloudContactUnknown: signal(false),
    refreshHealth: vi.fn().mockResolvedValue(undefined),
  }
  TestBed.configureTestingModule({
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
      { provide: TranslateService, useValue: { instant: (k: string) => k } },
    ],
  })
  const component = TestBed.runInInjectionContext(() => new TableSettingsComponent()) as any
  return { component, api }
}

/** Die Raum-ID ist clientseitig vergeben — Tests greifen sie ueber die Position ab. */
const roomId = (component: any, index: number): string => component.rooms()[index].id

const lastPayload = (api: { patch: ReturnType<typeof vi.fn> }) =>
  api.patch.mock.calls.at(-1)?.[2] as { settings: { tableSettings: { rooms: Array<{ name: string; tables: unknown[] }> } } }

beforeEach(() => {
  TestBed.resetTestingModule()
  vi.clearAllMocks()
})

describe('TableSettingsComponent — Legacy-Migration', () => {
  it('vergibt Legacy-String-Tischen eine stabile ID und meldet die Migration', async () => {
    const { component } = setup({ settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: ['T1', 'T2'] }] } } })

    await component.ngOnInit()

    expect(component.migrationPending()).toBe(true)
    const tables = component.rooms()[0].tables
    expect(tables.map((t: { label: string }) => t.label)).toEqual(['T1', 'T2'])
    expect(tables.every((t: { id: string }) => typeof t.id === 'string' && t.id.length > 0)).toBe(true)
  })

  // Objekte muessen durchgereicht, nicht neu gebaut werden — sonst gehen
  // Felder wie `seats` still verloren.
  it('erhaelt seats an bestehenden Tisch-Objekten', async () => {
    const { component, api } = setup({
      settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [{ id: 'tbl-1', label: 'T1', seats: 4 }] }] } },
    })
    await component.ngOnInit()

    expect(component.migrationPending()).toBe(false)
    await component.toggleEnabled()

    expect(lastPayload(api).settings.tableSettings.rooms[0].tables[0]).toEqual({ id: 'tbl-1', label: 'T1', seats: 4 })
  })

  it('schreibt beim Laden nichts — Migration passiert erst bei einer Nutzeraktion', async () => {
    const { component, api } = setup({ settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: ['T1'] }] } } })

    await component.ngOnInit()

    expect(api.patch).not.toHaveBeenCalled()
  })
})

describe('TableSettingsComponent — Auto-Save-Fallen', () => {
  // `room.name` hat minLength 1 im Schema: ein Save direkt nach addRoom() liefe
  // in einen 400.
  it('speichert beim Anlegen eines Bereichs nicht', async () => {
    const { component, api } = setup()
    await component.ngOnInit()

    component.addRoom()

    expect(component.rooms()).toHaveLength(1)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('speichert erst, wenn der Bereich einen Namen bekommt', async () => {
    const { component, api } = setup()
    await component.ngOnInit()
    component.addRoom()

    component.commitRoomName(roomId(component, 0))
    expect(api.patch).not.toHaveBeenCalled()

    component.onRoomNameInput(roomId(component, 0), 'Terrasse')
    component.commitRoomName(roomId(component, 0))
    await Promise.resolve()
    await Promise.resolve()

    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  // Ein unbenannter Bereich MIT Tischen ist ebenso invalide — die Cloud-Vorlage
  // filtert nur `name === '' && tables.length === 0`, das reicht hier nicht.
  it('filtert namenlose Bereiche aus dem Payload, auch mit Tischen', async () => {
    const { component, api } = setup({ settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } } })
    await component.ngOnInit()
    component.addRoom()
    component.setPendingTable(roomId(component, 1), 'T9')
    await component.addTables(roomId(component, 1))

    const rooms = lastPayload(api).settings.tableSettings.rooms
    expect(rooms).toHaveLength(1)
    expect(rooms[0].name).toBe('Innen')
  })
})

describe('TableSettingsComponent — Bereichs-Identitaet', () => {
  // Vorher waren `pendingTable` und `track` an den Array-Index gekoppelt: nach
  // dem Entfernen eines Bereichs rutschten alle folgenden eine Position vor,
  // und der eingetippte Text landete im falschen Raum.
  it('haelt den eingetippten Text am Bereich fest, wenn ein anderer entfernt wird', async () => {
    const { component } = setup({
      settings: {
        tableSettings: {
          enabled: true,
          rooms: [
            { name: 'Innen', tables: [] },
            { name: 'Terrasse', tables: [] },
            { name: 'Bar', tables: [] },
          ],
        },
      },
    })
    await component.ngOnInit()
    const barId = roomId(component, 2)
    component.setPendingTable(barId, 'T20-T22')

    await component.removeRoom(roomId(component, 0))

    // „Bar" steht jetzt an Position 1 — der Text muss mitgewandert sein.
    expect(component.rooms()[1].id).toBe(barId)
    expect(component.pendingLabel(barId)).toBe('T20-T22')
    await component.addTables(barId)
    expect(component.rooms()[1].tables.map((t: { label: string }) => t.label)).toEqual(['T20', 'T21', 'T22'])
  })

  it('raeumt den pending-Eintrag eines entfernten Bereichs ab', async () => {
    const { component } = setup({
      settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } },
    })
    await component.ngOnInit()
    const id = roomId(component, 0)
    component.setPendingTable(id, 'T1')

    await component.removeRoom(id)

    expect(component.pendingTable()[id]).toBeUndefined()
  })

  // Ein geleerter Name wuerde beim Speichern herausgefiltert — die UI zeigte
  // dann einen namenlosen Bereich, waehrend die DB ihn samt Tischen weiterfuehrt.
  it('faellt bei geleertem Namen auf den gespeicherten zurueck', async () => {
    const { component, api } = setup({
      settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } },
    })
    await component.ngOnInit()
    const id = roomId(component, 0)

    component.onRoomNameInput(id, '')
    component.commitRoomName(id)

    expect(component.rooms()[0].name).toBe('Innen')
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('laesst einen neu angelegten Bereich leer, statt etwas zu erfinden', async () => {
    const { component } = setup()
    await component.ngOnInit()
    component.addRoom()
    const id = roomId(component, 0)

    component.onRoomNameInput(id, '')
    component.commitRoomName(id)

    expect(component.rooms()[0].name).toBe('')
  })

  it('streift die clientseitigen Felder aus dem Payload', async () => {
    const { component, api } = setup({
      settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } },
    })
    await component.ngOnInit()

    await component.toggleEnabled()

    expect(Object.keys(lastPayload(api).settings.tableSettings.rooms[0]).sort()).toEqual(['name', 'tables'])
  })
})

describe('TableSettingsComponent — Tisch-Eingabe', () => {
  it('expandiert einen Bereich und erhaelt Null-Padding', async () => {
    const { component } = setup({ settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } } })
    await component.ngOnInit()

    component.setPendingTable(roomId(component, 0), 'T01-T04')
    await component.addTables(roomId(component, 0))

    expect(component.rooms()[0].tables.map((t: { label: string }) => t.label)).toEqual(['T01', 'T02', 'T03', 'T04'])
  })

  it('nimmt mehrere kommaseparierte Bezeichnungen entgegen', async () => {
    const { component } = setup({ settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } } })
    await component.ngOnInit()

    component.setPendingTable(roomId(component, 0), 'T1, A1; B2')
    await component.addTables(roomId(component, 0))

    expect(component.rooms()[0].tables.map((t: { label: string }) => t.label)).toEqual(['T1', 'A1', 'B2'])
  })

  // Der POS flacht alle Raeume zu einer Label-Liste ab und nutzt das Label als
  // Identitaet der Tisch-Kachel — zwei gleiche Labels ergaeben dort zwei
  // ununterscheidbare Buttons.
  it('blockt ein raumuebergreifendes Duplikat', async () => {
    const { component, api } = setup({
      settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [{ id: 'a', label: 'T1' }] }, { name: 'Terrasse', tables: [] }] } },
    })
    await component.ngOnInit()

    component.setPendingTable(roomId(component, 1), 'T1')
    await component.addTables(roomId(component, 1))

    expect(component.rooms()[1].tables).toHaveLength(0)
    expect(component.error()).toBe('LOCATION.TABLES_DUPLICATE')
    expect(api.patch).not.toHaveBeenCalled()
  })

  // Bestandsdaten aus der Cloud koennten Duplikate enthalten — die Seite waere
  // sonst unbenutzbar.
  it('markiert vorhandene Duplikate nur, ohne das Speichern zu blockieren', async () => {
    const { component, api } = setup({
      settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [{ id: 'a', label: 'T1' }] }, { name: 'Terrasse', tables: [{ id: 'b', label: 'T1' }] }] } },
    })
    await component.ngOnInit()

    expect(component.isDuplicate('T1')).toBe(true)
    await component.toggleEnabled()

    expect(api.patch).toHaveBeenCalledTimes(1)
  })

  it('weist zu lange Bezeichnungen ab', async () => {
    const { component } = setup({ settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } } })
    await component.ngOnInit()

    component.setPendingTable(roomId(component, 0), 'x'.repeat(61))
    await component.addTables(roomId(component, 0))

    expect(component.error()).toBe('LOCATION.TABLES_LABEL_TOO_LONG')
    expect(component.rooms()[0].tables).toHaveLength(0)
  })
})

describe('TableSettingsComponent — Cloud-Verwaltung', () => {
  it('blockt jede Mutation, bevor der State sich aendert', async () => {
    const { component, api } = setup({
      cloudPaired: true,
      settings: { tableSettings: { enabled: true, rooms: [{ name: 'Innen', tables: [] }] } },
    })
    await component.ngOnInit()

    component.addRoom()
    await component.toggleEnabled()
    component.setPendingTable(roomId(component, 0), 'T5')
    await component.addTables(roomId(component, 0))

    expect(component.rooms()).toHaveLength(1)
    expect(component.enabled()).toBe(true)
    expect(api.patch).not.toHaveBeenCalled()
  })
})
