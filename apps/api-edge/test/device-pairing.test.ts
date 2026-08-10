// Pairing-Payload der Geraete-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
//
// Echte HTTP-Aufrufe gegen die beiden Koa-Routen, weil genau die Grenze
// zwischen oeffentlichem Body und Code-Record geprueft wird. Ein Unit-Test der
// Hilfsfunktionen koennte die tragende Aussage — „der Redeem-Body wird
// ignoriert" — gar nicht treffen: Sie folgt daraus, dass die Route den Body nur
// nach drei Feldern durchsucht, nicht aus einer Funktion.
import assert from 'assert'
import axios from 'axios'
import { uuidv7 } from 'uuidv7'
import { app } from '../src/app'

const port = app.get('port')
const appUrl = `http://${app.get('host')}:${port}`

interface RequestCodeResponse {
  code: string
  deviceAccessMode?: string
  assignedUserIds?: string[]
}

interface RedeemResponse {
  deviceId: string
  deviceAccessMode?: string
  assignedUsers?: { _id: string; firstName?: string }[]
}

describe('device-pairing — Zuweisung im Code-Record', () => {
  const tenantId = uuidv7()

  let locationId: string
  let ownerToken: string
  let posUserId: string
  let secondPosUserId: string
  let nonPosUserId: string

  const authHeader = () => ({ headers: { Authorization: `Bearer ${ownerToken}` } })

  const requestCode = async (body: Record<string, unknown> = {}) =>
    axios.post<RequestCodeResponse>(`${appUrl}/device-pairing/request-code`, { locationId, ...body }, authHeader())

  const redeem = async (body: Record<string, unknown>) =>
    axios.post<RedeemResponse>(`${appUrl}/device-pairing/redeem`, body)

  const createPosUser = async (firstName: string, overrides: Record<string, unknown> = {}): Promise<string> => {
    const created = (await app
      .service('users')
      .create(
        { firstName, lastName: 'Pairing', role: 'tenant:staff', isPosUser: true, tenantId, ...overrides } as never,
        { provider: undefined },
      )) as { _id: string }
    return created._id
  }

  beforeAll(async () => {
    await app.listen(port)

    const location = (await app.service('locations').create(
      {
        name: 'Filiale Pairing',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id

    const owner = (await app.service('users').create(
      {
        firstName: 'Olga',
        lastName: 'Owner',
        role: 'tenant:owner',
        tenantId,
        activeLocationId: locationId,
      } as never,
      { provider: undefined },
    )) as { _id: string }

    // Kein Passwort-Login noetig: Der Token wird direkt ausgestellt, die Route
    // verifiziert ihn ueber dieselbe jwt-Strategie wie im Betrieb.
    ownerToken = await app.service('authentication').createAccessToken({ sub: owner._id })

    posUserId = await createPosUser('Anna')
    secondPosUserId = await createPosUser('Bruno')
    nonPosUserId = await createPosUser('Nico', { isPosUser: false })
  })

  afterAll(async () => {
    await app.teardown()
  })

  describe('request-code', () => {
    it('ohne Zuweisung → shared, leere Liste (unveraendertes Verhalten)', async () => {
      const { data } = await requestCode()

      assert.ok(data.code)
      assert.strictEqual(data.deviceAccessMode, 'shared')
      assert.deepStrictEqual(data.assignedUserIds, [])
    })

    it('mit Zuweisung → echot Modus und IDs zurueck', async () => {
      // Das Echo ist zugleich die Faehigkeits-Sonde: Ein aelterer Edge kennt
      // die Felder nicht und echot sie nicht — daran erkennt die Admin-UI, dass
      // sie die Zuweisung nicht anbieten darf.
      const { data } = await requestCode({ deviceAccessMode: 'assigned', assignedUserIds: [posUserId] })

      assert.strictEqual(data.deviceAccessMode, 'assigned')
      assert.deepStrictEqual(data.assignedUserIds, [posUserId])
    })

    it.each([
      ['assigned ohne Mitarbeiter', { deviceAccessMode: 'assigned' }],
      ['assigned mit leerer Liste', { deviceAccessMode: 'assigned', assignedUserIds: [] }],
      ['unbekannter Modus', { deviceAccessMode: 'kiosk-only' }],
      ['unbekannte userId', { deviceAccessMode: 'assigned', assignedUserIds: [uuidv7()] }],
    ])('lehnt ab: %s', async (_name, body) => {
      // Die Pruefung sitzt beim Ausstellen, nicht beim Redeem: Sonst stuende
      // am Terminal jemand vor einem Code, der aus einem Grund scheitert, den
      // er weder sieht noch beheben kann.
      await assert.rejects(
        () => requestCode(body),
        (err: { response?: { status: number; data?: { error?: string } } }) =>
          err.response?.status === 400 && err.response?.data?.error === 'invalid_assignment',
      )
    })

    it('lehnt einen Nicht-POS-Benutzer mit sprechender Meldung ab', async () => {
      await assert.rejects(
        () => requestCode({ deviceAccessMode: 'assigned', assignedUserIds: [nonPosUserId] }),
        (err: { response?: { data?: { message?: string } } }) =>
          typeof err.response?.data?.message === 'string' && err.response.data.message.includes('kein POS-Benutzer'),
      )
    })
  })

  describe('redeem', () => {
    it('uebernimmt die Zuweisung aus dem Code-Record', async () => {
      const { data: issued } = await requestCode({ deviceAccessMode: 'assigned', assignedUserIds: [posUserId] })
      const { data } = await redeem({ code: issued.code, deviceName: 'Diensthandy Anna' })

      assert.strictEqual(data.deviceAccessMode, 'assigned')
      assert.deepStrictEqual(
        data.assignedUsers?.map(u => u._id),
        [posUserId],
      )
      assert.strictEqual(data.assignedUsers?.[0]?.firstName, 'Anna', 'Anzeigename fehlt im Wizard-Payload')

      const stored = (await app
        .service('devices')
        .find({ query: { deviceId: data.deviceId, tenantId }, provider: undefined })) as {
        data?: { deviceAccessMode?: string; assignedUserIds?: string[] }[]
      }
      assert.strictEqual(stored.data?.[0]?.deviceAccessMode, 'assigned')
      assert.deepStrictEqual(stored.data?.[0]?.assignedUserIds, [posUserId])
    })

    it('IGNORIERT eine Zuweisung aus dem oeffentlichen Body', async () => {
      // Der tragende Test des Schritts. `redeem` ist unauthentifiziert — waere
      // die Zuweisung ein Body-Feld, koennte sich jeder mit einem gueltigen
      // Code ein Geraet auf einen beliebigen Mitarbeiter ausstellen.
      const { data: issued } = await requestCode()
      const { data } = await redeem({
        code: issued.code,
        deviceName: 'Theke geschmuggelt',
        deviceAccessMode: 'assigned',
        assignedUserIds: [secondPosUserId],
      })

      assert.strictEqual(data.deviceAccessMode, 'shared', 'Body-Zuweisung wurde uebernommen')
      assert.deepStrictEqual(data.assignedUsers, [])

      const stored = (await app
        .service('devices')
        .find({ query: { deviceId: data.deviceId, tenantId }, provider: undefined })) as {
        data?: { deviceAccessMode?: string; assignedUserIds?: string[] }[]
      }
      // Die Spalte bleibt LEER statt ein explizites `shared` zu tragen: Ein
      // frisch gepairtes Geraet sieht in der DB aus wie ein Bestandsgeraet.
      // `NULL → shared` ist die Abwaertskompatibilitaets-Garantie (ADR 0023),
      // ein materialisierter Default waere die zweite Wahrheit daneben.
      assert.ok(stored.data?.[0]?.deviceAccessMode == null, 'shared wurde materialisiert')
      assert.ok(stored.data?.[0]?.assignedUserIds == null)
    })

    it('IGNORIERT auch den Versuch, eine Zuweisung im Body abzuwaehlen', async () => {
      // Die Gegenrichtung: Wer den Code eines zugewiesenen Geraets abfaengt,
      // darf sich nicht per Body auf `shared` befreien.
      const { data: issued } = await requestCode({
        deviceAccessMode: 'assigned',
        assignedUserIds: [posUserId, secondPosUserId],
      })
      const { data } = await redeem({
        code: issued.code,
        deviceName: 'Diensthandy befreit',
        deviceAccessMode: 'shared',
        assignedUserIds: [],
      })

      assert.strictEqual(data.deviceAccessMode, 'assigned', 'Body konnte die Zuweisung aufheben')
      assert.strictEqual(data.assignedUsers?.length, 2)
    })

    it('ein Code ist weiterhin single-use', async () => {
      const { data: issued } = await requestCode({ deviceAccessMode: 'assigned', assignedUserIds: [posUserId] })
      await redeem({ code: issued.code, deviceName: 'Erstes Geraet' })

      await assert.rejects(
        () => redeem({ code: issued.code, deviceName: 'Zweites Geraet' }),
        (err: { response?: { status: number; data?: { error?: string } } }) =>
          err.response?.status === 400 && err.response?.data?.error === 'invalid_code',
      )
    })
  })
})
