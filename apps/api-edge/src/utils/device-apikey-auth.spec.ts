import { createHash } from 'node:crypto'

import { APIKEY_GRACE_DAYS, APIKEY_PENDING_STALE_DAYS, APIKEY_ROTATION_LEAD_DAYS } from '@panary/apikeys/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetDeviceApiKeyAuthState, authenticateDeviceApiKey } from './device-apikey-auth'

import type { Application } from '../declarations'

// Diese Funktion ist die einzige Pruefstelle fuer Geraete-Credentials (beide
// Auth-Pfade rufen sie). Die Zusicherung, die hier haengt, ist doppelt:
//  - Sicherheit: `active: false` und ein Schluessel jenseits der Karenz kommen
//    nicht durch.
//  - Betrieb: Ein Ablauf darf NIE eine Aussperrung sein — weder in der Karenz
//    noch bei einer abgebrochenen Rotation. Genau dieser Fall ist am Terminal
//    nicht reparierbar (login.component bricht ab, der Entkopplungs-Dialog
//    braucht selbst einen Server-Roundtrip).

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-17T12:00:00.000Z')
const inDays = (days: number): string => new Date(NOW + days * DAY_MS).toISOString()
const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex')

const RAW_KEY = 'aaaaaaaa-1111-2222-3333-444444444444'
const DEVICE_ID = 'dddddddd-1111-2222-3333-444444444444'

interface Row {
  _id: string
  deviceId: string
  tenantId: string
  locationId: string
  role: string
  active: boolean
  apikey: string
  apikeyPrefix?: string | null
  validUntil?: string | null
  pendingApikey?: string | null
  pendingApikeyPrefix?: string | null
  pendingApikeyCreatedAt?: string | null
}

const makeRow = (overrides: Partial<Row> = {}): Row => ({
  _id: 'key-1',
  deviceId: DEVICE_ID,
  tenantId: 'tenant-1',
  locationId: 'location-1',
  role: 'device:pos',
  active: true,
  apikey: sha256(RAW_KEY),
  apikeyPrefix: RAW_KEY.slice(0, 8),
  validUntil: inDays(120),
  ...overrides,
})

/**
 * Minimal-App mit dem Verhalten des Knex-Adapters, auf das die Funktion baut:
 * `find` liefert unpaginiert, `patch` schreibt in die Zeile zurueck.
 */
const makeApp = (rows: Row[], patchImpl?: (id: string, data: Record<string, unknown>) => Promise<unknown>) => {
  const patch = vi.fn(async (id: string, data: Record<string, unknown>, _params?: Record<string, unknown>) => {
    if (patchImpl) return patchImpl(id, data)
    const row = rows.find(r => r._id === id)
    if (row) Object.assign(row, data)
    return row
  })
  const find = vi.fn(async ({ query }: { query: { deviceId: string } }) =>
    rows.filter(r => r.deviceId === query.deviceId),
  )
  const app = { service: () => ({ find, patch }) } as unknown as Application
  return { app, find, patch }
}

const auth = (app: Application, overrides: Partial<Parameters<typeof authenticateDeviceApiKey>[1]> = {}) =>
  authenticateDeviceApiKey(app, {
    rawKey: RAW_KEY,
    deviceId: DEVICE_ID,
    transport: 'websocket',
    canIssue: true,
    ...overrides,
  })

describe('authenticateDeviceApiKey', () => {
  beforeEach(() => {
    __resetDeviceApiKeyAuthState()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Ablehnung', () => {
    it('lehnt einen unbekannten Schluessel ab', async () => {
      const { app } = makeApp([makeRow({ apikey: sha256('ein-anderer-key') })])
      expect(await auth(app)).toEqual({ ok: false, reason: 'unknown' })
    })

    it('lehnt active: false sofort ab — unabhaengig von einem gueltigen validUntil', async () => {
      const { app } = makeApp([makeRow({ active: false, validUntil: inDays(120) })])
      expect(await auth(app)).toEqual({ ok: false, reason: 'inactive' })
    })

    it('lehnt active: false auch dann ab, wenn der pending-Schluessel praesentiert wird', async () => {
      const { app } = makeApp([
        makeRow({
          active: false,
          apikey: sha256('alt'),
          pendingApikey: sha256(RAW_KEY),
          pendingApikeyCreatedAt: inDays(-1),
        }),
      ])
      expect(await auth(app)).toEqual({ ok: false, reason: 'inactive' })
    })

    it('lehnt jenseits der Karenz ab', async () => {
      const { app } = makeApp([makeRow({ validUntil: inDays(-APIKEY_GRACE_DAYS - 1) })])
      expect(await auth(app)).toEqual({ ok: false, reason: 'expired' })
    })
  })

  describe('Bestands-Schluessel ohne validUntil', () => {
    it('stempelt einmalig und laesst durch', async () => {
      const rows = [makeRow({ validUntil: null })]
      const { app, patch } = makeApp(rows)

      const result = await auth(app)

      expect(result.ok).toBe(true)
      expect(patch).toHaveBeenCalledTimes(1)
      expect(typeof rows[0].validUntil).toBe('string')
      // Die Uhr startet beim ersten Kontakt DIESES Geraets, nicht am Deploy-Tag.
      expect(new Date(rows[0].validUntil as string).getTime()).toBeGreaterThan(NOW)
    })

    it('stempelt beim zweiten Kontakt nicht erneut', async () => {
      const rows = [makeRow({ validUntil: null })]
      const { app, patch } = makeApp(rows)

      await auth(app)
      await auth(app)

      expect(patch).toHaveBeenCalledTimes(1)
    })

    it('laesst durch, auch wenn der Stempel fehlschlaegt', async () => {
      const { app } = makeApp([makeRow({ validUntil: null })], async () => {
        throw new Error('DB weg')
      })
      expect((await auth(app)).ok).toBe(true)
    })
  })

  describe('Rotation', () => {
    it('stellt keinen Schluessel aus, solange die Restlaufzeit ueber dem Lead liegt', async () => {
      const { app, patch } = makeApp([makeRow({ validUntil: inDays(APIKEY_ROTATION_LEAD_DAYS + 1) })])
      const result = await auth(app)

      expect(result).toMatchObject({ ok: true })
      expect(result.ok && result.rotatedKey).toBeUndefined()
      expect(patch).not.toHaveBeenCalled()
    })

    it('stellt unterhalb des Leads einen neuen Schluessel aus und persistiert ihn als pending', async () => {
      const rows = [makeRow({ validUntil: inDays(APIKEY_ROTATION_LEAD_DAYS - 1) })]
      const { app } = makeApp(rows)

      const result = await auth(app)

      expect(result.ok).toBe(true)
      const rotated = result.ok ? result.rotatedKey : undefined
      expect(typeof rotated).toBe('string')
      expect(rows[0].pendingApikey).toBe(sha256(rotated as string))
      expect(rows[0].pendingApikeyPrefix).toBe((rotated as string).slice(0, 8))
      // Der ALTE Schluessel bleibt unveraendert gueltig, bis der neue ankommt.
      expect(rows[0].apikey).toBe(sha256(RAW_KEY))
      expect(rows[0].validUntil).toBe(inDays(APIKEY_ROTATION_LEAD_DAYS - 1))
    })

    it('verlaengert validUntil NICHT beim Ausstellen — sonst rotierte ein nie abgeholter Schluessel ewig weiter', async () => {
      const rows = [makeRow({ validUntil: inDays(1) })]
      const { app } = makeApp(rows)

      await auth(app)

      expect(rows[0].validUntil).toBe(inDays(1))
    })

    it('liefert keinen Klartext, wenn der Persist fehlschlaegt (fail-safe)', async () => {
      const { app } = makeApp([makeRow({ validUntil: inDays(1) })], async () => {
        throw new Error('DB weg')
      })

      const result = await auth(app)

      expect(result.ok).toBe(true)
      expect(result.ok && result.rotatedKey).toBeUndefined()
    })

    it('stellt bei zwei Handshakes kurz hintereinander nur EINEN Schluessel aus', async () => {
      // Zwei ausgestellte Schluessel hiessen: Der Client speichert den einen, die
      // Datenbank haelt den anderen — genau die Aussperrung, gegen die die
      // pending-Mechanik gebaut ist.
      const rows = [makeRow({ validUntil: inDays(1) })]
      const { app } = makeApp(rows)

      const first = await auth(app)
      const second = await auth(app)

      expect(first.ok && first.rotatedKey).toBeTruthy()
      expect(second.ok && second.rotatedKey).toBeUndefined()
    })

    it('stellt einen nie eingeloesten pending-Schluessel nach der Stale-Frist neu aus', async () => {
      const rows = [
        makeRow({
          validUntil: inDays(1),
          pendingApikey: sha256('verlorener-key'),
          pendingApikeyCreatedAt: inDays(-APIKEY_PENDING_STALE_DAYS - 1),
        }),
      ]
      const { app } = makeApp(rows)

      const result = await auth(app)

      expect(result.ok && result.rotatedKey).toBeTruthy()
      expect(rows[0].pendingApikey).not.toBe(sha256('verlorener-key'))
    })

    it('stellt keinen zweiten Schluessel aus, solange der pending-Schluessel frisch ist', async () => {
      const rows = [
        makeRow({
          validUntil: inDays(1),
          pendingApikey: sha256('frisch-zugestellt'),
          pendingApikeyCreatedAt: inDays(-1),
        }),
      ]
      const { app } = makeApp(rows)

      const result = await auth(app)

      expect(result.ok && result.rotatedKey).toBeUndefined()
      expect(rows[0].pendingApikey).toBe(sha256('frisch-zugestellt'))
    })
  })

  describe('Promotion', () => {
    it('promotet den pending-Schluessel beim ersten Gebrauch und setzt die Uhr neu', async () => {
      const rows = [
        makeRow({
          apikey: sha256('alter-key'),
          apikeyPrefix: 'alter-ke',
          validUntil: inDays(-1),
          pendingApikey: sha256(RAW_KEY),
          pendingApikeyPrefix: RAW_KEY.slice(0, 8),
          pendingApikeyCreatedAt: inDays(-2),
        }),
      ]
      const { app } = makeApp(rows)

      const result = await auth(app)

      expect(result.ok).toBe(true)
      expect(rows[0].apikey).toBe(sha256(RAW_KEY))
      expect(rows[0].apikeyPrefix).toBe(RAW_KEY.slice(0, 8))
      // Explizit null, nicht undefined: sonst bliebe der alte pending-Hash gueltig.
      expect(rows[0].pendingApikey).toBeNull()
      expect(rows[0].pendingApikeyPrefix).toBeNull()
      expect(rows[0].pendingApikeyCreatedAt).toBeNull()
      expect(new Date(rows[0].validUntil as string).getTime()).toBeGreaterThan(NOW)
    })

    it('laesst die Verbindung zu, auch wenn die Promotion fehlschlaegt', async () => {
      const { app } = makeApp(
        [
          makeRow({
            apikey: sha256('alter-key'),
            pendingApikey: sha256(RAW_KEY),
            pendingApikeyCreatedAt: inDays(-1),
          }),
        ],
        async () => {
          throw new Error('DB weg')
        },
      )

      expect((await auth(app)).ok).toBe(true)
    })
  })

  describe('Karenz', () => {
    it('laesst einen abgelaufenen Schluessel innerhalb der Karenz durch und erzwingt die Rotation', async () => {
      const rows = [makeRow({ validUntil: inDays(-10) })]
      const { app } = makeApp(rows)

      const result = await auth(app)

      expect(result.ok).toBe(true)
      expect(result.ok && result.state).toBe('grace')
      expect(result.ok && result.rotatedKey).toBeTruthy()
    })

    it('laesst in der Karenz auch den Print-Pfad durch — ohne einen Schluessel auszustellen', async () => {
      // Der Print-Pfad hat keinen Kanal, auf dem der Client zuhoert. Ein hier
      // ausgestellter Schluessel wuerde nie abgeholt und den zugestellten
      // entwerten; 401 waere aber das Ende des Bondrucks mitten in der Schicht.
      const rows = [makeRow({ validUntil: inDays(-10) })]
      const { app } = makeApp(rows)

      const result = await auth(app, { transport: 'http', canIssue: false })

      expect(result.ok).toBe(true)
      expect(result.ok && result.rotatedKey).toBeUndefined()
      expect(rows[0].pendingApikey).toBeUndefined()
    })

    it('akzeptiert im Print-Pfad den bereits rotierten Schluessel und promotet ihn', async () => {
      // Sonst antwortet der Bondruck ab der Rotation 401, waehrend die Kasse laeuft.
      const rows = [
        makeRow({
          apikey: sha256('alter-key'),
          pendingApikey: sha256(RAW_KEY),
          pendingApikeyPrefix: RAW_KEY.slice(0, 8),
          pendingApikeyCreatedAt: inDays(-1),
        }),
      ]
      const { app } = makeApp(rows)

      const result = await auth(app, { transport: 'http', canIssue: false })

      expect(result.ok).toBe(true)
      expect(rows[0].apikey).toBe(sha256(RAW_KEY))
    })
  })

  it('sucht ueber deviceId, nicht ueber den Prefix — der rotierte Schluessel hat einen anderen', async () => {
    const { app, find } = makeApp([makeRow()])
    await auth(app)

    const query = find.mock.calls[0][0].query as Record<string, unknown>
    expect(query.deviceId).toBe(DEVICE_ID)
    expect(query.apikeyPrefix).toBeUndefined()
  })

  it('schreibt ausschliesslich ueber die Adapter-API mit provider: undefined', async () => {
    const { app, patch } = makeApp([makeRow({ validUntil: inDays(1) })])
    await auth(app)

    const params = patch.mock.calls[0][2] as unknown as { provider?: unknown; _apikeyRotation?: boolean }
    expect(params.provider).toBeUndefined()
    expect(params._apikeyRotation).toBe(true)
  })
})
