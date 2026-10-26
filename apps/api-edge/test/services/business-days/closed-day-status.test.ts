// Vorabfrage des POS vor dem Verkauf (panary/panary-core#1133): Fehlt heute eine
// Ruhetag-Freigabe? Ueber die echte Hook-Kette mit Geraete-Verbindung. Jeder Fall
// legt seine eigene Filiale an (testing.md §10, Reihenfolge unter Shuffle).
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { generateDefaultLocationSettings } from '@panary/locations/domain'

import { app } from '../../../src/app'

describe('businessdays.getClosedDayStatus — Vorabfrage des POS', () => {
  const internal = { provider: undefined } as const

  const statusFor = async (settings?: unknown) => {
    const tenantId = uuidv7()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Vorabfrage',
        tenantId,
        address: { street: 'Teststr. 2', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    onTestFinished(() => app.service('locations').remove(location._id, internal))
    if (settings) await app.service('locations').patch(location._id, { settings } as never, internal)

    return (
      app.service('businessdays') as unknown as {
        getClosedDayStatus: (data: unknown, params: unknown) => Promise<{ approvalRequired: boolean; state: string }>
      }
    ).getClosedDayStatus(
      {},
      {
        provider: 'socketio',
        connection: {
          apiKey: true,
          deviceId: uuidv7(),
          deviceRole: 'device:pos-client',
          tenantId,
          locationId: location._id,
        },
      },
    )
  }

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    await app.teardown()
  })

  it('verlangt ohne aktive Öffnungszeiten keine Freigabe', async () => {
    expect(await statusFor()).toMatchObject({ approvalRequired: false })
  })

  it('verlangt am Ruhetag ohne Tag eine Freigabe', async () => {
    const settings = {
      ...generateDefaultLocationSettings,
      openingHoursSettings: {
        enabled: true,
        regular: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '22:00', closed: true })),
      },
    }
    expect(await statusFor(settings)).toMatchObject({ approvalRequired: true, state: 'closed' })
  })
})
