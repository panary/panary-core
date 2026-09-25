import { addFormats, Ajv } from '@feathersjs/schema'
import { describe, expect, it } from 'vitest'

import { ADDITIVE_CATALOG, ADDITIVES, additiveSchema } from './additive.enum'

// Sperr-Spec für den Zusatzstoff-Katalog (#393). Die Pflichtangaben stehen hier ein zweites Mal
// im Wortlaut von § 5 Abs. 1 LMZDV: Wer eine ändert, muss es an zwei Stellen tun — und schlägt
// dabei hoffentlich die Verordnung auf. Die rechtliche Vollständigkeit belegt kein Test; er hält
// fest, was am 2026-09-26 gegen den Verordnungstext abgeglichen wurde.
const PFLICHTANGABEN: Record<string, string> = {
  COLOURING: 'mit Farbstoff',
  PRESERVATIVE: 'mit Konservierungsstoff',
  ANTIOXIDANT: 'mit Antioxidationsmittel',
  NITRITE_CURING_SALT: 'mit Nitritpökelsalz',
  NITRATE: 'mit Nitrat',
  NITRITE_CURING_SALT_AND_NITRATE: 'mit Nitritpökelsalz und Nitrat',
  FLAVOUR_ENHANCER: 'mit Geschmacksverstärker',
  BLACKENED: 'geschwärzt',
  WAXED: 'gewachst',
  PHOSPHATE: 'mit Phosphat',
  SWEETENER: 'mit Süßungsmittel(n)',
  PHENYLALANINE_SOURCE: 'enthält eine Phenylalaninquelle',
  LAXATIVE_POLYOLS: 'kann bei übermäßigem Verzehr abführend wirken',
}

describe('ADDITIVES', () => {
  it('führt 13 Angaben — § 5 Abs. 1 Nr. 1 bis 12 LMZDV, Nr. 4 in a bis c geteilt, ohne Nr. 10', () => {
    expect(ADDITIVES).toHaveLength(13)
    expect(new Set(ADDITIVES).size).toBe(ADDITIVES.length)
  })
})

describe('ADDITIVE_CATALOG', () => {
  it('hat für jeden Code genau einen Eintrag und keinen darüber hinaus', () => {
    expect(Object.keys(ADDITIVE_CATALOG).sort()).toEqual([...ADDITIVES].sort())
    expect(Object.keys(PFLICHTANGABEN).sort()).toEqual([...ADDITIVES].sort())
  })

  it.each(Object.entries(PFLICHTANGABEN))('%s trägt die Pflichtangabe „%s"', (code, label) => {
    expect(ADDITIVE_CATALOG[code as keyof typeof ADDITIVE_CATALOG].label).toBe(label)
  })

  it('nennt je Code einen Anwendungsfall und eine eigene Fundstelle', () => {
    for (const code of ADDITIVES) {
      const entry = ADDITIVE_CATALOG[code]
      expect(entry.appliesTo, code).toMatch(/^(bei|für) /)
      expect(entry.legalBasis, code).toMatch(/^§ 5 Abs\. 1 Nr\. \d+( Buchst\. [a-c])? LMZDV$/)
    }
    const fundstellen = ADDITIVES.map(code => ADDITIVE_CATALOG[code].legalBasis)
    expect(new Set(fundstellen).size).toBe(ADDITIVES.length)
  })

  it('führt Nr. 10 (Tafelsüßen) bewusst nicht — die Angabe braucht die Süßungsmittel als Freitext', () => {
    const fundstellen = ADDITIVES.map(code => ADDITIVE_CATALOG[code].legalBasis)
    expect(fundstellen).not.toContain('§ 5 Abs. 1 Nr. 10 LMZDV')
  })

  it('ist eingefroren', () => {
    expect(Object.isFrozen(ADDITIVE_CATALOG)).toBe(true)
  })
})

describe('additiveSchema', () => {
  // Dieselbe AJV-Konfiguration wie der Feathers-`dataValidator`; `Value.Check` scheitert an
  // StringEnum (Type.Unsafe). Muster aus order-reference.schema.spec.ts.
  const validate = addFormats(new Ajv({}), ['uuid', 'date-time']).compile(additiveSchema)

  it('akzeptiert jeden Katalog-Code', () => {
    for (const code of ADDITIVES) {
      expect(validate(code), code).toBe(true)
    }
  })

  it('lehnt unbekannte Codes und Klartext ab', () => {
    expect(validate('SULPHURED')).toBe(false)
    expect(validate('mit Farbstoff')).toBe(false)
    expect(validate('colouring')).toBe(false)
    expect(validate('')).toBe(false)
  })
})
