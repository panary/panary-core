// Vorabfrage des POS vor dem Verkauf (panary/panary-core#1133): Fehlt heute eine
// Ruhetag-Freigabe? Ueber die echte Hook-Kette mit Geraete-Verbindung.
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateDefaultLocationSettings } from '@panary/locations/domain'

import { app } from '../../../src/app'

describe('businessdays.getClosedDayStatus — Vorabfrage des POS', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const
  let locationId: string

  const status = () =>
    (
      app.service('businessdays') as unknown as {
        getClosedDayStatus: (data: unknown, params: unknown) => Promise<{ approvalRequired: boolean; state: string }>
      }
    ).getClosedDayStatus(
      {},
      {
        provider: 'socketio',
        connection: { apiKey: true, deviceId: uuidv7(), deviceRole: 'device:pos-client', tenantId, locationId },
      },
    )

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Vorabfrage',
        tenantId,
        address: { street: 'Teststr. 2', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id
  })

  afterAll(async () => {
    if (locationId) await app.service('locations').remove(locationId, internal)
    await app.teardown()
  })

  it('verlangt ohne aktive Öffnungszeiten keine Freigabe', async () => {
    expect(await status()).toMatchObject({ approvalRequired: false })
  })

  it('verlangt am Ruhetag ohne Tag eine Freigabe', async () => {
    await app.service('locations').patch(
      locationId,
      {
        settings: {
          ...generateDefaultLocationSettings,
          openingHoursSettings: {
            enabled: true,
            regular: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '22:00', closed: true })),
          },
        },
      } as never,
      internal,
    )
    expect(await status()).toMatchObject({ approvalRequired: true, state: 'closed' })
  })
})
