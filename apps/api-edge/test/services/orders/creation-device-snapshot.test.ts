// Geraet und Geraetename als Snapshot im Erfassungskontext (panary/panary-core#1303).
//
// Ueber die echte Hook-Kette mit Geraete-Verbindung und gegen die migrierte
// Edge-SQLite: `creationContext` ist eine JSON-Textspalte, gelesen wird jeweils
// nach, nicht das Create-Ergebnis geprueft. Kern des Issues: Geraet und Name
// kommen ausschliesslich aus der Session — ein Body-Wert bleibt wirkungslos.
//
// Die Filiale steht auf `orders-only`, weil der Split nur im Bestellbetrieb
// erlaubt ist; die Settings braucht der Vorbestell-Hook beim Anlegen.
//
// Jeder Test legt seine Zeilen selbst an und raeumt sie ab (testing.md §10.2).
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'

import type { Order } from '@panary/orders/domain'

import { app } from '../../../src/app'

describe('orders — Geraet und Geraetename im Erfassungskontext (#1303)', () => {
  const tenantId = uuidv7()
  const internal = { provider: undefined } as const

  let locationId: string
  let userId: string

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

  /** Ein Geraet mit Namen; `deviceId` vergibt der Server, sie ist nie die `_id`. */
  const createDevice = async (name: string) => {
    const device = (await app
      .service('devices')
      .create({ name, type: 'pos-counter', tenantId, locationId } as never, internal)) as {
      _id: string
      deviceId: string
    }
    onTestFinished(async () => {
      await app
        .service('devices')
        .remove(device._id, internal)
        .catch(() => undefined)
    })
    return device
  }

  const deviceParams = (deviceId: string) =>
    ({
      provider: 'socketio',
      connection: { apiKey: true, deviceId, deviceRole: 'device:pos-client', tenantId, locationId },
    }) as never

  const userParams = () => ({ ...internal, user: { _id: userId, tenantId, locationId } }) as never

  const lineItem = (price: number) => ({
    _id: uuidv7(),
    externalId: uuidv7(),
    productGroupExternalId: uuidv7(),
    name: 'Geraete-Testprodukt',
    amount: 1,
    price,
    modifiers: [],
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 19,
    taxOutside: 7,
    topic: 'kitchen',
    bundleNumber: null,
  })

  const orderBody = (creationContext: Record<string, unknown>, lineItems: unknown[] = []) => ({
    tenantId,
    locationId,
    status: 'active',
    orderChannel: 'pos',
    dineLocation: 'dine-in',
    lineItems,
    isFinished: false,
    estimatedDuration: 0,
    remainingTime: 0,
    recordingDate: new Date().toISOString(),
    creationContext,
  })

  const removeAfterTest = (id: string) => {
    onTestFinished(async () => {
      await app
        .service('orders')
        .remove(id, internal)
        .catch(() => undefined)
    })
  }

  const createOrder = async (body: unknown, params: never) => {
    const created = (await app.service('orders').create(body as never, params)) as Order
    removeAfterTest(created._id)
    return created
  }

  /** Nachlesen aus der SQLite — nicht das Create-Ergebnis, das der Resolver gebaut hat. */
  const storedContext = async (orderId: string) =>
    ((await app.service('orders').get(orderId, internal)) as Order).creationContext

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Testfiliale Geraetename',
        tenantId,
        operationMode: 'orders-only',
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
        settings: minimalSettings,
      } as never,
      internal,
    )) as { _id: string }
    locationId = location._id

    userId = (
      (await app.service('users').create(
        {
          firstName: 'Geraet',
          lastName: 'Tester',
          role: 'tenant:staff',
          tenantId,
          activeLocationId: locationId,
        } as never,
        internal,
      )) as { _id: string }
    )._id
  })

  afterAll(async () => {
    if (locationId) {
      const days = (await app.service('businessdays').find({
        ...internal,
        paginate: false,
        query: { locationId },
      })) as Array<{ _id: string }>
      for (const day of days) {
        await app.service('businessdays').remove(day._id, { ...internal, isEmergencyOverride: true } as never)
      }
      await app.service('locations').remove(locationId, internal)
    }
    if (userId) await app.service('users').remove(userId, internal)
    await app.teardown()
  })

  describe('orders.create', () => {
    it('Geraete-Session: Geraete-ID der Session und Name des Geraets, gespeichert und nachgelesen', async () => {
      const device = await createDevice('Kasse 1303')
      expect(device._id).not.toBe(device.deviceId)

      const created = await createOrder(orderBody({ createdBy: userId }), deviceParams(device.deviceId))

      expect(await storedContext(created._id)).toEqual({
        createdBy: userId,
        createdVia: device.deviceId,
        createdViaName: 'Kasse 1303',
      })
    })

    it('Geraete-Session: createdVia und createdViaName aus dem Body bleiben wirkungslos', async () => {
      const device = await createDevice('Kasse echt')

      const created = await createOrder(
        orderBody({ createdBy: userId, createdVia: uuidv7(), createdViaName: 'Kasse gefaelscht' }),
        deviceParams(device.deviceId),
      )

      const stored = await storedContext(created._id)
      expect(stored?.createdVia).toBe(device.deviceId)
      expect(stored?.createdViaName).toBe('Kasse echt')
    })

    it('ohne Geraete-Session: kein Name, auch wenn der Body einen mitschickt', async () => {
      const bodyDeviceId = uuidv7()

      const created = await createOrder(
        orderBody({ createdBy: userId, createdVia: bodyDeviceId, createdViaName: 'Kasse gefaelscht' }),
        userParams(),
      )

      expect(await storedContext(created._id)).toEqual({ createdBy: userId, createdVia: bodyDeviceId })
    })

    it('unbekanntes Geraet: Geraete-ID gestempelt, Name fehlt, die Order entsteht trotzdem', async () => {
      const unknownDeviceId = uuidv7()

      const created = await createOrder(orderBody({ createdBy: userId }), deviceParams(unknownDeviceId))

      expect(await storedContext(created._id)).toEqual({ createdBy: userId, createdVia: unknownDeviceId })
    })

    it('Lookup-Fehler: Name fehlt, die Order entsteht trotzdem', async () => {
      const device = await createDevice('Kasse Lookup')
      const spy = vi.spyOn(app.service('devices'), 'find').mockRejectedValueOnce(new Error('Lookup kaputt'))
      onTestFinished(() => spy.mockRestore())

      const created = await createOrder(orderBody({ createdBy: userId }), deviceParams(device.deviceId))

      expect(spy).toHaveBeenCalled()
      expect(await storedContext(created._id)).toEqual({ createdBy: userId, createdVia: device.deviceId })
    })

    it('Pull-Apply (fromSync): der Datensatz der Cloud gilt unveraendert', async () => {
      const cloudDeviceId = uuidv7()

      const created = await createOrder(
        orderBody({ createdBy: userId, createdVia: cloudDeviceId, createdViaName: 'Kasse andere Edge' }),
        { ...internal, fromSync: true, user: { _id: userId, tenantId, locationId } } as never,
      )

      expect(await storedContext(created._id)).toEqual({
        createdBy: userId,
        createdVia: cloudDeviceId,
        createdViaName: 'Kasse andere Edge',
      })
    })
  })

  describe('orders.patch', () => {
    it('ein Patch auf creationContext bleibt still wirkungslos — auch intern', async () => {
      const device = await createDevice('Kasse vorher')
      const created = await createOrder(orderBody({ createdBy: userId }), deviceParams(device.deviceId))

      await app
        .service('orders')
        .patch(
          created._id,
          { creationContext: { createdBy: userId, createdVia: uuidv7(), createdViaName: 'Kasse nachher' } } as never,
          internal,
        )

      expect(await storedContext(created._id)).toEqual({
        createdBy: userId,
        createdVia: device.deviceId,
        createdViaName: 'Kasse vorher',
      })
    })
  })

  describe('abgeleitete Orders', () => {
    it('Split: der Teilbeleg erbt Geraet und Namen der Quelle, nicht die teilende Kasse', async () => {
      const origin = await createDevice('Kasse Ursprung')
      const splitter = await createDevice('Kasse teilt')
      const moved = lineItem(10)
      const source = await createOrder(
        orderBody({ createdBy: userId }, [lineItem(20), moved]),
        deviceParams(origin.deviceId),
      )

      const result = (await (app.service('orders') as any).split(
        { orderId: source._id, lineItems: [{ lineItemRowId: moved._id }] },
        deviceParams(splitter.deviceId),
      )) as { targetOrder: Order }
      removeAfterTest(result.targetOrder._id)

      const stored = await storedContext(result.targetOrder._id)
      expect(stored?.createdVia).toBe(origin.deviceId)
      expect(stored?.createdViaName).toBe('Kasse Ursprung')
    })

    it('Split einer Quelle ohne Geraet: der Teilbeleg bleibt ohne, statt die teilende Kasse zu erben', async () => {
      const splitter = await createDevice('Kasse teilt')
      const moved = lineItem(10)
      const source = await createOrder(orderBody({ createdBy: userId }, [lineItem(20), moved]), userParams())

      const result = (await (app.service('orders') as any).split(
        { orderId: source._id, lineItems: [{ lineItemRowId: moved._id }] },
        deviceParams(splitter.deviceId),
      )) as { targetOrder: Order }
      removeAfterTest(result.targetOrder._id)

      const stored = await storedContext(result.targetOrder._id)
      expect(stored?.createdVia).toBeUndefined()
      expect(stored?.createdViaName).toBeUndefined()
    })

    it('Vorbestellung: die konvertierte Order traegt die Kasse, die konvertiert', async () => {
      const device = await createDevice('Kasse Vorbestellung')
      const preOrder = (await app.service('pre-orders').create(
        {
          tenantId,
          locationId,
          scheduledFor: new Date(Date.now() + 60 * 60_000).toISOString(),
          status: 'pending',
          customerContact: { name: 'Testkunde 1303', phone: '0123456789' },
          lineItems: [],
        } as never,
        internal,
      )) as { _id: string }
      onTestFinished(async () => {
        await app
          .service('pre-orders')
          .remove(preOrder._id, internal)
          .catch(() => undefined)
      })

      const order = (await (
        app.service('pre-orders') as never as { convert: (id: string, p: unknown) => Promise<{ _id: string }> }
      ).convert(preOrder._id, deviceParams(device.deviceId))) as { _id: string }
      removeAfterTest(order._id)

      const stored = await storedContext(order._id)
      expect(stored?.createdVia).toBe(device.deviceId)
      expect(stored?.createdViaName).toBe('Kasse Vorbestellung')
    })
  })
})
