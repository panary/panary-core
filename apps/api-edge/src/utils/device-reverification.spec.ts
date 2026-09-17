import { describe, expect, it, vi } from 'vitest'

import { evaluateDeviceReverification, releaseDeviceReverification } from './device-reverification'

import type { Application } from '../declarations'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-17T06:00:00.000Z')
const ago = (ms: number): string => new Date(NOW - ms).toISOString()

/**
 * Recorder je Test (testing.md §10): Das Freigabe-Audit laeuft in einer
 * abbrechbaren Promise-Kette — ein Nachzuegler wuerde in das Handle des
 * naechsten Tests schreiben, wenn es im describe-Scope lebte.
 */
function makeApp(
  options: { locationSettings?: unknown; findThrows?: boolean; createThrows?: boolean; patchThrows?: boolean } = {},
) {
  const created: unknown[] = []
  const patched: Array<{ id: unknown; data: unknown; params?: unknown }> = []

  const app = {
    service: (path: string) => {
      if (path === 'locations') {
        return {
          find: options.findThrows
            ? vi.fn().mockRejectedValue(new Error('locations nicht erreichbar'))
            : vi.fn().mockResolvedValue({ data: [{ settings: options.locationSettings ?? {} }] }),
        }
      }
      if (path === 'audit-events') {
        return {
          create: vi.fn(async (event: unknown) => {
            if (options.createThrows) throw new Error('audit kaputt')
            created.push(event)
            return event
          }),
        }
      }
      // apikeys — benutzt von stampApiKeyLastUsed (fire-and-forget) und vom
      // persistenten Re-Verifikations-Zustand. Der Marker wird mitaufgezeichnet:
      // ohne ihn verwirft der Patch-Resolver das Feld stillschweigend.
      return {
        patch: vi.fn(async (id: unknown, data: unknown, params: unknown) => {
          if (options.patchThrows) throw new Error('apikeys nicht schreibbar')
          patched.push({ id, data, params })
          return data
        }),
      }
    },
  } as unknown as Application

  return { app, created, patched }
}

/** Laesst die fire-and-forget-Promise von stampApiKeyLastUsed durchlaufen. */
const flush = () => new Promise(resolve => setImmediate(resolve))

const makeConnection = (overrides: Record<string, unknown> = {}) => ({
  apiKey: true,
  deviceId: 'dev-1',
  tenantId: 'tenant-1',
  locationId: 'loc-1',
  deviceRole: 'device:pos-client',
  apiKeyId: 'key-1',
  requiresReverification: true,
  reverificationOfflineSince: ago(9 * DAY_MS),
  reverificationOfflineForMs: 9 * DAY_MS,
  reverificationThresholdMs: 7 * DAY_MS,
  ...overrides,
})

describe('evaluateDeviceReverification', () => {
  it('loest nach neun Tagen Pause aus', async () => {
    const { app } = makeApp()

    const verdict = await evaluateDeviceReverification(app, { locationId: 'loc-1', lastUsedAt: ago(9 * DAY_MS) }, NOW)

    expect(verdict.due).toBe(true)
    expect(verdict.offlineForMs).toBe(9 * DAY_MS)
    expect(verdict.thresholdMs).toBe(7 * DAY_MS)
  })

  it('laesst ein Wochenende in Ruhe', async () => {
    const { app } = makeApp()

    const verdict = await evaluateDeviceReverification(
      app,
      { locationId: 'loc-1', lastUsedAt: ago(60 * 3_600_000) },
      NOW,
    )

    expect(verdict.due).toBe(false)
  })

  it('folgt der Schwelle des Standorts', async () => {
    const { app } = makeApp({ locationSettings: { deviceSecuritySettings: { offlineReverifyDays: 30 } } })

    const verdict = await evaluateDeviceReverification(app, { locationId: 'loc-1', lastUsedAt: ago(9 * DAY_MS) }, NOW)

    expect(verdict.due).toBe(false)
    expect(verdict.thresholdMs).toBe(30 * DAY_MS)
  })

  it('faellt auf den Default zurueck, wenn der Standort nicht lesbar ist — nie haerter als konfiguriert', async () => {
    const { app } = makeApp({ findThrows: true })

    const verdict = await evaluateDeviceReverification(app, { locationId: 'loc-1', lastUsedAt: ago(9 * DAY_MS) }, NOW)

    expect(verdict.thresholdMs).toBe(7 * DAY_MS)
    expect(verdict.due).toBe(true)
  })

  it('ist fail-open ohne Stempel — ein Bestands-Schluessel wird nicht auf Verdacht gesperrt', async () => {
    const { app } = makeApp()

    const verdict = await evaluateDeviceReverification(app, { locationId: 'loc-1', lastUsedAt: null }, NOW)

    expect(verdict.due).toBe(false)
    expect(verdict.offlineForMs).toBeNull()
  })
})

describe('releaseDeviceReverification', () => {
  it('gibt bei Leitungsrolle regulaer frei und stempelt lastUsedAt erzwungen', async () => {
    const { app, created, patched } = makeApp()
    const connection = makeConnection()

    await releaseDeviceReverification(
      app,
      { _id: 'user-1', role: 'tenant:manager', tenantId: 'tenant-1' },
      { connection },
    )
    await flush()

    expect(connection.requiresReverification).toBe(false)
    // Zwei Patches, und die Reihenfolge traegt: erst der persistente Zustand
    // (das IST die Freigabe), dann der Stempel.
    expect(patched.map(entry => entry.data)).toEqual([
      { reverifyOfflineSince: null },
      expect.objectContaining({ lastUsedAt: expect.any(String) }),
    ])
    expect(patched[0].params).toMatchObject({ provider: undefined, _deviceReverification: true })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      action: 'PIN_VERIFY',
      category: 'ACCESS',
      outcome: 'SUCCESS',
      severity: 'NOTICE',
      metadata: { reason: 'device-reverification-granted', emergency: false, thresholdHours: 168 },
      target: { entityId: 'dev-1' },
      actor: { userId: 'user-1', role: 'tenant:manager', deviceId: 'dev-1' },
    })
  })

  it('gibt bei Mitarbeiter-PIN als Notfreigabe frei — sichtbar als ALERT', async () => {
    const { app, created } = makeApp()
    const connection = makeConnection()

    await releaseDeviceReverification(
      app,
      { _id: 'user-2', role: 'tenant:staff', tenantId: 'tenant-1' },
      { connection },
    )

    expect(connection.requiresReverification).toBe(false)
    expect(created[0]).toMatchObject({
      severity: 'ALERT',
      metadata: { reason: 'device-reverification-emergency-granted', emergency: true },
    })
  })

  it('nennt im Audit die TATSAECHLICH angewandte Schwelle, nicht den Default', async () => {
    const { app, created } = makeApp()
    const connection = makeConnection({ reverificationThresholdMs: 14 * DAY_MS })

    await releaseDeviceReverification(
      app,
      { _id: 'user-1', role: 'tenant:owner', tenantId: 'tenant-1' },
      { connection },
    )

    expect(created[0]).toMatchObject({ metadata: { thresholdHours: 336 } })
  })

  it('tut nichts, wenn keine Bestaetigung aussteht — verifyPin bleibt im Alltag nebenwirkungsfrei', async () => {
    const { app, created, patched } = makeApp()
    const connection = makeConnection({ requiresReverification: false })

    await releaseDeviceReverification(
      app,
      { _id: 'user-1', role: 'tenant:owner', tenantId: 'tenant-1' },
      { connection },
    )
    await flush()

    expect(created).toHaveLength(0)
    expect(patched).toHaveLength(0)
  })

  it('verweigert einem fremden Mandanten die Freigabe', async () => {
    const { app, created } = makeApp()
    const connection = makeConnection()

    await releaseDeviceReverification(
      app,
      { _id: 'user-x', role: 'tenant:owner', tenantId: 'tenant-FREMD' },
      { connection },
    )

    expect(connection.requiresReverification).toBe(true)
    expect(created).toHaveLength(0)
  })

  it('tut nichts ohne Geraete-Connection (JWT-Admin ruft verifyPin ebenfalls auf)', async () => {
    const { app, created } = makeApp()

    await expect(
      releaseDeviceReverification(app, { _id: 'user-1', role: 'tenant:owner', tenantId: 'tenant-1' }, {}),
    ).resolves.toBeUndefined()
    expect(created).toHaveLength(0)
  })

  it('bleibt bei fehlgeschlagenem Audit still — eine gueltige PIN darf nicht als Fehler enden', async () => {
    const { app } = makeApp({ createThrows: true })
    const connection = makeConnection()

    await expect(
      releaseDeviceReverification(app, { _id: 'user-1', role: 'tenant:owner', tenantId: 'tenant-1' }, { connection }),
    ).resolves.toBeUndefined()
    // Das Merkmal ist trotzdem geloest — die harmlosere Richtung.
    expect(connection.requiresReverification).toBe(false)
  })
})

// 🚨 Regressionsblock zum Befund aus dem Regel-Review von core#325.
//
// Der erste Entwurf leitete die Faelligkeit allein aus `apikeys.lastUsedAt` ab —
// und `channels.ts` stempelt genau dieses Feld zwei Zeilen nach der Auswertung.
// Ein automatischer Socket-Reconnect (der POS-Client reconnected unbegrenzt) las
// damit ein frisches `lastUsedAt`, bekam `due=false` und war ohne jede
// PIN-Eingabe wieder schreibberechtigt. Derselbe Weg stand ueber den
// Print-Server-Pfad offen, der `lastUsedAt` unabhaengig vom Socket stempelt.
describe('evaluateDeviceReverification — Reconnect darf die Sperre nicht aufheben', () => {
  it('bleibt faellig, wenn der Zustand persistiert ist — auch bei brandfrischem lastUsedAt', async () => {
    const { app } = makeApp()

    const verdict = await evaluateDeviceReverification(
      app,
      {
        _id: 'key-1',
        locationId: 'loc-1',
        // Der Stempel des ausloesenden Handshakes, Sekunden alt.
        lastUsedAt: ago(30_000),
        reverifyOfflineSince: ago(9 * DAY_MS),
      },
      NOW,
    )

    expect(verdict.due).toBe(true)
    expect(verdict.alreadyPending).toBe(true)
    // Die Dauer zaehlt ab dem gemerkten Kontakt, nicht ab dem frischen Stempel —
    // sonst zeigte der Bildschirm nach einem Reconnect „1 Tag" statt neun.
    expect(verdict.offlineForMs).toBe(9 * DAY_MS)
  })

  it('persistiert den Zustand beim ausloesenden Handshake, mit dem Marker', async () => {
    const { app, patched } = makeApp()
    const lastUsedAt = ago(9 * DAY_MS)

    const verdict = await evaluateDeviceReverification(app, { _id: 'key-1', locationId: 'loc-1', lastUsedAt }, NOW, {
      persist: true,
    })
    await flush()

    expect(verdict.alreadyPending).toBe(false)
    expect(patched).toEqual([
      {
        id: 'key-1',
        data: { reverifyOfflineSince: lastUsedAt },
        params: { provider: undefined, _deviceReverification: true },
      },
    ])
  })

  it('persistiert NICHT, wenn nichts faellig ist', async () => {
    const { app, patched } = makeApp()

    await evaluateDeviceReverification(
      app,
      { _id: 'key-1', locationId: 'loc-1', lastUsedAt: ago(60 * 3_600_000) },
      NOW,
      { persist: true },
    )
    await flush()

    expect(patched).toHaveLength(0)
  })

  it('kippt den Handshake nicht, wenn der Persist fehlschlaegt', async () => {
    const { app } = makeApp({ patchThrows: true })

    const verdict = await evaluateDeviceReverification(
      app,
      { _id: 'key-1', locationId: 'loc-1', lastUsedAt: ago(9 * DAY_MS) },
      NOW,
      { persist: true },
    )
    await flush()

    // Faellig bleibt faellig; der naechste Handshake versucht es erneut, weil die
    // Pause dann ja noch messbar ist.
    expect(verdict.due).toBe(true)
  })
})

describe('releaseDeviceReverification — der persistente Zustand entscheidet', () => {
  it('laesst die Sperre stehen, wenn der Zustand nicht geloescht werden kann', async () => {
    // Lieber sichtbar nicht freigegeben als scheinbar freigegeben: Eine Freigabe,
    // die nur die Connection erreicht, waere nach dem naechsten Reconnect weg.
    const { app, created } = makeApp({ patchThrows: true })
    const connection = makeConnection()

    await expect(
      releaseDeviceReverification(app, { _id: 'user-1', role: 'tenant:owner', tenantId: 'tenant-1' }, { connection }),
    ).resolves.toBeUndefined()

    expect(connection.requiresReverification).toBe(true)
    expect(created).toHaveLength(0)
  })
})
