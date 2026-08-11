// Der Fiskal-Snapshot eines Geschaeftstags leitet sich serverseitig aus der
// Location ab und ist NICHT aus der Anfrage bestimmbar (panary/panary-core#157,
// Gegenstueck zu panary/panary-cloud#146).
//
// Warum das ein eigener Test ist: `create` steht in `businessDaysMethods`, und
// `operationMode` steht im DATA-Schema. Vor diesem Fix bestimmte der Aufrufer
// selbst, ob sein Geschaeftstag TSE-signiert wird — die Snapshot-Logik sass
// ausschliesslich in `openDay` und war damit umgehbar. Der Test prueft den
// Resolver, nicht `openDay`: genau der Pfad, der vorher offen war.
//
// Bewusst DER Resolver aus dem Service, nicht eine nachgebaute Kopie — sonst
// prueft der Test seine eigene Nachbildung.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Nur den Logger ersetzen — das Modul liefert ausserdem dataValidator/
// queryValidator/resolveUserLocationId, die business-days.schema.ts beim Import
// braucht.
vi.mock('@panary/shared-backend', async importOriginal => ({
  ...(await importOriginal<typeof import('@panary/shared-backend')>()),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { businessDayDataResolver } from './business-days.schema'
import { syncAwareResolveCreate } from './business-days'

import type { HookContext } from '../../declarations'

const locationGetMock = vi.fn()

const buildContext = (over: { fromSync?: boolean; user?: Record<string, unknown> } = {}) =>
  ({
    method: 'create',
    path: 'businessdays',
    params: {
      provider: over.fromSync ? undefined : 'rest',
      ...(over.fromSync ? { fromSync: true } : {}),
      user: over.user,
    },
    app: {
      service: (name: string) => {
        if (name === 'locations') return { get: locationGetMock }
        return {}
      },
    },
  }) as never

/** Laesst den echten DataResolver ueber die Payload laufen und gibt das Ergebnis. */
const resolveData = async (data: Record<string, unknown>, context = buildContext()) =>
  (await businessDayDataResolver.resolve(data as never, context)) as unknown as {
    operationMode?: string
  }

describe('businessDayDataResolver: operationMode', () => {
  beforeEach(() => {
    locationGetMock.mockReset()
  })

  it('Location orders-only → Geschaeftstag orders-only (Payload leer)', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-1', operationMode: 'orders-only' })
    const out = await resolveData({ tenantId: 't1', locationId: 'loc-1', date: '2026-08-11' })
    expect(out.operationMode).toBe('orders-only')
  })

  it('Location pos-cashier → Geschaeftstag pos-cashier (Payload leer)', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-1', operationMode: 'pos-cashier' })
    const out = await resolveData({ tenantId: 't1', locationId: 'loc-1', date: '2026-08-11' })
    expect(out.operationMode).toBe('pos-cashier')
  })

  // Der eigentliche Punkt des Tickets: Der Wunsch des Aufrufers wird VERWORFEN,
  // nicht als Default behandelt. Ohne diese Zusicherung fiskalisiert sich ein
  // Geschaeftstag per `create`-Aufruf selbst weg — ein Kassen-Token genuegt
  // (`DEVICE_POS` hat MANAGE auf BUSINESS_DAYS).
  it('Payload pos-cashier gegen Location orders-only → Location gewinnt', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-1', operationMode: 'orders-only' })
    const out = await resolveData({
      tenantId: 't1',
      locationId: 'loc-1',
      date: '2026-08-11',
      operationMode: 'pos-cashier',
    })
    expect(out.operationMode).toBe('orders-only')
  })

  it('Payload orders-only gegen Location pos-cashier → Location gewinnt (kein Fiskal-Opt-out)', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-1', operationMode: 'pos-cashier' })
    const out = await resolveData({
      tenantId: 't1',
      locationId: 'loc-1',
      date: '2026-08-11',
      operationMode: 'orders-only',
    })
    expect(out.operationMode).toBe('pos-cashier')
  })

  it('Location ohne operationMode → pos-cashier (fail-safe Richtung Signieren)', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-1' })
    const out = await resolveData({ tenantId: 't1', locationId: 'loc-1', date: '2026-08-11' })
    expect(out.operationMode).toBe('pos-cashier')
  })

  // Standalone-Edge im Bootstrap: Die Location kann zum Zeitpunkt des ersten
  // Geschaeftstags fehlen. Dann signieren statt abbrechen — zu viel
  // Fiskalisierung ist ein Aufwands-, zu wenig ein Rechtsproblem.
  it('Location nicht ladbar → pos-cashier statt Abbruch', async () => {
    locationGetMock.mockRejectedValue(new Error('sqlite locked'))
    const out = await resolveData({ tenantId: 't1', locationId: 'loc-1', date: '2026-08-11' })
    expect(out.operationMode).toBe('pos-cashier')
  })

  it('ohne locationId → pos-cashier, kein Location-Lookup', async () => {
    const out = await resolveData({ tenantId: 't1', locationId: null, date: '2026-08-11' })
    expect(out.operationMode).toBe('pos-cashier')
    expect(locationGetMock).not.toHaveBeenCalled()
  })

  it('locationId fehlt in der Payload → faellt auf die Location des Users zurueck', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-user', operationMode: 'orders-only' })
    const out = await resolveData(
      { tenantId: 't1', date: '2026-08-11' },
      buildContext({ user: { locationId: 'loc-user' } }),
    )
    expect(out.operationMode).toBe('orders-only')
    expect(locationGetMock).toHaveBeenCalledWith('loc-user', { provider: undefined })
  })

  // Edge-spezifisch: JWT-User aus dem Admin-Panel tragen die Filiale in
  // `activeLocationId`, nicht in `locationId` — ein direkter Zugriff auf
  // `user.locationId` lief hier immer ins `null`. Deshalb `resolveUserLocationId`,
  // dieselbe Quelle wie in `openDay`.
  it('User mit activeLocationId statt locationId → Location wird trotzdem gelesen', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-aktiv', operationMode: 'orders-only' })
    const out = await resolveData(
      { tenantId: 't1', date: '2026-08-11' },
      buildContext({ user: { activeLocationId: 'loc-aktiv' } }),
    )
    expect(out.operationMode).toBe('orders-only')
    expect(locationGetMock).toHaveBeenCalledWith('loc-aktiv', { provider: undefined })
  })
})

// Die `fromSync`-Ausnahme sitzt auf dem Edge NICHT im Resolver, sondern eine
// Ebene darueber: `syncAwareResolveCreate` ueberspringt bei Sync-Applies den
// gesamten Create-Resolver, weil dort der volle Lifecycle-Record der Cloud
// ankommt (auch geschlossene Tage). Der Kommentar im Schema verweist auf diese
// Weiche — hier wird die Behauptung geprueft statt nur behauptet.
describe('syncAwareResolveCreate: Sync-Applies umgehen den Create-Resolver', () => {
  beforeEach(() => {
    locationGetMock.mockReset()
  })

  // Wuerde der Edge den Snapshot lokal ueberschreiben, schriebe er Historie um:
  // Ein um 06:00 als pos-cashier eroeffneter Tag wuerde still orders-only, wenn
  // die Betriebsart um 10:00 wechselt und der Record danach zurueckgespiegelt wird.
  it('fromSync → operationMode der Cloud bleibt unveraendert, kein Location-Lookup', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-1', operationMode: 'orders-only' })
    const context = buildContext({ fromSync: true }) as unknown as HookContext
    context.data = { tenantId: 't1', locationId: 'loc-1', date: '2026-08-11', operationMode: 'pos-cashier' }

    await syncAwareResolveCreate(context)

    expect((context.data as { operationMode?: string }).operationMode).toBe('pos-cashier')
    expect(locationGetMock).not.toHaveBeenCalled()
  })

  it('ohne fromSync → Resolver laeuft, Location gewinnt gegen die Payload', async () => {
    locationGetMock.mockResolvedValue({ _id: 'loc-1', operationMode: 'orders-only' })
    const context = buildContext() as unknown as HookContext
    context.data = { tenantId: 't1', locationId: 'loc-1', date: '2026-08-11', operationMode: 'pos-cashier' }

    await syncAwareResolveCreate(context)

    expect((context.data as { operationMode?: string }).operationMode).toBe('orders-only')
  })
})
