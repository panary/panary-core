import assert from 'assert'
import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'

import { app } from '../../../src/app'

/**
 * Die Abholzeit überlebt die Konvertierung (panary/panary-core#344) — gegen die
 * echte Test-SQLite und die volle Hook-Kette des `orders`-Service.
 *
 * **Warum zusätzlich zur Unit-Spec:** `scheduled-lead-time.spec.ts` prüft die
 * Rechnung. Sie sagt nichts darüber, ob `convert()` sie auch **benutzt** — und
 * genau das war der Fehler: Die Rechnung gab es nie, `convert()` schrieb fest
 * `estimatedDuration: 0`. Ein Test auf die reine Funktion wäre grün geblieben,
 * während der Bon weiter `SOFORT` druckt.
 *
 * Gemessen wird deshalb am Ergebnis der Konvertierung, nicht am Zwischenschritt:
 * Was steht an der erzeugten Order?
 *
 * Jeder Test räumt per `onTestFinished` ab (Code-Style §10); die Suite teilt ihre
 * SQLite mit allen anderen, IDs sind deshalb je Lauf neu.
 */
describe('pre-orders convert() — Abholzeit als Vorlaufzeit (#344)', () => {
  const TENANT = uuidv7()
  const LOCATION = uuidv7()
  let userId = ''

  const internal = { provider: undefined } as const

  // Minimum, das `validateData` passieren lässt — fachlich zählen hier nur
  // `openingHoursSettings` (der Vorbestell-Hook prüft sie beim Anlegen) und
  // `generalSettings.timezone`.
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

  /** Eine Vorbestellung zur gewünschten Abholzeit, die sich selbst wieder abräumt. */
  const createPreOrder = async (scheduledFor: string) => {
    const created = (await app.service('pre-orders').create(
      {
        tenantId: TENANT,
        locationId: LOCATION,
        scheduledFor,
        status: 'pending',
        customerContact: { name: 'Testkunde 344', phone: '0123456789' },
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

  /** Konvertiert und räumt die erzeugte Order wieder ab. */
  const convert = async (preOrderId: string) => {
    const order = (await (
      app.service('pre-orders') as never as { convert: (id: string, p: unknown) => Promise<unknown> }
    ).convert(preOrderId, {
      provider: 'rest',
      authenticated: true,
      user: { _id: userId, role: 'tenant:staff', tenantId: TENANT, locationId: LOCATION, activeLocationId: LOCATION },
    })) as { _id: string; estimatedDuration: number; remainingTime: number; recordingDate: string }

    onTestFinished(async () => {
      try {
        await app.service('orders').remove(order._id, internal)
      } catch {
        // bereits entfernt
      }
    })
    return order
  }

  /** Was der Bon aus der Order rechnet: `recordingDate + estimatedDuration`, als HH:mm in UTC. */
  const gedruckteAbholzeit = (order: { recordingDate: string; estimatedDuration: number }): string =>
    new Date(new Date(order.recordingDate).getTime() + order.estimatedDuration * 60_000).toISOString().slice(11, 16)

  beforeAll(async () => {
    await app.setup()

    await app.service('locations').create(
      {
        _id: LOCATION,
        tenantId: TENANT,
        name: 'Filiale 344',
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
        settings: minimalSettings,
      } as never,
      internal,
    )

    const user = (await app.service('users').create(
      {
        firstName: 'Vor',
        lastName: 'Besteller',
        role: 'tenant:staff',
        tenantId: TENANT,
        activeLocationId: LOCATION,
      } as never,
      internal,
    )) as { _id: string }
    userId = user._id
  })

  afterAll(async () => {
    const days = (await app.service('businessdays').find({
      ...internal,
      paginate: false,
      query: { locationId: LOCATION },
    })) as Array<{ _id: string }>
    for (const day of days) {
      await app.service('businessdays').remove(day._id, { ...internal, isEmergencyOverride: true } as never)
    }
    if (userId) await app.service('users').remove(userId, internal)
    try {
      await app.service('locations').remove(LOCATION, internal)
    } catch {
      // bereits entfernt
    }
    await app.teardown()
  })

  it('traegt eine Abholzeit in der Zukunft als Vorlaufzeit an die Order', async () => {
    const scheduledFor = new Date(Date.now() + 120 * 60_000).toISOString()
    const preOrder = await createPreOrder(scheduledFor)

    const order = await convert(preOrder._id)

    // Rund zwei Stunden — die exakte Minute haengt am Sekundenstand der Konvertierung.
    assert.ok(
      order.estimatedDuration >= 119 && order.estimatedDuration <= 120,
      `erwartet 119–120 Minuten, war ${order.estimatedDuration}`,
    )
    // Die Aussage, auf die es ankommt: Der Bon trifft die vereinbarte Minute.
    assert.strictEqual(gedruckteAbholzeit(order), scheduledFor.slice(11, 16))
  })

  it('bleibt bei einer Konvertierung kurz vor der Abholzeit bei derselben Uhrzeit', async () => {
    const scheduledFor = new Date(Date.now() + 5 * 60_000).toISOString()
    const preOrder = await createPreOrder(scheduledFor)

    const order = await convert(preOrder._id)

    assert.ok(order.estimatedDuration >= 4 && order.estimatedDuration <= 5, `war ${order.estimatedDuration}`)
    assert.strictEqual(gedruckteAbholzeit(order), scheduledFor.slice(11, 16))
  })

  it('bucht eine bereits verstrichene Abholzeit als 0 — SOFORT statt negativer Zeit', async () => {
    const preOrder = await createPreOrder(new Date(Date.now() - 90 * 60_000).toISOString())

    const order = await convert(preOrder._id)

    assert.strictEqual(order.estimatedDuration, 0)
    assert.ok(order.estimatedDuration >= 0, 'niemals negativ')
  })

  it('setzt remainingTime auf denselben Wert wie estimatedDuration', async () => {
    const preOrder = await createPreOrder(new Date(Date.now() + 45 * 60_000).toISOString())

    const order = await convert(preOrder._id)

    assert.strictEqual(order.remainingTime, order.estimatedDuration)
  })
})
