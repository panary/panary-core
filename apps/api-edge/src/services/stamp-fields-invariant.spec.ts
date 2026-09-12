// HARTES GATE fuer die Klasse „Schema kennt gestempeltes Feld nicht".
//
// Der Boot-Check in `assert-stamp-fields.ts` loggt nur (er darf nicht werfen —
// haengt ein Fix am Release-/Pin-Zyklus, wuerde ein Abbruch die gesamte
// Edge-API blockieren). Diese Spec ist die scharfe Variante: sie registriert
// ALLE Services gegen eine echte, aber leere Feathers-App und vergleicht die
// Befunde mit einer Ausnahmeliste, die eine Begruendung erzwingt.
//
// Neuer Service mit fehlendem `tenantId` im DATA- ODER PATCH-Schema → dieser
// Test wird rot, bevor der Endpunkt in Produktion 400 "validation failed"
// liefert. Portiert aus panary-cloud (`stamp-fields-invariant.spec.ts`,
// panary/panary-cloud#199), wo die PATCH-Haelfte beim ersten Lauf sofort 11
// Services fand, deren externer Patch seit jeher scheiterte.
//
// Seit panary/panary-core#289 deckt das Gate BEIDE Regeln ab — auch REQUIRED,
// mit `REQUIRED_STAMP_EXCEPTIONS` aus dem Check als Ausnahmeliste. Der Grund
// ist nicht die Schaerfe (REQUIRED bleibt eine latente Falle, kein Ausfall),
// sondern die Gegenrichtung: Die Liste hatte als reine Boot-Check-Konstante
// keine Obsoleszenz-Pruefung. Wird ein Schema spaeter `Type.Optional`, blieb
// der Eintrag still stehen — also genau die Verrottung, gegen die es die Liste
// gibt. Beide Richtungen stehen hier jetzt nebeneinander, wie bei MISSING.
//
// Der zweite Test ist der wichtigere: Er prueft die ABDECKUNG statt der
// Befunde. Ein leeres Befund-Ergebnis beweist ohne ihn nur, dass nichts
// gefunden wurde — nicht, dass gesucht wurde. Genau dieser Unterschied war der
// Defekt hinter #183: `sync-conflicts` deklariert kein `docs.schemas`, der
// Check lief still an ihm vorbei, und das Boot-Log sah gesund aus.

import { feathers } from '@feathersjs/feathers'

import { DatabaseType } from '@panary/shared-common'
import { describe, expect, it, vi } from 'vitest'

import {
  REQUIRED_STAMP_EXCEPTIONS,
  checkStampFields,
  collectStampTargets,
  unexcusedRequiredViolations,
} from './assert-stamp-fields'
import { services } from './index'

vi.mock('@panary/shared-backend', async importOriginal => {
  const actual = await importOriginal<typeof import('@panary/shared-backend')>()
  return { ...actual, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
})

/**
 * Bekannte Verstoesse mit Begruendung, Schluessel `<service-pfad>:<data|patch>`.
 * Eintraege sind KEINE Dauerloesung — jeder braucht einen Grund, warum der Fix
 * nicht sofort moeglich ist (typisch: Schema liegt in einer Domain-Lib, die
 * cloud-seitig gepinnt ist).
 *
 * Zielzustand ist eine LEERE Liste, wie in panary-cloud erreicht. Merke aus
 * cloud: Wo ein Schema herkommt, gehoert nachgesehen
 * (`grep -rl "export const <name>PatchSchema" libs apps`) und nicht aus dem
 * Servicenamen geschlossen — zwei Eintraege warteten dort unnoetig auf einen
 * Core-Release, obwohl das Schema in der Service-Datei selbst stand.
 *
 * NUR fuer MISSING. Die REQUIRED-Regel hat ihre eigene, fachlich begruendete
 * Liste im Check (`REQUIRED_STAMP_EXCEPTIONS`) — sie wird im zweiten Test
 * geprueft, nicht hier. Zwei Listen, weil die Eintraege Verschiedenes
 * rechtfertigen: hier „Fix haengt am Pin-Zyklus" (temporaer, Zielzustand leer),
 * dort „Pflicht ist fachlich richtig" (dauerhaft, Zielzustand nicht leer).
 */
const BEKANNTE_AUSNAHMEN: Record<string, string> = {}

/**
 * Services mit `multiTenancy()`, deren Schema der Check NICHT aus dem
 * markierten Validierungs-Hook bekommt. Schluessel `<pfad>:<data|patch>`.
 *
 * Ein Eintrag heisst: Diese Schreib-Methode validiert nicht gegen ein
 * markiertes Schema — der Check kann dort nichts pruefen. Das ist zulaessig,
 * wenn die Methode gar nicht gegen ein Schema validiert (Custom-Service,
 * Durchreiche), aber es muss dastehen, sonst waechst die Blindheit
 * unbemerkt nach.
 */
const BEKANNTE_LUECKEN: Record<string, string> = {
  // Proxy ohne Datensatz: `discount-code-redeem` reicht an die Cloud durch
  // (Codes liegen nicht am Edge, ADR 0032) und hat gar kein Data-Schema. Der
  // Stempel landet auf einem Objekt, dessen Felder der Proxy einzeln
  // weiterreicht — es gibt kein geschlossenes Schema, das ihn ablehnen koennte.
  'discount-code-redeem:data': 'Cloud-Proxy ohne Datensatz und ohne Data-Schema',
  // `bootstrap-reports` laesst externe Writes gar nicht zu: `blockExternalWrites`
  // ist der AEUSSERSTE around-Hook und wirft `Forbidden` fuer jeden
  // create/patch/update mit `provider`. Der Patch-Pfad ist damit intern-only, und
  // interne Aufrufe tragen keinen `user` → kein Stempel, kein Schema-Konflikt.
  'bootstrap-reports:patch': 'blockExternalWrites verbietet externen Patch — intern wird nicht gestempelt',
}

/**
 * Universeller Platzhalter fuer `app.get(...)`: Services holen sich dort
 * Infrastruktur (sqliteClient, paginate, system, …). Da hier nichts ausgefuehrt,
 * sondern nur registriert wird, genuegt ein Objekt, das jeden Zugriff und
 * Aufruf beantwortet.
 */
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

/**
 * Eine ECHTE Feathers-App — nur ohne Infrastruktur. Wichtig: Der Check liest
 * `service.__hooks` und `getServiceOptions(service)`, beides legt erst
 * Feathers' eigenes `app.use()`/`.hooks()` an. Eine handgebaute Attrappe (wie
 * in cloud, das seine Registry selbst fuehrt) wuerde hier genau die Mechanik
 * wegabstrahieren, die geprueft werden soll.
 *
 * `dbType` muss echt sein: `createServiceAdapter` waehlt darueber den Adapter
 * und wirft bei allem anderen. Alles weitere (Knex-Client, Paginate,
 * Print-Server, …) wird bei der Registrierung nur weitergereicht, nicht
 * benutzt — dafuer genuegt der Proxy.
 */
const makeApp = () => {
  const app = feathers()
  app.get = ((key: string) => (key === 'system' ? { dbType: DatabaseType.SQLITE } : anyStub)) as never
  return app
}

/**
 * Alle Befunde einer frisch registrierten App. Beide Befund-Tests teilen sich
 * diese Quelle — zwei eigene Sweeps waeren zwei Gelegenheiten, unterschiedlich
 * zu sammeln.
 */
const befunde = () => {
  const app = makeApp()
  services(app as never)
  return collectStampTargets(app as never)
    .map(target =>
      checkStampFields({
        path: target.path,
        dataSchema: target.schema,
        mtOptions: target.mtOptions,
        kind: target.kind,
      }),
    )
    .filter((v): v is NonNullable<typeof v> => v !== null)
}

describe('Invariante: DATA- und PATCH-Schema kennen die multiTenancy-Stempelfelder', () => {
  it('kein Service verletzt sie (ausser dokumentierten Ausnahmen)', () => {
    // Dieser Test ist die MISSING-Haelfte; REQUIRED hat einen eigenen unten,
    // weil es eine andere Ausnahmeliste und eine andere Schluesselform hat
    // (`<pfad>` statt `<pfad>:<kind>` — REQUIRED gilt nur fuer DATA).
    const verstoesse = befunde().filter(v => v.missing.length > 0)

    // Der Ausnahme-Schluessel ist `<pfad>:<kind>` — eine Ausnahme fuer das
    // DATA-Schema darf die PATCH-Seite desselben Services nicht mitentschuldigen.
    const unerwartet = verstoesse.filter(v => !(`${v.path}:${v.kind}` in BEKANNTE_AUSNAHMEN))
    expect(
      unerwartet.map(v => v.message),
      'Service ohne Stempelfeld im DATA- oder PATCH-Schema — siehe assert-stamp-fields.ts',
    ).toEqual([])

    // Gegenrichtung: eine Ausnahme, die nicht mehr noetig ist, soll auffallen,
    // damit die Liste nicht stillschweigend veraltet (z. B. nach einem Pin-Bump).
    const obsolet = Object.keys(BEKANNTE_AUSNAHMEN).filter(key => !verstoesse.some(v => `${v.path}:${v.kind}` === key))
    expect(obsolet, 'Ausnahme nicht mehr noetig — Eintrag aus BEKANNTE_AUSNAHMEN entfernen').toEqual([])
  })

  // REQUIRED-Haelfte (panary/panary-core#289). Bewusst ein eigener Test: Die
  // Ausnahmeliste liegt im Check (nicht hier), ihr Schluessel ist der blosse
  // Service-Pfad, und ihr Zielzustand ist — anders als bei BEKANNTE_AUSNAHMEN —
  // NICHT die leere Liste. Ein Eintrag dort sagt „Pflicht ist fachlich richtig",
  // kein „Fix steht noch aus".
  it('kein Service fuehrt ein gestempeltes Feld unbegruendet als Pflicht', () => {
    const alle = befunde()

    expect(
      unexcusedRequiredViolations(alle).map(v => v.message),
      'Gestempeltes Feld als Pflicht im DATA-Schema — entweder Type.Optional oder ' +
        'Eintrag in REQUIRED_STAMP_EXCEPTIONS mit Begruendung (assert-stamp-fields.ts)',
    ).toEqual([])

    // Die Gegenrichtung ist der eigentliche Grund, warum REQUIRED ueberhaupt
    // ins Gate gehoert: Als reine Boot-Check-Konstante konnte die Liste still
    // veralten — ein Schema wird `Type.Optional`, der Eintrag bleibt, und eine
    // Begruendung, die nichts mehr begruendet, ist genau die Ablage, gegen die
    // der Kopfkommentar der Liste argumentiert.
    const mitRequired = new Set(alle.filter(v => v.required.length > 0).map(v => v.path))
    expect(
      Object.keys(REQUIRED_STAMP_EXCEPTIONS).filter(path => !mitRequired.has(path)),
      'Ausnahme nicht mehr noetig — Eintrag aus REQUIRED_STAMP_EXCEPTIONS entfernen',
    ).toEqual([])
  })

  // ABDECKUNG statt Befund. Dieser Test ist der eigentliche Regressionsschutz
  // fuer #183 und fuer das Risiko des Marker-Musters: Bricht es (Feathers-Update,
  // neuer Service, der `schemaHooks.validateData` direkt benutzt), faellt der
  // Check still auf `docs.schemas` zurueck oder prueft gar nichts — ohne diesen
  // Test bliebe das unsichtbar, weil ein blinder Check dieselbe leere
  // Befundliste liefert wie ein sauberer Stand.
  it('jeder Service mit multiTenancy() wird auf BEIDEN Seiten aus dem Hook geprueft', () => {
    const app = makeApp()
    services(app as never)

    const luecken = collectStampTargets(app as never)
      .filter(t => t.mtOptions !== null && t.methodRegistered && t.source !== 'hook')
      .filter(t => !(`${t.path}:${t.kind}` in BEKANNTE_LUECKEN))
      .map(t => `${t.path}:${t.kind} (Quelle: ${t.source})`)

    expect(
      luecken,
      'Schreib-Methode ohne markiertes Schema — validateData() aus hooks/validate-data.hook.ts benutzen',
    ).toEqual([])

    // Gegenrichtung wie bei den Ausnahmen: eine Luecke, die inzwischen
    // geschlossen ist, soll auffallen statt still zu veralten.
    const offeneLuecken = new Set(
      collectStampTargets(app as never)
        .filter(t => t.mtOptions !== null && t.methodRegistered && t.source !== 'hook')
        .map(t => `${t.path}:${t.kind}`),
    )
    expect(
      Object.keys(BEKANNTE_LUECKEN).filter(key => !offeneLuecken.has(key)),
      'Luecke geschlossen — Eintrag aus BEKANNTE_LUECKEN entfernen',
    ).toEqual([])

    // Und die Grundmenge selbst darf nicht wegbrechen: Waere `services()` kaputt
    // oder der multiTenancy-Marker unlesbar, waere die Lueckenliste ebenfalls
    // leer — gruen, ohne etwas gemessen zu haben. Gemessen am 2026-09-12:
    // 31 Services, 25 davon mit `multiTenancy()`, 45 von 50 Pruefzielen aus dem
    // Hook (die uebrigen 5 sind die beiden Luecken oben plus drei Methoden, die
    // der Service gar nicht anbietet). Die Schwelle liegt bewusst darunter —
    // sie soll den Totalausfall fangen, nicht bei jedem neuen Service reissen.
    const geprueft = collectStampTargets(app as never).filter(t => t.mtOptions !== null && t.source === 'hook')
    expect(geprueft.length).toBeGreaterThanOrEqual(40)
  })
})
