import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'

import { app } from '../../../src/app'

/**
 * Statusübergänge beim EXTERNEN `patch` einer Vorbestellung (panary/panary-core#1532,
 * Parität zu panary/panary-cloud#2289).
 *
 * **Warum gegen die echte SQLite und die volle Hook-Kette:** Der Guard hängt an `params.provider`,
 * am von `multiTenancy` gescopten `params.query` und an der Reihenfolge nach `validateData`/`resolveData`.
 * Eine Unit-Spec auf die Funktion sähe davon nichts. Geprüft wird der **Zustand der Datenbank**, nicht
 * nur der Statuscode: Ein abgewiesener Patch darf nichts geschrieben haben.
 *
 * Messung vor dem Fix: `cancelled → pending`, `cancelled → cancelled`, `pending → converted` und
 * `convertedOrderId` ohne Order wurden mit 200 angenommen.
 */
describe('pre-orders patch — Statusübergänge extern (#1532)', () => {
  const TENANT = uuidv7()
  const LOCATION = uuidv7()
  const OTHER_TENANT = uuidv7()
  const OTHER_LOCATION = uuidv7()

  const internal = { provider: undefined } as const

  const minimalSettings = {
    generalSettings: {
      systemOfUnits: 'metric',
      defaultWeightUnit: 'kg',
      defaultVolumeUnit: 'L',
      timezone: 'Europe/Berlin',
    },
    printSettings: {
      maxNameCharacters: 30,
      mqttServerProtocol: 'ws',
      mqttServerUrl: 'localhost',
      mqttServerPort: 1883,
      printerSequence: [],
      printers: [],
      separationCharacter: '-',
      separationCharacterCount: 40,
      showDialogAfterOrder: false,
    },
    serverSettings: { path: '/ws', timeout: 5000, reconnection: true, autoConnect: true },
    discountSettings: { enabled: false, discounts: [] },
    pagerSettings: { enabled: false, pagers: [] },
    tableSettings: { enabled: false, rooms: [] },
    genericUserSettings: { autoLogOffTime: 30, autoLogOffTimeUnit: 'minutes' },
    genericProductSettings: { generalSideDishPrice: 0, generalDrinkPrice: 0 },
    taxSettings: { A: { taxRate: 19, name: 'Normal' } },
    openingHoursSettings: {
      enabled: true,
      regular: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '00:00', close: '23:59', closed: false })),
    },
  }

  let staffUser: Record<string, unknown>

  const asStaff = () => ({ provider: 'rest', authenticated: true, user: staffUser })

  const anlegenFiliale = (id: string, tenantId: string, name: string) =>
    app.service('locations').create(
      {
        _id: id,
        tenantId,
        name,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
        settings: minimalSettings,
      } as never,
      internal,
    )

  const anlegen = async (status: string, tenantId = TENANT, locationId = LOCATION) => {
    const created = (await app.service('pre-orders').create(
      {
        tenantId,
        locationId,
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        status,
        customerContact: { name: 'Kunde 1532', phone: '0123456789' },
        lineItems: [],
      } as never,
      internal,
    )) as { _id: string }

    onTestFinished(async () => {
      try {
        await app.service('pre-orders').remove(created._id, internal)
      } catch {
        // bereits entfernt
      }
    })
    return created
  }

  const status = async (id: string) =>
    (await app.service('pre-orders').get(id, internal)) as { status: string; convertedOrderId?: string | null }

  const patchExtern = (id: string | null, data: Record<string, unknown>) =>
    app.service('pre-orders').patch(id as never, data as never, asStaff() as never)

  beforeAll(async () => {
    await app.setup()
    await anlegenFiliale(LOCATION, TENANT, 'Filiale 1532')
    await anlegenFiliale(OTHER_LOCATION, OTHER_TENANT, 'Fremde Filiale 1532')

    staffUser = (await app.service('users').create(
      {
        firstName: 'Status',
        lastName: 'Staff',
        role: 'tenant:staff',
        tenantId: TENANT,
        activeLocationId: LOCATION,
      } as never,
      internal,
    )) as Record<string, unknown>
  })

  afterAll(async () => {
    try {
      await app.service('users').remove(staffUser?.['_id'] as string, internal)
    } catch {
      // bereits entfernt
    }
    for (const id of [LOCATION, OTHER_LOCATION]) {
      try {
        await app.service('locations').remove(id, internal)
      } catch {
        // bereits entfernt
      }
    }
  })

  it('erlaubt pending → cancelled', async () => {
    const po = await anlegen('pending')
    await patchExtern(po._id, { status: 'cancelled' })
    expect((await status(po._id)).status).toBe('cancelled')
  })

  it('erlaubt einen Patch ohne Statuswechsel (pending → pending und ohne status)', async () => {
    const po = await anlegen('pending')
    await patchExtern(po._id, { status: 'pending' })
    await patchExtern(po._id, { note: 'Bitte ohne Zwiebeln' })
    expect((await status(po._id)).status).toBe('pending')
  })

  it.each(['pending', 'cancelled', 'converted'])('weist cancelled → %s mit 400 ab', async next => {
    const po = await anlegen('cancelled')
    await expect(patchExtern(po._id, { status: next })).rejects.toMatchObject({ code: 400 })
    expect((await status(po._id)).status).toBe('cancelled')
  })

  it.each(['pending', 'cancelled', 'converted'])('weist converted → %s mit 400 ab', async next => {
    const po = await anlegen('converted')
    await expect(patchExtern(po._id, { status: next })).rejects.toMatchObject({ code: 400 })
    expect((await status(po._id)).status).toBe('converted')
  })

  it('weist externes status: converted ab, auch von pending aus', async () => {
    const po = await anlegen('pending')
    await expect(patchExtern(po._id, { status: 'converted' })).rejects.toMatchObject({ code: 400 })
    expect((await status(po._id)).status).toBe('pending')
  })

  it('weist externes convertedOrderId ab, auch ohne Statuswechsel', async () => {
    const po = await anlegen('pending')
    await expect(patchExtern(po._id, { convertedOrderId: uuidv7() })).rejects.toMatchObject({ code: 400 })
    expect((await status(po._id)).convertedOrderId ?? null).toBeNull()
  })

  it('weist einen Bulk-Patch mit status ab', async () => {
    await expect(patchExtern(null, { status: 'cancelled' })).rejects.toMatchObject({ code: 400 })
  })

  it('antwortet für eine fremde Vorbestellung wie für eine fehlende (404), ohne den Status zu verraten', async () => {
    const fremd = await anlegen('cancelled', OTHER_TENANT, OTHER_LOCATION)
    await expect(patchExtern(fremd._id, { status: 'pending' })).rejects.toMatchObject({ code: 404 })
    expect((await status(fremd._id)).status).toBe('cancelled')
  })

  it('lässt interne Patches durch (convert, Sync-Apply)', async () => {
    const po = await anlegen('cancelled')
    await app
      .service('pre-orders')
      .patch(po._id, { status: 'pending' } as never, { ...internal, fromSync: true } as never)
    expect((await status(po._id)).status).toBe('pending')

    await app
      .service('pre-orders')
      .patch(po._id, { status: 'converted', convertedOrderId: uuidv7() } as never, internal)
    expect((await status(po._id)).status).toBe('converted')
  })
})
