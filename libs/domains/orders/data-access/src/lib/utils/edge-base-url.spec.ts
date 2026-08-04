import { describe, expect, it } from 'vitest'
import { resolveEdgeBaseUrl } from './edge-base-url'

// Regression: `order-print.service.ts` bildete das Ziel des Bon-Drucks aus
// `window.location.origin`. Das stimmt nur im Admin-Client, den der Edge selbst
// ausliefert. Der POS laeuft unter eigener Herkunft (Tauri:
// `http://tauri.localhost`) und schickte den Auftrag damit an sich selbst — der
// Edge sah acht Tage lang keine einzige `/print-server/print-order`-Anfrage,
// waehrend der Testdruck aus dem Edge-Admin funktionierte.

describe('resolveEdgeBaseUrl', () => {
  it('nimmt die serverUrl der gepairten Device-Config (POS-Betrieb)', () => {
    expect(
      resolveEdgeBaseUrl({
        deviceServerUrl: 'http://10.10.100.77:3030',
        configuredApiUrl: 'http://localhost:3030',
      }),
    ).toBe('http://10.10.100.77:3030')
  })

  it('nutzt ohne Device-Config die App-Konfiguration', () => {
    expect(resolveEdgeBaseUrl({ deviceServerUrl: null, configuredApiUrl: 'http://edge.local:3030' })).toBe(
      'http://edge.local:3030',
    )
  })

  it('normalisiert auf protocol//host — ein Pfad-Rest darf den Endpunkt nicht verschieben', () => {
    expect(resolveEdgeBaseUrl({ deviceServerUrl: 'http://10.10.100.77:3030/setup?x=1', configuredApiUrl: '' })).toBe(
      'http://10.10.100.77:3030',
    )
  })

  it('behandelt Leerstrings wie fehlende Werte', () => {
    expect(resolveEdgeBaseUrl({ deviceServerUrl: '   ', configuredApiUrl: 'http://edge.local:3030' })).toBe(
      'http://edge.local:3030',
    )
  })

  it('wirft, wenn gar kein Ziel bekannt ist — lieber laut als an den falschen Host', () => {
    expect(() => resolveEdgeBaseUrl({ deviceServerUrl: '', configuredApiUrl: '' })).toThrow(
      /Kein Edge-Server konfiguriert/,
    )
  })

  it('wirft bei unbrauchbarer URL statt sie durchzureichen', () => {
    expect(() => resolveEdgeBaseUrl({ deviceServerUrl: 'nicht-mal-eine-url', configuredApiUrl: '' })).toThrow(
      /Ungültige URL/,
    )
  })
})
