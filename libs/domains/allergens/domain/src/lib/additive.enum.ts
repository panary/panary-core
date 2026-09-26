import { StringEnum } from '@feathersjs/typebox'

/**
 * Kennzeichnungspflichtige Zusatzstoff-Angaben bei nicht vorverpackten Lebensmitteln (lose Ware,
 * Speisen, Fernabsatz).
 *
 * Quelle: § 5 Abs. 1 LMZDV — Lebensmittelzusatzstoff-Durchführungsverordnung vom 2. Juni 2021
 * (BGBl. I S. 1362), zuletzt geändert durch Art. 4 der Verordnung vom 24. August 2026
 * (BGBl. 2026 I Nr. 243). Wortlaut am 2026-09-26 gegen gesetze-im-internet.de abgeglichen.
 *
 * Ein Code steht für eine Angabe, nicht für einen Stoff: Die Verordnung verlangt die Klasse
 * („mit Farbstoff"), keine E-Nummer. Nr. 4 a–c dürfen die Angaben nach Nr. 2 und 3 wahlweise
 * ersetzen. Nr. 10 (Tafelsüßen, „auf der Grundlage von …") fehlt bewusst — die Angabe braucht die
 * Namen der Süßungsmittel als Freitext und betrifft kein zubereitetes Gericht.
 */
export const ADDITIVES = [
  'COLOURING',
  'PRESERVATIVE',
  'ANTIOXIDANT',
  'NITRITE_CURING_SALT',
  'NITRATE',
  'NITRITE_CURING_SALT_AND_NITRATE',
  'FLAVOUR_ENHANCER',
  'BLACKENED',
  'WAXED',
  'PHOSPHATE',
  'SWEETENER',
  'PHENYLALANINE_SOURCE',
  'LAXATIVE_POLYOLS',
] as const

export type Additive = (typeof ADDITIVES)[number]

export const additiveSchema = StringEnum([...ADDITIVES])

export interface AdditiveCatalogEntry {
  /** Pflichtangabe im Wortlaut der Verordnung — so steht sie beim Gericht. */
  readonly label: string
  /** Anwendungsfall im Wortlaut der Verordnung — wann der Betrieb den Code wählen muss. */
  readonly appliesTo: string
  readonly legalBasis: string
}

export const ADDITIVE_CATALOG: Readonly<Record<Additive, AdditiveCatalogEntry>> = Object.freeze({
  COLOURING: {
    label: 'mit Farbstoff',
    appliesTo: 'bei Lebensmitteln mit Farbstoffen',
    legalBasis: '§ 5 Abs. 1 Nr. 1 LMZDV',
  },
  PRESERVATIVE: {
    // Wahlweise auch „konserviert" — geführt wird die erstgenannte Angabe.
    label: 'mit Konservierungsstoff',
    appliesTo: 'bei Lebensmitteln mit Lebensmittelzusatzstoffen, die zur Konservierung verwendet werden',
    legalBasis: '§ 5 Abs. 1 Nr. 2 LMZDV',
  },
  ANTIOXIDANT: {
    label: 'mit Antioxidationsmittel',
    appliesTo: 'bei Lebensmitteln mit Lebensmittelzusatzstoffen, die als Antioxidationsmittel verwendet werden',
    legalBasis: '§ 5 Abs. 1 Nr. 3 LMZDV',
  },
  NITRITE_CURING_SALT: {
    label: 'mit Nitritpökelsalz',
    appliesTo: 'für Lebensmittel mit Nitritpökelsalz',
    legalBasis: '§ 5 Abs. 1 Nr. 4 Buchst. a LMZDV',
  },
  NITRATE: {
    label: 'mit Nitrat',
    appliesTo: 'für Lebensmittel mit Natrium- oder Kaliumnitrat, auch gemischt',
    legalBasis: '§ 5 Abs. 1 Nr. 4 Buchst. b LMZDV',
  },
  NITRITE_CURING_SALT_AND_NITRATE: {
    label: 'mit Nitritpökelsalz und Nitrat',
    appliesTo: 'für Lebensmittel mit Nitritpökelsalz und Natrium- oder Kaliumnitrat, jeweils auch gemischt',
    legalBasis: '§ 5 Abs. 1 Nr. 4 Buchst. c LMZDV',
  },
  FLAVOUR_ENHANCER: {
    label: 'mit Geschmacksverstärker',
    appliesTo: 'bei Lebensmitteln mit Lebensmittelzusatzstoffen, die als Geschmacksverstärker verwendet werden',
    legalBasis: '§ 5 Abs. 1 Nr. 5 LMZDV',
  },
  BLACKENED: {
    label: 'geschwärzt',
    appliesTo: 'bei Oliven mit Eisen-II-gluconat (E 579) oder Eisen-II-lactat (E 585)',
    legalBasis: '§ 5 Abs. 1 Nr. 6 LMZDV',
  },
  WAXED: {
    label: 'gewachst',
    appliesTo:
      'bei frischem Obst und Gemüse mit Lebensmittelzusatzstoffen der Nummern E 445, E 471, E 473, E 474, E 901 bis E 905 und E 914, die zur Oberflächenbehandlung verwendet werden',
    legalBasis: '§ 5 Abs. 1 Nr. 7 LMZDV',
  },
  PHOSPHATE: {
    label: 'mit Phosphat',
    appliesTo:
      'bei Fleischerzeugnissen mit Lebensmittelzusatzstoffen der Nummern E 338 bis E 341, E 343 und E 450 bis E 452',
    legalBasis: '§ 5 Abs. 1 Nr. 8 LMZDV',
  },
  SWEETENER: {
    label: 'mit Süßungsmittel(n)',
    appliesTo: 'bei Lebensmitteln mit Süßungsmitteln mit Ausnahme von Tafelsüßen',
    legalBasis: '§ 5 Abs. 1 Nr. 9 LMZDV',
  },
  PHENYLALANINE_SOURCE: {
    label: 'enthält eine Phenylalaninquelle',
    appliesTo: 'bei Lebensmitteln mit Aspartam (E 951) oder Aspartam-Acesulfamsalz (E 962)',
    legalBasis: '§ 5 Abs. 1 Nr. 11 LMZDV',
  },
  LAXATIVE_POLYOLS: {
    label: 'kann bei übermäßigem Verzehr abführend wirken',
    appliesTo:
      'bei Lebensmitteln mit über 10 Prozent zugesetzten, mehrwertigen Alkoholen der Nummern E 420, E 421, E 953 und E 965 bis E 968',
    legalBasis: '§ 5 Abs. 1 Nr. 12 LMZDV',
  },
})
