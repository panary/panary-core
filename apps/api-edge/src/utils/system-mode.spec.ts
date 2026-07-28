import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/cloud-connection/domain', () => ({
  PairingStatus: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', PENDING: 'pending' },
}))

import { resolveSystemMode, systemModeFromPairing } from './system-mode'

describe('systemModeFromPairing', () => {
  it('meldet connected, sobald das Pairing CONNECTED ist', () => {
    expect(systemModeFromPairing('standalone', 'connected')).toBe('connected')
  })

  it('meldet standalone ohne Pairing', () => {
    expect(systemModeFromPairing('standalone', undefined)).toBe('standalone')
  })

  it.each(['disconnected', 'pending'])('meldet standalone bei Pairing-Status %s', status => {
    expect(systemModeFromPairing('standalone', status)).toBe('standalone')
  })

  // Tier 1 hat gar keinen Edge — ein Pairing-Status kann dort nichts aussagen.
  it('laesst die Config bei cloud gewinnen, unabhängig vom Pairing', () => {
    expect(systemModeFromPairing('cloud', 'connected')).toBe('cloud')
    expect(systemModeFromPairing('cloud', undefined)).toBe('cloud')
  })

  // Der frueher ausgelieferte Wert war fest 'standalone'; eine veraltete Config
  // darf die Herleitung nicht ueberstimmen.
  it('ignoriert einen konfigurierten Wert von connected und leitet trotzdem ab', () => {
    expect(systemModeFromPairing('connected', undefined)).toBe('standalone')
  })
})

/**
 * Stub-App mit MEHREREN cloud-connection-Zeilen. `find` filtert die Query
 * nach, damit die Spec beweisen kann, dass die Modus-Herleitung gezielt die
 * CONNECTED-Zeile waehlt statt der ersten beliebigen.
 */
function makeApp(opts: {
  configuredMode?: string
  connections?: Array<{ pairingStatus: string }>
  throws?: boolean
}): any {
  const rows = opts.connections ?? []
  return {
    get: (key: string) => (key === 'system' ? { mode: opts.configuredMode ?? 'standalone' } : undefined),
    service: () => ({
      find: opts.throws
        ? vi.fn().mockRejectedValue(new Error('db down'))
        : vi.fn().mockImplementation(({ query }: any) =>
            Promise.resolve(
              query?.pairingStatus ? rows.filter(r => r.pairingStatus === query.pairingStatus) : rows,
            ),
          ),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveSystemMode', () => {
  it('leitet connected aus einer gepairten cloud-connection ab', async () => {
    await expect(
      resolveSystemMode(makeApp({ connections: [{ pairingStatus: 'connected' }] })),
    ).resolves.toBe('connected')
  })

  it('leitet standalone ohne cloud-connection ab', async () => {
    await expect(resolveSystemMode(makeApp({}))).resolves.toBe('standalone')
  })

  // Die Tabelle hat keinen Unique-Constraint: abgebrochene Pairings hinterlassen
  // Altlast-Zeilen. Waehlte die Herleitung blind die erste, wuerde ein gepairter
  // Edge als 'standalone' melden — und der Admin-Client saemtliche
  // Standort-Seiten entsperrt zeigen, obwohl das Backend sie blockt.
  it('waehlt die CONNECTED-Zeile, auch wenn eine Altlast davor steht', async () => {
    await expect(
      resolveSystemMode(
        makeApp({ connections: [{ pairingStatus: 'disconnected' }, { pairingStatus: 'connected' }] }),
      ),
    ).resolves.toBe('connected')
  })

  it('bleibt standalone, wenn ausschliesslich nicht-verbundene Zeilen existieren', async () => {
    await expect(
      resolveSystemMode(
        makeApp({ connections: [{ pairingStatus: 'disconnected' }, { pairingStatus: 'pending' }] }),
      ),
    ).resolves.toBe('standalone')
  })

  it('liest die cloud-connection gar nicht erst, wenn cloud konfiguriert ist', async () => {
    await expect(resolveSystemMode(makeApp({ configuredMode: 'cloud', throws: true }))).resolves.toBe('cloud')
  })

  // Ein Reporting-Wert darf den Boot nie blockieren.
  it('fällt bei Lookup-Fehler auf standalone zurück', async () => {
    await expect(resolveSystemMode(makeApp({ throws: true }))).resolves.toBe('standalone')
  })
})
