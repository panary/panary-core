import { onTestFinished } from 'vitest'
import { uuidv7 } from 'uuidv7'

import { app } from '../../../src/app'

/**
 * `convert()` und die Mandantengrenze (panary/panary-core#357).
 *
 * **Warum gegen die echte SQLite und die volle Hook-Kette:** Der Defekt entsteht
 * genau im Zusammenspiel — `convert` ist eine Custom Method, `multiTenancy`
 * schaltet nur auf `create/update/patch` bzw. `find/get/remove/update/patch` und
 * ist hier ein No-Op, und der innere `get` laeuft mit `{ provider: undefined }`.
 * Eine Unit-Spec auf die Funktion saehe davon nichts.
 *
 * Geprueft wird der **Zustand der Datenbank**, nicht der Statuscode: Ein Test,
 * der nur auf 403 sieht, uebersaehe einen Write, der vor dem Wurf passiert ist —
 * und vor dem Fix antwortete der Aufruf ohnehin mit 200.
 *
 * Messung vor dem Fix (2026-09-22): fremde ID → HTTP 200, eine Order mit den
 * FREMDEN `lineItems`, gestempelt auf den EIGENEN Mandanten (also lesbar), mit
 * der FREMDEN `locationId`, und die fremde Vorbestellung auf `converted`.
 */
describe('pre-orders convert() — Mandantengrenze (#357)', () => {
  const TENANT_A = uuidv7()
  const LOCATION_A = uuidv7()
  const TENANT_B = uuidv7()
  const LOCATION_B = uuidv7()
  let userA = ''

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

  const anlegenFiliale = async (id: string, tenantId: string, name: string) =>
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

  /** Vorbestellung in einem beliebigen Mandanten — raeumt sich selbst ab. */
  const anlegenVorbestellung = async (tenantId: string, locationId: string) => {
    const created = (await app.service('pre-orders').create(
      {
        tenantId,
        locationId,
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        status: 'pending',
        customerContact: { name: 'Fremdkunde 357', phone: '0123456789' },
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

  const alsBenutzerA = {
    provider: 'rest',
    authenticated: true,
    user: {
      _id: '',
      role: 'tenant:staff',
      tenantId: TENANT_A,
      locationId: LOCATION_A,
      activeLocationId: LOCATION_A,
    },
  }

  const convert = (preOrderId: string, params: unknown) =>
    (app.service('pre-orders') as never as { convert: (id: string, p: unknown) => Promise<{ _id: string }> }).convert(
      preOrderId,
      params,
    )

  /**
   * Wie viele Orders verweisen auf diese Vorbestellung? Ueber ALLE Mandanten.
   *
   * Gefiltert wird in JS, nicht per Query: `preOrderId` steht nicht in der
   * Query-Whitelist des orders-Service, ein `query: { preOrderId }` scheitert
   * an `validateQuery` — und zwar mit „validation failed", was wie ein Defekt
   * der Produktionslogik aussieht statt wie ein Fehler der Messung.
   */
  const ordersZurVorbestellung = async (preOrderId: string) => {
    const alle = (await app.service('orders').find({ ...internal, paginate: false })) as Array<{
      _id: string
      tenantId: string
      locationId: string
      preOrderId?: string
    }>
    return alle.filter(o => o.preOrderId === preOrderId)
  }

  beforeAll(async () => {
    await app.setup()
    await anlegenFiliale(LOCATION_A, TENANT_A, 'Filiale A')
    await anlegenFiliale(LOCATION_B, TENANT_B, 'Filiale B')

    const user = (await app.service('users').create(
      {
        firstName: 'Anna',
        lastName: 'Mandant-A',
        role: 'tenant:staff',
        tenantId: TENANT_A,
        activeLocationId: LOCATION_A,
      } as never,
      internal,
    )) as { _id: string }
    userA = user._id
    alsBenutzerA.user._id = userA
  })

  it('weist eine fremde Vorbestellung mit 403 ab', async () => {
    const fremd = await anlegenVorbestellung(TENANT_B, LOCATION_B)

    await expect(convert(fremd._id, alsBenutzerA)).rejects.toMatchObject({
      code: 403,
      name: 'Forbidden',
    })
  })

  // 🚨 Der eigentliche Test. Ein reiner Statuscode-Test waere gruen geblieben,
  // waehrend die Order laengst in der Datenbank steht: Feathers rollt nichts
  // zurueck, und vor dem Fix antwortete der Aufruf ohnehin mit 200. Geprueft
  // wird deshalb der ZUSTAND, und zwar beide Writes einzeln.
  it('hinterlaesst dabei WEDER eine Order NOCH einen Patch an der Vorbestellung', async () => {
    const fremd = await anlegenVorbestellung(TENANT_B, LOCATION_B)

    await convert(fremd._id, alsBenutzerA).catch(() => undefined)

    const orders = await ordersZurVorbestellung(fremd._id)
    for (const o of orders) {
      onTestFinished(async () => {
        try {
          await app.service('orders').remove(o._id, internal)
        } catch {
          /* schon weg */
        }
      })
    }

    // Vor dem Fix: 1 Order, gestempelt auf TENANT_A (den Angreifer) mit
    // LOCATION_B (der fremden Filiale) — also fuer ihn lesbar.
    expect(orders, 'es darf keine Order entstanden sein').toHaveLength(0)

    const nachher = (await app.service('pre-orders').get(fremd._id, internal)) as {
      status: string
      convertedOrderId?: string | null
    }
    // Vor dem Fix: 'converted' — die fremde Vorbestellung war zerstoert.
    expect(nachher.status, 'die fremde Vorbestellung darf unberuehrt bleiben').toBe('pending')
    expect(nachher.convertedOrderId ?? null).toBeNull()
  })

  it('weist auch einen Aufrufer ohne Mandantenkontext ab', async () => {
    // Der Fall, den die bedingte Form (`if (actor.tenantId && …)`) still
    // durchliess — sie prueft genau dann nicht, wenn der Kontext fehlt.
    const eigen = await anlegenVorbestellung(TENANT_A, LOCATION_A)
    const ohneMandant = {
      provider: 'rest',
      authenticated: true,
      user: { _id: userA, role: 'tenant:staff' },
    }

    await expect(convert(eigen._id, ohneMandant)).rejects.toMatchObject({ code: 403 })

    const nachher = (await app.service('pre-orders').get(eigen._id, internal)) as { status: string }
    expect(nachher.status).toBe('pending')
  })

  it('Gegenprobe: die EIGENE Vorbestellung konvertiert weiterhin', async () => {
    const eigen = await anlegenVorbestellung(TENANT_A, LOCATION_A)

    const order = await convert(eigen._id, alsBenutzerA)
    onTestFinished(async () => {
      try {
        await app.service('orders').remove(order._id, internal)
      } catch {
        /* schon weg */
      }
    })

    expect(order._id).toBeTruthy()
    const nachher = (await app.service('pre-orders').get(eigen._id, internal)) as { status: string }
    expect(nachher.status).toBe('converted')
  })

  afterAll(async () => {
    for (const loc of [LOCATION_A, LOCATION_B]) {
      const days = (await app.service('businessdays').find({
        ...internal,
        paginate: false,
        query: { locationId: loc },
      })) as Array<{ _id: string }>
      for (const day of days) {
        try {
          await app.service('businessdays').remove(day._id, internal)
        } catch {
          /* egal */
        }
      }
      try {
        await app.service('locations').remove(loc, internal)
      } catch {
        /* egal */
      }
    }
    try {
      await app.service('users').remove(userA, internal)
    } catch {
      /* egal */
    }
  })
})
