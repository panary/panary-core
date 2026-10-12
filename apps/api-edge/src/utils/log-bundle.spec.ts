// Sperre fuer die Allowlist des Support-Log-Exports.
//
// Die Liste ist eine Sicherheits- UND eine Diagnose-Entscheidung, und beide
// Richtungen koennen still kaputtgehen:
//
//   - Zu viel  → PII/Geschaeftsdaten wandern an externen Support.
//   - Zu wenig → eine Suche im Export liefert 0 Treffer und wird als „nie
//     geloggt" gelesen. Genau das ist am 2026-09-12 passiert
//     (panary/panary-core#293): `event` fehlte, `grep sync.conflict.apply_failed`
//     fand nichts, die Zeile stand aber da — nur ohne ihren Namen.
//
// Die zweite Richtung hat vorher niemand getestet, weil ein fehlendes Feld
// keinen Fehler erzeugt. Deshalb wird hier BEIDES festgenagelt: was
// durchkommt und was nicht.

import { describe, expect, it } from 'vitest'

import { SAFE_LOG_FIELDS, scrubLogEntry } from './log-bundle'

/** Eine realistische Wide-Event-Zeile plus die Felder, die draussen bleiben muessen. */
const rohzeile = {
  timestamp: '2026-09-12T22:24:13.752Z',
  level: 'warn',
  message: 'Konflikt-Aufloesung konnte nicht angewandt werden — Konflikt bleibt offen',
  event: 'sync.conflict.apply_failed',
  service: 'working-times',
  errorMessage: 'Der Cloud-Stand wurde nur teilweise uebernommen: checkinDate',
  // — ab hier: darf NICHT ins Bundle —
  businessContext: { grossAmount: 2850, customerName: 'Meier' },
  requestData: { posPin: '1234' },
  errorStack: 'Error: …\n    at foo (bar.ts:1:1)',
  validationErrors: [{ params: { additionalProperty: 'geheim' } }],
  conflictId: '01a097b8-1c2f-7064-aea0-6c9e6b227977',
}

describe('scrubLogEntry', () => {
  it('behaelt den Event-Namen — sonst ist die Zeile im Export nicht adressierbar', () => {
    expect(scrubLogEntry(rohzeile).event).toBe('sync.conflict.apply_failed')
  })

  it('behaelt die diagnostischen Felder der Wide Events', () => {
    const out = scrubLogEntry(rohzeile)
    expect(out.timestamp).toBe('2026-09-12T22:24:13.752Z')
    expect(out.level).toBe('warn')
    expect(out.service).toBe('working-times')
    expect(out.errorMessage).toContain('checkinDate')
    expect(out.message).toContain('Konflikt bleibt offen')
  })

  it('entfernt Nutzdaten, Request-Bodies, Stacks und Validierungsdetails', () => {
    const out = scrubLogEntry(rohzeile)
    for (const feld of ['businessContext', 'requestData', 'errorStack', 'validationErrors']) {
      expect(out, `${feld} darf nicht im Support-Bundle landen`).not.toHaveProperty(feld)
    }
    // Gegenprobe auf dem serialisierten Ergebnis: kein Wert darf durchsickern,
    // auch nicht verschachtelt.
    const json = JSON.stringify(out)
    for (const wert of ['Meier', '1234', 'geheim', 'bar.ts']) {
      expect(json, `Wert „${wert}" ist durchgesickert`).not.toContain(wert)
    }
  })

  it('laesst unbekannte Zusatzfelder weg — die Liste ist Allowlist, nicht Denylist', () => {
    // `conflictId` ist harmlos, steht aber nicht drauf. Der Test haelt fest, dass
    // das eine bewusste Entscheidung ist und nicht zufaellig durchrutscht: Wer
    // ein Feld im Export braucht, traegt es ein.
    expect(scrubLogEntry(rohzeile)).not.toHaveProperty('conflictId')
  })

  it('erfindet keine Felder, wenn die Rohzeile sie nicht hat', () => {
    expect(scrubLogEntry({ timestamp: 't', level: 'info' })).toEqual({ timestamp: 't', level: 'info' })
  })

  it('legt keine Phantom-Schluessel an', () => {
    // `if (raw[key] !== undefined)` haelt das Ergebnis-Objekt auf die Felder
    // begrenzt, die die Rohzeile wirklich hatte.
    //
    // ⚠️ Bewusst ueber `Object.keys` geprueft, nicht ueber `toEqual`: Vitest
    // behandelt `{ a: 1, b: undefined }` und `{ a: 1 }` als gleich, und
    // `JSON.stringify` wirft `undefined` ohnehin weg — ein `toEqual` bliebe
    // also auch dann gruen, wenn der Guard faellt (in der Mutationsprobe am
    // 2026-09-12 genau so passiert). Auf das NDJSON hat der Guard keine
    // Wirkung; er haelt die In-Memory-Form sauber fuer jeden Konsumenten, der
    // ueber die Schluessel laeuft statt zu serialisieren.
    expect(Object.keys(scrubLogEntry({ level: 'info', service: undefined }))).toEqual(['level'])
  })
})

// #674: Am 2026-10-12 nannte der Export fuenfmal „validation failed" am eigenen
// Standort, aber weder Feld noch Datensatz. Fuer verworfene Cloud-Records kommt
// beides jetzt mit — als Struktur, nie als Wert.
describe('scrubLogEntry bei sync.pull.apply_failed', () => {
  const pullZeile = {
    timestamp: '2026-10-12T21:21:23.238Z',
    level: 'warn',
    message: 'Pull-Apply fehlgeschlagen',
    event: 'sync.pull.apply_failed',
    service: 'locations',
    entityId: '019eb340-ce0a-7472-a6fe-99eb1db7f902',
    errorMessage: 'validation failed',
    validationErrors: [
      {
        path: '<root>',
        message: 'must NOT have additional properties',
        keyword: 'additionalProperties',
        params: { additionalProperty: 'currentBusinessDay' },
      },
    ],
  }

  it('behaelt entityId und die Strukturform der Validierungsfehler', () => {
    const out = scrubLogEntry(pullZeile)
    expect(out.entityId).toBe('019eb340-ce0a-7472-a6fe-99eb1db7f902')
    expect(out.validationErrors).toEqual([
      { path: '<root>', keyword: 'additionalProperties', additionalProperty: 'currentBusinessDay' },
    ])
  })

  it('ersetzt alles, was kein Schema-Bezeichner ist, und laesst message/data weg', () => {
    const out = scrubLogEntry({
      ...pullZeile,
      entityId: 'max@example.com',
      validationErrors: [
        {
          instancePath: '/address/max@example.com/0',
          keyword: 'format',
          message: 'zitiert vielleicht 0151 1234567',
          params: { format: 'email', additionalProperty: 'Max Mustermann' },
          data: 'max@example.com',
        },
      ],
    })
    expect(out).not.toHaveProperty('entityId')
    expect(out.validationErrors).toEqual([
      { path: '/address/*/0', keyword: 'format', format: 'email', additionalProperty: '*' },
    ])
    const json = JSON.stringify(out)
    for (const wert of ['max@example.com', 'Mustermann', '0151']) {
      expect(json, `Wert „${wert}" ist durchgesickert`).not.toContain(wert)
    }
  })

  it('gilt nur fuer dieses Event — ein Request-400 bleibt ohne Validierungsdetails', () => {
    const out = scrubLogEntry({ ...pullZeile, event: 'http.request' })
    expect(out).not.toHaveProperty('validationErrors')
    expect(out).not.toHaveProperty('entityId')
  })

  it('behaelt die Zaehler verworfener Bootstrap-Records', () => {
    const out = scrubLogEntry({ event: 'sync.bootstrap.pull_records_rejected', rejectedTotal: 1, total: 1 })
    expect(out).toEqual({ event: 'sync.bootstrap.pull_records_rejected', rejectedTotal: 1, total: 1 })
  })
})

describe('SAFE_LOG_FIELDS', () => {
  it('enthaelt keine Dubletten', () => {
    expect(new Set(SAFE_LOG_FIELDS).size).toBe(SAFE_LOG_FIELDS.length)
  })

  it('fuehrt die vier bewusst ausgeschlossenen Felder nicht', () => {
    // Aus dem Kopfkommentar: diese vier sind die Begruendung fuer die Allowlist.
    // Ein versehentliches Hinzufuegen soll rot werden, nicht durchgehen.
    for (const feld of ['businessContext', 'requestData', 'errorStack', 'validationErrors']) {
      expect(SAFE_LOG_FIELDS as readonly string[], `${feld} gehoert nicht ins Support-Bundle`).not.toContain(feld)
    }
  })
})
