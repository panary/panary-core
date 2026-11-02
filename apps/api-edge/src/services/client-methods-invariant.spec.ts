// GATE fuer die Klasse „Client registriert eine Custom-Method, die die Edge nicht kennt".
//
// Der POS-Client haengt Custom-Methoden nur an, wenn er sie am Socket-Client
// registriert (`CLIENT_SERVICE_METHODS`). Registriert er eine, die die Edge
// nicht anbietet, merkt das niemand, bis der Aufruf am Geraet ins Leere laeuft;
// umgekehrt fiel `openDay` jahrelang nicht auf, weil der Client `open`
// registrierte (panary/panary-core#1120). Diese Spec registriert ALLE
// Edge-Services an einer echten Feathers-App (Muster:
// `stamp-fields-invariant.spec.ts`) und prueft EINSEITIG:
//
//   Custom-Methoden des Clients ⊆ Methoden der Edge
//
// Bewusst nicht geprueft (panary/panary-core#1165, „Nicht abgedeckt"):
// - Standardmethoden (`find` … `remove`, `update`): Der Client registriert sie
//   pauschal, die Edge bietet nicht jede an (`update` fehlt ueberall).
// - Service-Pfade ohne Edge-Gegenstueck (`leave-requests`): Sie bedient nur die
//   Cloud; die Spec fuehrt sie als bekannte Ausnahme statt abzubrechen.
// - Die Cloud. Der Client bedient mit derselben Registrierung Edge UND
//   Cloud-Direkt-Kassen; Cloud-Only-Methoden waeren hier kein Befund.
// - Die Gegenrichtung „aufgerufen, aber nicht registriert".
//
// `businessdays.discardOrphanDay` gibt es an der Edge, am Client bleibt es
// unregistriert: Nur der Admin-Client ruft es per REST
// (`apps/admin-client/src/app/features/business-days/business-days-list.ts`).

import { feathers, getServiceOptions } from '@feathersjs/feathers'

import { DatabaseType } from '@panary/shared-common'
import { CLIENT_SERVICE_METHODS, CLIENT_STANDARD_METHODS } from '@panary/shared/data-access/client-methods'
import { describe, expect, it, vi } from 'vitest'

import { services } from './index'

vi.mock('@panary/shared-backend', async importOriginal => {
  const actual = await importOriginal<typeof import('@panary/shared-backend')>()
  return { ...actual, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
})

/**
 * Custom-Methoden, die der Client registriert, obwohl die Edge sie nicht kennt.
 * Schluessel `<service-pfad>.<methode>`, Wert die Begruendung. Zielzustand: leer.
 */
const BEKANNTE_AUSNAHMEN: Record<string, string> = {}

/** Service-Pfade des Clients ohne Edge-Gegenstueck, mit Begruendung. */
const PFADE_OHNE_EDGE: Record<string, string> = {
  'leave-requests': 'Urlaubsantraege fuehrt nur die Cloud; am Edge gibt es den Service nicht',
}

/** Bewusst nicht registrierte Edge-Custom-Methoden, Schluessel wie oben. */
const BEWUSST_UNREGISTRIERT: Record<string, string> = {
  'businessdays.discardOrphanDay': 'nur Admin-Client per REST, nie vom POS',
}

/** Platzhalter fuer `app.get(...)`, wie in `stamp-fields-invariant.spec.ts`. */
const anyStub: unknown = new Proxy(
  function stub() {
    return undefined
  } as unknown as object,
  {
    get: () => anyStub,
    apply: () => anyStub,
    construct: () => anyStub as object,
  },
)

const edgeMethoden = (): Map<string, Set<string>> => {
  const app = feathers()
  app.get = ((key: string) => (key === 'system' ? { dbType: DatabaseType.SQLITE } : anyStub)) as never
  services(app as never)

  const result = new Map<string, Set<string>>()
  for (const [path, service] of Object.entries(app.services)) {
    const options = getServiceOptions(service as Parameters<typeof getServiceOptions>[0])
    result.set(path, new Set(options?.methods ?? []))
  }
  return result
}

const customMethoden = (methods: readonly string[]) => methods.filter(m => !CLIENT_STANDARD_METHODS.includes(m))

describe('Invariante: jede Custom-Method des POS-Clients existiert an der Edge', () => {
  const edge = edgeMethoden()

  it('kein Client-Service registriert eine Methode, die die Edge nicht anbietet (ausser Ausnahmen)', () => {
    const fehlend = Object.entries(CLIENT_SERVICE_METHODS)
      .filter(([path]) => edge.has(path))
      .flatMap(([path, methods]) =>
        customMethoden(methods)
          .filter(m => !edge.get(path)?.has(m))
          .map(m => `${path}.${m}`),
      )

    expect(
      fehlend.filter(key => !(key in BEKANNTE_AUSNAHMEN)),
      'Custom-Method am Client registriert, an der Edge unbekannt — ' +
        'CLIENT_SERVICE_METHODS (libs/shared/data-access/src/lib/services/client-service-methods.ts) pruefen',
    ).toEqual([])

    // Gegenrichtung: Kennt die Edge die Methode inzwischen, soll die Ausnahme auffallen.
    expect(
      Object.keys(BEKANNTE_AUSNAHMEN).filter(key => !fehlend.includes(key)),
      'Ausnahme nicht mehr noetig — Eintrag aus BEKANNTE_AUSNAHMEN entfernen',
    ).toEqual([])
  })

  it('Client-Pfade ohne Edge-Gegenstueck sind genau die bekannten', () => {
    const ohneEdge = Object.keys(CLIENT_SERVICE_METHODS).filter(path => !edge.has(path))
    expect(ohneEdge.sort(), 'Client-Pfad ohne Edge-Service — in PFADE_OHNE_EDGE begruenden').toEqual(
      Object.keys(PFADE_OHNE_EDGE).sort(),
    )
  })

  it('bewusst unregistrierte Edge-Methoden existieren an der Edge und fehlen am Client', () => {
    for (const key of Object.keys(BEWUSST_UNREGISTRIERT)) {
      const [path, method] = key.split('.')
      expect(edge.get(path)?.has(method), `${key} gibt es an der Edge nicht mehr`).toBe(true)
      const client = (CLIENT_SERVICE_METHODS as Record<string, readonly string[]>)[path] ?? []
      expect(client.includes(method), `${key} ist am Client inzwischen registriert`).toBe(false)
    }
  })

  // ABDECKUNG statt Befund: Waere `services()` kaputt oder `getServiceOptions`
  // leer, waere die Fehlliste ebenfalls leer — gruen, ohne gemessen zu haben.
  it('misst tatsaechlich: die Edge liefert Methoden fuer die Client-Services', () => {
    const gemessen = Object.keys(CLIENT_SERVICE_METHODS).filter(path => (edge.get(path)?.size ?? 0) > 0)
    expect(gemessen.length).toBe(Object.keys(CLIENT_SERVICE_METHODS).length - Object.keys(PFADE_OHNE_EDGE).length)
    expect(edge.get('businessdays')?.has('openDay')).toBe(true)
  })
})
