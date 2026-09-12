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
