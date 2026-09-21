import { describe, expect, it } from 'vitest'

import type { PaperWidth } from './escpos.adapter'
import { centerOffsetDots, decodeEscPosLines } from '../../test/escpos-layout'
import { receiptVariantForRole, renderOrderReceipt, type OrderReceiptOptions } from './order-receipt.renderer'

// Die Encoder-Ausgabe ist ESC/POS-Binärstrom — der Zellentext liegt darin als
// Klartext. Fuer die Assertions reicht dekodieren + Steuerzeichen verwerfen.
const renderToText = (
  order: Record<string, unknown>,
  location: Record<string, unknown>,
  options: OrderReceiptOptions = {},
): string => {
  const bytes = renderOrderReceipt(order, location, options)
  // eslint-disable-next-line no-control-regex
  return new TextDecoder('latin1').decode(bytes).replace(/[\x00-\x1f]/g, ' ')
}

const location = {
  settings: {
    genericProductSettings: {
      generalDrinkPrice: 3.5,
      generalSideDishPrice: 1.0,
    },
  },
}

const buildMenuOrder = (amount: number, overrides: Record<string, unknown> = {}) => ({
  dailySequenceNumber: 42,
  dineLocation: 'dine-in',
  recordingDate: '2026-07-06T10:00:00.000Z',
  lineItems: [
    {
      _id: 'li-1',
      name: 'Schnitzel-Menue',
      topic: 'Menues',
      amount,
      price: 12.9,
      taxInside: 19,
      taxOutside: 7,
      isMenu: true,
      menuSideDish: { name: 'Suesskartoffel-Pommes', price: 1.5, amount: 1, taxInside: 19, taxOutside: 7 },
      menuDrink: { name: 'Hauslimo', price: 3.5, amount: 1, taxInside: 19, taxOutside: 7 },
      ...overrides,
    },
  ],
})

describe('order-receipt.renderer — Menü-Sub-Zeilen', () => {
  it('weist den Beilagen-Aufpreis bei Menge 1 einmalig aus', () => {
    const text = renderToText(buildMenuOrder(1), location)
    // Aufpreis = 1,50 − 1,00 (General-Preis) = 0,50
    expect(text).toContain('+ Suesskartoffel-Pommes')
    expect(text).toContain('0,50 EUR')
  })

  it('skaliert den Beilagen-Aufpreis mit der Menü-Menge (×amount)', () => {
    const text = renderToText(buildMenuOrder(2), location)
    // 2 Menüs × 0,50 Aufpreis = 1,00 — derselbe Betrag, den lineItemGrossCents
    // in die Zeilensumme einrechnet.
    expect(text).toContain('1,00 EUR')
    expect(text).not.toContain('0,50 EUR')
  })

  it('weist für Getränke auf General-Preis-Niveau keinen Aufpreis aus', () => {
    const text = renderToText(buildMenuOrder(2), location)
    expect(text).toContain('+ Hauslimo')
    expect(text).not.toContain('3,50 EUR')
  })

  it('weist bei FIXED_PROPORTIONAL keine Komponenten-Aufpreise aus', () => {
    const text = renderToText(buildMenuOrder(2, { bundlePricingMode: 'FIXED_PROPORTIONAL' }), location)
    expect(text).toContain('+ Suesskartoffel-Pommes')
    expect(text).not.toContain('0,50 EUR')
    expect(text).not.toContain('1,00 EUR')
  })

  it('skaliert zusätzlich mit der Komponenten-Menge (component.amount × line.amount)', () => {
    const order = buildMenuOrder(2, {
      menuSideDish: { name: 'Suesskartoffel-Pommes', price: 1.5, amount: 2, taxInside: 19, taxOutside: 7 },
    })
    const text = renderToText(order, location)
    // 2 Komponenten × 2 Menüs × 0,50 = 2,00
    expect(text).toContain('2,00 EUR')
  })
})

// Die Order aus der Live-Verifikation #182: 2× Nuggets (7 %) + 1× Apfelschorle (19 %)
// = 11,90 € Positionen, 20 % Nachlass = 2,38 €, Gesamt 9,52 €.
const LINE_NUGGETS = '00000000-0000-0000-0000-0000000000a1'

const buildDiscountOrder = (appliedDiscounts: Record<string, unknown>[]) => ({
  dailySequenceNumber: 43,
  dineLocation: 'dine-in',
  recordingDate: '2026-08-14T10:00:00.000Z',
  lineItems: [
    { _id: LINE_NUGGETS, name: 'Nuggets', topic: 'Speisen', amount: 2, price: 3.5, taxInside: 7, taxOutside: 7 },
    {
      _id: '00000000-0000-0000-0000-0000000000a2',
      name: 'Apfelschorle',
      topic: 'Getraenke',
      amount: 1,
      price: 4.9,
      taxInside: 19,
      taxOutside: 19,
    },
  ],
  appliedDiscounts,
})

// `computedAmountCents: 0` ist Absicht: Die Beträge füllt `computeOrderTax` als
// Seiteneffekt. Käme der Nachlass-Block VOR dem Summen-Lauf, stünde hier weiter 0 —
// die Zeile fiele als „wirkungslos" heraus und der Test wäre rot. Genau die
// Reihenfolge-Falle aus #235.
const makeApplied = (partial: Record<string, unknown>) => ({
  _id: '00000000-0000-0000-0000-0000000000d1',
  name: 'Rabatt',
  method: 'manual',
  target: 'order',
  valueType: 'percent',
  valuePercent: 0,
  valueCents: 0,
  computedAmountCents: 0,
  appliedAt: '2026-08-14T10:00:00.000Z',
  ...partial,
})

describe('order-receipt.renderer — Nachlass', () => {
  it('weist einen Order-Rabatt zwischen Positionen und Gesamt aus', () => {
    const order = buildDiscountOrder([makeApplied({ name: '20 % Rabatt', valuePercent: 20 })])
    const text = renderToText(order, location)

    // Positionen unrabattiert, Nachlass negativ, Gesamt rabattiert — 11,90 − 2,38 = 9,52
    expect(text).toContain('7,00 EUR')
    expect(text).toContain('4,90 EUR')
    expect(text).toContain('Nachlass: 20 % Rabatt')
    expect(text).toContain('-2,38 EUR')
    expect(text).toContain('9,52 EUR')
    expect(text.indexOf('Nachlass: 20 % Rabatt')).toBeLessThan(text.indexOf('Gesamt'))
  })

  it('nennt den Rabattnamen beim Personalessen', () => {
    const order = buildDiscountOrder([makeApplied({ name: 'Personalessen', valuePercent: 100, isStaffMeal: true })])
    const text = renderToText(order, location)

    expect(text).toContain('Nachlass: Personalessen')
    expect(text).toContain('-11,90 EUR')
    expect(text).toContain('0,00 EUR')
  })

  it('weist Positions- und Order-Rabatt als je eigene Zeile aus', () => {
    const order = buildDiscountOrder([
      makeApplied({
        _id: '00000000-0000-0000-0000-0000000000d2',
        name: 'Kulanz Nuggets',
        target: 'line',
        lineItemId: LINE_NUGGETS,
        valueType: 'amount',
        valueCents: 100,
      }),
      makeApplied({ name: '10 % Stammgast', valuePercent: 10 }),
    ])
    const text = renderToText(order, location)

    // LINE zuerst: 11,90 − 1,00 = 10,90; danach ORDER 10 % = 1,09 → Gesamt 9,81
    expect(text).toContain('Nachlass: Kulanz Nuggets')
    expect(text).toContain('-1,00 EUR')
    expect(text).toContain('Nachlass: 10 % Stammgast')
    expect(text).toContain('-1,09 EUR')
    expect(text).toContain('9,81 EUR')
  })

  it('unterdrückt wirkungslose Rabatte (0 ct)', () => {
    const order = buildDiscountOrder([makeApplied({ name: 'Leerer Rabatt', valuePercent: 0 })])
    const text = renderToText(order, location)

    expect(text).not.toContain('Nachlass')
    expect(text).toContain('11,90 EUR')
  })

  it('faellt bei leerem Rabattnamen auf „Nachlass" zurück', () => {
    const order = buildDiscountOrder([makeApplied({ name: '   ', valuePercent: 20 })])
    const text = renderToText(order, location)

    expect(text).toContain('Nachlass: Nachlass')
    expect(text).toContain('-2,38 EUR')
  })

  it('druckt ohne Rabatt keine Nachlasszeile', () => {
    const text = renderToText(buildDiscountOrder([]), location)

    expect(text).not.toContain('Nachlass')
    expect(text).toContain('11,90 EUR')
  })
})

// #274: Der Bon druckte die Uhrzeit in der Zeitzone des Node-Prozesses. Im
// Container (kein `TZ`) ist das UTC — im Sommer zwei Stunden zu frueh. Alle
// Erwartungswerte hier sind deshalb bewusst an Zonen geknuepft, die weder mit der
// Entwicklungs- (Europe/Berlin) noch mit der CI-Zone (UTC) zusammenfallen: faellt
// die Formatierung auf die Prozesszeit zurueck, wird die Spec rot.
describe('order-receipt.renderer — Zeitzone der Filiale (#274)', () => {
  const zeitOrder = (overrides: Record<string, unknown> = {}) => ({
    ...buildMenuOrder(1),
    recordingDate: '2026-07-06T10:00:00.000Z',
    ...overrides,
  })

  const locationInZone = (timezone: string) => ({
    settings: { ...location.settings, generalSettings: { timezone } },
  })

  it('druckt die Uhrzeit in der Zone der Filiale', () => {
    expect(renderToText(zeitOrder(), locationInZone('America/New_York'))).toContain('Bestellzeit: 06:00 Uhr')
    expect(renderToText(zeitOrder(), locationInZone('UTC'))).toContain('Bestellzeit: 10:00 Uhr')
    expect(renderToText(zeitOrder(), locationInZone('Europe/Berlin'))).toContain('Bestellzeit: 12:00 Uhr')
  })

  it('nutzt ohne gepflegte Zone den Geschaeftstag-Default (Europe/Berlin)', () => {
    // `location` traegt keine `generalSettings` — derselbe Fallback wie Rotation,
    // Slots und Vorbestellungen, keine zweite Konstante.
    expect(renderToText(zeitOrder(), location)).toContain('Bestellzeit: 12:00 Uhr')
  })

  it('rechnet das Bon-Datum ueber die Tagesgrenze in Filialzeit', () => {
    const spaet = zeitOrder({ recordingDate: '2026-07-06T23:30:00.000Z' })
    expect(renderToText(spaet, locationInZone('Europe/Berlin'))).toContain('Datum: 7.7.2026')
    expect(renderToText(spaet, locationInZone('UTC'))).toContain('Datum: 6.7.2026')
  })

  it('druckt auch die Storno-Zeile in Filialzeit', () => {
    const storniert = zeitOrder({
      cancellation: { reason: 'Falsch gebucht', canceledAt: '2026-07-06T10:00:00.000Z' },
    })
    expect(renderToText(storniert, locationInZone('America/New_York'))).toContain('Storniert am: 6.7.2026, 06:00:00')
  })
})

// #342: Der Kopfbereich war bis hierher komplett ungetestet — weder Filialkopf
// noch Badge noch Zentrierung hatten eine Assertion. Genau deshalb ist der
// Zentrierungsfehler aus der Kundenmeldung nie aufgefallen.
describe('order-receipt.renderer — Kopfbereich (#342)', () => {
  const locationMitKopf = {
    name: 'Koetters Fritte',
    address: { street: 'Dahler Strasse 35', postalCode: '58091', city: 'Hagen' },
    phone: '02331 1234567',
    settings: { ...location.settings, generalSettings: { timezone: 'Europe/Berlin' } },
  }

  const kopfOrder = (overrides: Record<string, unknown> = {}) => ({
    dailySequenceNumber: 1458,
    dineLocation: 'take-out',
    recordingDate: '2026-09-20T10:00:00.000Z',
    estimatedDuration: 15,
    lineItems: [
      { _id: 'li-k1', name: 'Nuggets', topic: 'Speisen', amount: 1, price: 3.5, taxInside: 7, taxOutside: 7 },
    ],
    ...overrides,
  })

  const kopfZeilen = (
    order: Record<string, unknown>,
    loc: Record<string, unknown>,
    paperWidth: PaperWidth = '80mm',
    variant: 'kitchen' | 'full' = 'kitchen',
  ) => decodeEscPosLines(renderOrderReceipt(order, loc, { paperWidth, variant }), 10)

  describe('Filialkopf entfaellt auf dem Kuechenbon (#347)', () => {
    it('druckt weder Name noch Strasse noch PLZ/Ort noch Telefonnummer', () => {
      const text = renderToText(kopfOrder(), locationMitKopf, { variant: 'kitchen' })

      expect(text).not.toContain('Koetters Fritte')
      expect(text).not.toContain('Dahler Strasse')
      expect(text).not.toContain('58091')
      expect(text).not.toContain('Hagen')
      expect(text).not.toContain('Tel.')
    })

    it('beginnt mit der Bestellnummer statt mit einer Leerflaeche', () => {
      const zeilen = kopfZeilen(kopfOrder(), locationMitKopf)
      const erste = zeilen.findIndex(z => z.text.trim().length > 0)

      // Genau eine Leerzeile Vorlauf: Sie flusht die `initialize()`-Bytes, bevor
      // die erste zentrierte Zeile ihre Polsterung ausstellt. Ohne sie liefen die
      // Leerzeichen noch im Zustand des vorherigen Druckauftrags.
      expect(erste).toBe(1)
      expect(zeilen[erste].text.trim()).toBe('Bestellnummer')
    })
  })

  describe('Abholzeit unter dem Badge', () => {
    it('druckt bei Fertigungszeit die Uhrzeit in Filialzeit, mit Praefix', () => {
      // 12:00 Ortszeit (10:00 UTC) + 15 min
      expect(renderToText(kopfOrder(), locationMitKopf)).toContain('Abholung 12:15')
    })

    it('rechnet die Abholzeit in der Zone der Filiale, nicht der des Prozesses', () => {
      const inZone = (timezone: string) => ({
        ...locationMitKopf,
        settings: { ...location.settings, generalSettings: { timezone } },
      })

      expect(renderToText(kopfOrder(), inZone('America/New_York'))).toContain('Abholung 06:15')
      expect(renderToText(kopfOrder(), inZone('UTC'))).toContain('Abholung 10:15')
    })

    // Die Zeile ist die groesste nach der Bestellnummer; ihre Breite richtet sich
    // danach, was noch in EINE Zeile passt. Bei dreifacher Breite braeche
    // `Abholung 12:15` auf 58 mm in zwei Zeilen um — dann stuende „Abholung" ueber
    // „12:15" und saehe aus wie ein Versehen.
    it.each([
      ['80mm', 48],
      ['58mm', 32],
    ] as const)('legt die Abholzeit auf %s in genau eine Zeile', (paperWidth, columns) => {
      const zeilen = kopfZeilen(kopfOrder(), locationMitKopf, paperWidth)
      const treffer = zeilen.filter(z => z.text.includes('Abholung') || z.text.includes('12:15'))

      expect(treffer).toHaveLength(1)
      expect(treffer[0].text.trim()).toBe('Abholung 12:15')
      expect(Math.abs(centerOffsetDots(treffer[0], columns))).toBeLessThanOrEqual(treffer[0].charDots)
    })

    it('druckt die Abholzeit groesser als das Badge darueber', () => {
      const zeilen = kopfZeilen(kopfOrder(), locationMitKopf)
      const badge = zeilen.find(z => z.text.includes('AUSSEN'))
      const abholzeit = zeilen.find(z => z.text.includes('Abholung'))

      // charDots ist die Zellenbreite — bei gleicher Breite entscheidet die Hoehe,
      // die der Decoder nicht misst. Auf 80 mm ist die Abholzeit dreifach breit,
      // das Badge doppelt, der Vergleich traegt also.
      expect(abholzeit!.charDots).toBeGreaterThan(badge!.charDots)
    })

    it('druckt SOFORT bei Fertigungszeit 0 — und keine Uhrzeit an dessen Stelle', () => {
      const zeilen = kopfZeilen(kopfOrder({ estimatedDuration: 0 }), locationMitKopf)
      const badge = zeilen.findIndex(z => z.text.includes('AUSSEN'))

      expect(badge).toBeGreaterThan(-1)
      // Die Zeile unter dem Badge traegt SOFORT und nichts Uhrzeitfoermiges. Die
      // Bestellzeit im Metablock bleibt davon unberuehrt — sie ist ein anderes
      // Datum und steht weiter unten.
      // Ohne Fertigungszeit gibt es nichts zu praefixieren — „Abholung SOFORT"
      // waere eine Zeitangabe, die keine ist.
      expect(zeilen[badge + 1].text.trim()).toBe('SOFORT')
      expect(zeilen[badge + 1].text).not.toMatch(/\d{1,2}:\d{2}/)
      expect(renderToText(kopfOrder({ estimatedDuration: 0 }), locationMitKopf)).toContain('Bestellzeit: 12:00 Uhr')
    })

    it('druckt SOFORT, wenn die Fertigungszeit ganz fehlt', () => {
      const ohne = kopfOrder()
      delete (ohne as Record<string, unknown>).estimatedDuration

      expect(renderToText(ohne, locationMitKopf)).toContain('SOFORT')
    })

    it('steht unter dem Bestellart-Badge, nicht darueber', () => {
      const text = renderToText(kopfOrder(), locationMitKopf)

      expect(text.indexOf('AUSSEN')).toBeGreaterThan(-1)
      expect(text.indexOf('AUSSEN')).toBeLessThan(text.indexOf('12:15'))
    })

    it('druckt INNEN fuer dine-in', () => {
      expect(renderToText(kopfOrder({ dineLocation: 'dine-in' }), locationMitKopf)).toContain('INNEN')
    })
  })

  describe('Metablock', () => {
    it('weist die Registrierungszeit als „Bestellzeit" aus', () => {
      const text = renderToText(kopfOrder(), locationMitKopf)

      expect(text).toContain('Bestellzeit: 12:00 Uhr')
      expect(text).not.toContain('Uhrzeit:')
      expect(text).toContain('Datum: 20.9.2026')
    })
  })

  // Die eigentliche Messung: sitzt die Zeile auf dem PAPIER mittig? Die Anzahl
  // der Leerzeichen allein beweist das nicht — sie wird in den Spalten des Fonts
  // gezaehlt, der fuer den Text gilt, und die Polsterung selbst kann in einer
  // anderen Zellenbreite gedruckt werden (das war der Fehler in #342).
  describe('Zentrierung, in Dots gemessen', () => {
    it.each([
      ['80mm', 48],
      ['58mm', 32],
    ] as const)('setzt die Abholzeit auf %s mittig', (paperWidth, columns) => {
      const zeilen = kopfZeilen(kopfOrder(), locationMitKopf, paperWidth)
      const abholzeit = zeilen.find(z => z.text.includes('12:15'))

      expect(abholzeit).toBeDefined()
      // Toleranz: eine Zellenbreite. Der Encoder rundet die halbe Restbreite ab
      // (`>> 1`), mehr als eine Zelle Versatz ist deshalb nie Rundung.
      expect(Math.abs(centerOffsetDots(abholzeit!, columns))).toBeLessThanOrEqual(abholzeit!.charDots)
    })

    it.each([
      ['80mm', 48],
      ['58mm', 32],
    ] as const)('setzt SOFORT, Badge und Bestellnummer auf %s mittig', (paperWidth, columns) => {
      const zeilen = kopfZeilen(kopfOrder({ estimatedDuration: 0 }), locationMitKopf, paperWidth)

      for (const suche of ['Bestellnummer', '1458', 'AUSSEN', 'SOFORT']) {
        const zeile = zeilen.find(z => z.text.includes(suche))
        expect(zeile, `Zeile „${suche}" nicht gefunden`).toBeDefined()
        expect(Math.abs(centerOffsetDots(zeile!, columns)), `Zeile „${suche}" nicht mittig`).toBeLessThanOrEqual(
          zeile!.charDots,
        )
      }
    })
  })
})

describe('order-receipt.renderer — Druckerrolle und Bon-Variante (#347)', () => {
  const filiale = {
    name: 'Koetters Fritte',
    address: { street: 'Dahler Strasse 35', postalCode: '58091', city: 'Hagen' },
    phone: '02331 1234567',
    settings: { ...location.settings, generalSettings: { timezone: 'Europe/Berlin' } },
  }

  // `signed` ist die einzige Form, die QR-Code UND Signaturzeilen erzeugt —
  // damit misst der Test die groesste Differenz zwischen den Varianten.
  const tse = {
    status: 'signed',
    transactionNumber: 4711,
    signatureCounter: 815,
    logTime: '2026-09-20T12:00:05.000Z',
    signatureValue: 'AAECAwQFBgcICQ==',
    simulated: false,
  }

  const bonOrder = (overrides: Record<string, unknown> = {}) => ({
    dailySequenceNumber: 1458,
    dineLocation: 'take-out',
    recordingDate: '2026-09-20T10:00:00.000Z',
    estimatedDuration: 15,
    lineItems: [
      { _id: 'li-r1', name: 'Nuggets', topic: 'Speisen', amount: 2, price: 3.5, taxInside: 7, taxOutside: 7 },
      { _id: 'li-r2', name: 'Pommes', topic: 'Speisen', amount: 1, price: 2.9, taxInside: 7, taxOutside: 7 },
    ],
    ...overrides,
  })

  describe('receiptVariantForRole — der Bestands-Default', () => {
    // 🚨 Der teuerste Fehler dieses Features waere, `undefined` als `kitchen` zu
    // werten: Jede Bestandsinstallation verloere still Filialkopf und TSE-Block
    // vom Kundenbeleg. Deshalb steht hier jeder Eingabewert einzeln.
    it.each([
      [undefined, 'full'],
      [null, 'full'],
      ['both', 'full'],
      ['receipt', 'full'],
      ['kitchen', 'kitchen'],
      ['', 'full'],
      ['KITCHEN', 'full'],
      ['kueche', 'full'],
    ] as const)('%s → %s', (role, erwartet) => {
      expect(receiptVariantForRole(role)).toBe(erwartet)
    })
  })

  describe('Filialkopf', () => {
    it('druckt Name, Strasse, PLZ/Ort und Telefon auf dem Vollbon', () => {
      const text = renderToText(bonOrder(), filiale, { variant: 'full' })

      expect(text).toContain('Koetters Fritte')
      expect(text).toContain('Dahler Strasse 35')
      expect(text).toContain('58091 Hagen')
      expect(text).toContain('Tel. 02331 1234567')
    })

    it('laesst ihn auf dem Kuechenbon vollstaendig weg', () => {
      const text = renderToText(bonOrder(), filiale, { variant: 'kitchen' })

      for (const teil of ['Koetters Fritte', 'Dahler Strasse', '58091', 'Hagen', 'Tel.']) {
        expect(text, `„${teil}" gehoert nicht auf den Kuechenbon`).not.toContain(teil)
      }
    })

    it('ist der Default — ohne Variante rendert der Vollbon', () => {
      expect(renderToText(bonOrder(), filiale)).toContain('Dahler Strasse 35')
    })

    it('steht ueber der Bestellnummer, nicht darunter', () => {
      const text = renderToText(bonOrder(), filiale, { variant: 'full' })

      expect(text.indexOf('Koetters Fritte')).toBeLessThan(text.indexOf('Bestellnummer'))
      expect(text.indexOf('Tel. 02331')).toBeLessThan(text.indexOf('Bestellnummer'))
    })

    it.each([
      ['80mm', 48],
      ['58mm', 32],
    ] as const)('setzt jede Kopfzeile auf %s mittig — in Dots gemessen', (paperWidth, columns) => {
      // Die Messung in Dots ist der Kern: Der alte Kopf vor #342 hatte in JEDER
      // Zeile dieselbe Anzahl Leerzeichen und war trotzdem verschoben, weil ihre
      // BREITE falsch war (Font A statt Font B). Eine Assertion auf den Text
      // haette das durchgewunken — genau daran fiel der Fehler monatelang nicht
      // auf, weil der Kopfbereich ungetestet war.
      const zeilen = decodeEscPosLines(renderOrderReceipt(bonOrder(), filiale, { paperWidth, variant: 'full' }), 12)

      for (const suche of ['Koetters Fritte', 'Dahler Strasse 35', '58091 Hagen', 'Tel. 02331 1234567']) {
        const zeile = zeilen.find(z => z.text.includes(suche))
        expect(zeile, `Zeile „${suche}" nicht gefunden`).toBeDefined()
        expect(Math.abs(centerOffsetDots(zeile!, columns)), `Zeile „${suche}" nicht mittig`).toBeLessThanOrEqual(
          zeile!.charDots,
        )
      }
    })

    it('erzeugt ohne Filial-Stammdaten keinen leeren Kopf', () => {
      const zeilen = decodeEscPosLines(
        renderOrderReceipt(bonOrder(), { settings: location.settings }, { variant: 'full' }),
        10,
      )
      const erste = zeilen.findIndex(z => z.text.trim().length > 0)

      expect(erste).toBe(1)
      expect(zeilen[erste].text.trim()).toBe('Bestellnummer')
    })

    it('laesst eine fehlende Telefonnummer weg statt ein nacktes „Tel." zu drucken', () => {
      const ohneTelefon = { ...filiale, phone: '   ' }
      const text = renderToText(bonOrder(), ohneTelefon, { variant: 'full' })

      expect(text).toContain('58091 Hagen')
      expect(text).not.toContain('Tel.')
    })
  })

  describe('TSE-Block', () => {
    it('steht auf dem Vollbon', () => {
      const text = renderToText(bonOrder({ tse }), filiale, { variant: 'full' })

      expect(text).toContain('TSE-Signatur')
      expect(text).toContain('Transaktion: 4711')
      expect(text).toContain('815')
    })

    it('fehlt auf dem Kuechenbon', () => {
      const text = renderToText(bonOrder({ tse }), filiale, { variant: 'kitchen' })

      expect(text).not.toContain('TSE-Signatur')
      expect(text).not.toContain('Transaktion: 4711')
    })

    it('laesst auch den Ausfallhinweis (§146a) auf dem Kuechenbon weg', () => {
      const ausfall = { tse: { status: 'unavailable', transactionNumber: 4712 } }

      // Assertion auf reines ASCII: Der Strom ist latin1-dekodiert, der Encoder
      // schreibt Sonderzeichen aber in seiner eigenen Codepage.
      expect(renderToText(bonOrder(ausfall), filiale, { variant: 'full' })).toContain('nachsigniert')
      expect(renderToText(bonOrder(ausfall), filiale, { variant: 'kitchen' })).not.toContain('nachsigniert')
    })

    it('macht den Kuechenbon messbar kuerzer — der QR-Code faellt weg', () => {
      const voll = renderOrderReceipt(bonOrder({ tse }), filiale, { variant: 'full' })
      const kueche = renderOrderReceipt(bonOrder({ tse }), filiale, { variant: 'kitchen' })

      expect(kueche.length).toBeLessThan(voll.length)
    })
  })

  describe('Was in BEIDEN Varianten gleich bleibt', () => {
    // Der Kuechenbon behaelt Preise und Summen — bewusst entschieden (#347):
    // Die Kueche soll sehen, was der Gast zahlt. Unterschied sind allein
    // Filialkopf und TSE-Block. Faellt dieser Test, hat die Variante an der
    // Rechnung gedreht, und das darf sie nie.
    const posten = ['Nuggets', 'Pommes', '2x', 'Gesamt']

    it.each(posten)('druckt „%s" auf beiden Varianten', teil => {
      expect(renderToText(bonOrder(), filiale, { variant: 'full' })).toContain(teil)
      expect(renderToText(bonOrder(), filiale, { variant: 'kitchen' })).toContain(teil)
    })

    it('weist dieselbe Gesamtsumme aus', () => {
      // 2 × 3,50 + 1 × 2,90 = 9,90
      expect(renderToText(bonOrder(), filiale, { variant: 'full' })).toContain('9,90')
      expect(renderToText(bonOrder(), filiale, { variant: 'kitchen' })).toContain('9,90')
    })

    it('weist einen Nachlass in beiden Varianten identisch aus', () => {
      const mitRabatt = bonOrder({
        appliedDiscounts: [makeApplied({ name: 'Personalessen', valuePercent: 50 })],
      })

      for (const variant of ['full', 'kitchen'] as const) {
        const text = renderToText(mitRabatt, filiale, { variant })
        // 9,90 − 50 % = 4,95
        expect(text, `Nachlasszeile fehlt auf ${variant}`).toContain('Nachlass: Personalessen')
        expect(text, `Nachlassbetrag falsch auf ${variant}`).toContain('-4,95 EUR')
        expect(text, `Gesamtsumme falsch auf ${variant}`).toContain('4,95 EUR')
      }
    })

    it('unterscheidet sich zwischen den Varianten AUSSCHLIESSLICH um Kopf und TSE', () => {
      // Gegenprobe zur Aufzaehlung oben: Eine Filiale ohne Stammdaten und eine
      // Order ohne TSE lassen beide Varianten byte-identisch werden. Faellt das,
      // schaltet die Variante noch etwas Drittes, das niemand benannt hat.
      const ohneKopf = { settings: location.settings }
      const voll = renderOrderReceipt(bonOrder(), ohneKopf, { variant: 'full' })
      const kueche = renderOrderReceipt(bonOrder(), ohneKopf, { variant: 'kitchen' })

      expect(Array.from(kueche)).toEqual(Array.from(voll))
    })
  })
})
