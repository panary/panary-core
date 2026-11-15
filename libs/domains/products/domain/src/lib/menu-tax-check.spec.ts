import { describe, expect, it } from 'vitest'

import { checkMenuTax, MenuTaxCheckInput, MenuTaxCheckMenu } from './menu-tax-check'

type Group = NonNullable<MenuTaxCheckMenu['optionGroups']>[number]

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const option = (n: number) => ({ productId: ID(n) })
const group = (n: number, name: string, optionIds: number[], over: Partial<Group> = {}): Group => ({
  id: ID(900 + n),
  name,
  minSelections: 1,
  maxSelections: 1,
  freeQuantity: 0,
  options: optionIds.map(option),
  ...over,
})

type Opt = ReturnType<NonNullable<MenuTaxCheckInput['resolveOption']>>
const product = (
  n: number,
  price: number,
  taxInside: number | undefined,
  taxOutside: number | undefined,
  over = {},
): Opt => ({ _id: ID(n), price, taxInside, taxOutside, ...over }) as Opt

function check(menuOver: Partial<MenuTaxCheckMenu>, products: Array<Opt>, locationTaxRates: number[] = [7, 19]) {
  const menu: MenuTaxCheckMenu = { _id: ID(1), price: 8, taxInside: 7, taxOutside: 7, ...menuOver }
  return checkMenuTax({
    menu,
    resolveOption: id => products.find(p => p?._id === id),
    locationTaxRates,
  })
}

describe('checkMenuTax — saubere Konfiguration', () => {
  it('liefert keinen Befund, wenn Slots und Sätze zusammenpassen', () => {
    const findings = check({ optionGroups: [group(1, 'Getränk', [11]), group(2, 'Beilage', [12])] }, [
      product(11, 3, 19, 19),
      product(12, 2, 7, 7),
    ])
    expect(findings).toEqual([])
  })
})

describe('Regel 1 — Extra-Gruppe mit abweichendem Satz', () => {
  const cola = product(11, 3, 19, 19)

  it('trifft: Pflichtgruppe mit einer Wahl → als Beilage oder Getränk führen', () => {
    expect(check({ optionGroups: [group(1, 'Dazu', [11])] }, [cola])).toEqual([
      {
        rule: 1,
        code: 'EXTRA_GROUP_RATE_DIFFERS',
        severity: 'warnung',
        recommendation: 'GROUP_AS_SIDE_OR_DRINK',
        groupId: ID(901),
        productId: ID(11),
      },
    ])
  })

  it.each([
    ['Mehrfachwahl', { maxSelections: 3 }],
    ['Freimenge', { freeQuantity: 1 }],
    ['HIGHEST', { pricingMode: 'HIGHEST' as const }],
    ['optionale Gruppe', { minSelections: 0 }],
  ])('anderer Empfehlungsschlüssel bei %s', (_name, over) => {
    const [finding] = check({ optionGroups: [group(1, 'Dazu', [11], over)] }, [cola])
    expect(finding.recommendation).toBe('MOVE_OPTION_TO_OWN_SIDE_OR_DRINK_GROUP')
  })

  it('trifft nicht: Gruppe heißt Getränk (die Kasse bucht sie als Komponente mit eigenem Satz)', () => {
    expect(check({ optionGroups: [group(1, 'Getränk', [11])] }, [cola])).toEqual([])
  })

  it('trifft nicht: gleicher Satz wie das Menü', () => {
    expect(check({ optionGroups: [group(1, 'Dazu', [11])] }, [product(11, 3, 7, 7)])).toEqual([])
  })

  it('trifft nicht ohne Aufpreis (Preis 0): dann greift Regel 2', () => {
    const findings = check({ optionGroups: [group(1, 'Dazu', [11])] }, [product(11, 0, 19, 19)])
    expect(findings.map(f => f.rule)).toEqual([2])
  })

  it('der Satz im Haus allein genügt (innen 19, außen wie das Menü)', () => {
    const findings = check({ optionGroups: [group(1, 'Dazu', [11])] }, [product(11, 3, 19, 7)])
    expect(findings.map(f => f.rule)).toEqual([1])
  })

  it('der Satz außer Haus allein genügt (innen gleich, außen 19)', () => {
    const findings = check({ optionGroups: [group(1, 'Dazu', [11])] }, [product(11, 3, 7, 19)])
    expect(findings.map(f => f.rule)).toEqual([1])
  })

  it('gilt auch im Festpreis-Menü und für Untergruppen eines Options-Produkts', () => {
    const findings = check(
      { bundlePricingMode: 'FIXED_PROPORTIONAL', mainPrice: 4, optionGroups: [group(1, 'Beilage', [12])] },
      [product(12, 2, 7, 7, { optionGroups: [group(2, 'Soße', [11])] }), cola],
    )
    expect(findings).toEqual([
      {
        rule: 1,
        code: 'EXTRA_GROUP_RATE_DIFFERS',
        severity: 'warnung',
        recommendation: 'GROUP_AS_SIDE_OR_DRINK',
        groupId: ID(902),
        productId: ID(11),
      },
    ])
  })
})

describe('Regel 2 — abweichender Satz ohne eigenen Preis', () => {
  it('trifft in beiden Preismodi', () => {
    for (const bundlePricingMode of ['ROLLUP', 'FIXED_PROPORTIONAL'] as const) {
      const findings = check({ bundlePricingMode, mainPrice: 4, optionGroups: [group(1, 'Getränk', [11])] }, [
        product(11, 0, 19, 19),
      ])
      expect(findings).toEqual([
        {
          rule: 2,
          code: 'OPTION_WITHOUT_PRICE_OTHER_RATE',
          severity: 'warnung',
          recommendation: 'ENTER_OPTION_PRICE',
          groupId: ID(901),
          productId: ID(11),
        },
      ])
    }
  })

  it('trifft nicht: Preis 0, aber derselbe Satz wie das Menü', () => {
    expect(check({ optionGroups: [group(1, 'Getränk', [11])] }, [product(11, 0, 7, 7)])).toEqual([])
  })
})

describe('Regeln 3 und 4 — Hauptgericht im Festpreis-Menü', () => {
  const fixed = { bundlePricingMode: 'FIXED_PROPORTIONAL' as const, price: 10 }
  const cola = product(11, 3, 7, 7)
  const pommes = product(12, 2, 7, 7)

  it('Regel 3: mainPrice 0', () => {
    expect(check({ ...fixed, mainPrice: 0, optionGroups: [group(1, 'Getränk', [11])] }, [cola])).toEqual([
      {
        rule: 3,
        code: 'MAIN_WITHOUT_SHARE',
        severity: 'warnung',
        recommendation: 'ENTER_MAIN_PRICE_OR_CHECK_FIXED_PRICE',
        productId: ID(1),
      },
    ])
  })

  it('Regel 3: kein mainPrice und die teuerste Kombination erreicht den Festpreis', () => {
    // 3 + 2 + 5 = 10 → Restbetrag fürs Hauptgericht ist 0
    const findings = check(
      { ...fixed, optionGroups: [group(1, 'Getränk', [11]), group(2, 'Beilage', [12]), group(3, 'Dazu', [13])] },
      [cola, pommes, product(13, 5, 7, 7)],
    )
    expect(findings.map(f => f.rule)).toEqual([3])
  })

  it('Regel 3: die teuerste Kombination nimmt je Gruppe die maxSelections teuersten Optionen', () => {
    const findings = check(
      { ...fixed, optionGroups: [group(1, 'Dazu', [11, 12, 13], { maxSelections: 2, minSelections: 0 })] },
      [product(11, 5, 7, 7), product(12, 5, 7, 7), product(13, 1, 7, 7)],
    )
    expect(findings.map(f => f.rule)).toEqual([3])
  })

  it('Regel 3: Untergruppen eines Options-Produkts zählen in die teuerste Kombination', () => {
    const findings = check({ ...fixed, optionGroups: [group(1, 'Beilage', [12])] }, [
      product(12, 6, 7, 7, { optionGroups: [group(2, 'Soße', [13], { minSelections: 0 })] }),
      product(13, 4, 7, 7),
    ])
    expect(findings.map(f => f.rule)).toEqual([3])
  })

  it('Regel 4: kein mainPrice, aber Luft nach oben → Hinweis, nie zusammen mit Regel 3', () => {
    const findings = check({ ...fixed, optionGroups: [group(1, 'Getränk', [11])] }, [cola])
    expect(findings).toEqual([
      {
        rule: 4,
        code: 'MAIN_PRICE_MISSING',
        severity: 'hinweis',
        recommendation: 'ENTER_MAIN_PRICE',
        productId: ID(1),
      },
    ])
  })

  it('trifft nicht: mainPrice gesetzt und größer 0', () => {
    expect(check({ ...fixed, mainPrice: 4, optionGroups: [group(1, 'Getränk', [11])] }, [cola])).toEqual([])
  })

  it('trifft nicht: Menü ohne Festpreis', () => {
    expect(check({ bundlePricingMode: 'ROLLUP', optionGroups: [group(1, 'Getränk', [11])] }, [cola])).toEqual([])
  })
})

describe('Regel 5 — Satz kommt in der Filiale nicht vor', () => {
  it('trifft: Option mit 16 % bei Filialsätzen 7 und 19', () => {
    expect(check({ optionGroups: [group(1, 'Getränk', [11])] }, [product(11, 3, 16, 16)])).toContainEqual({
      rule: 5,
      code: 'RATE_NOT_IN_LOCATION',
      severity: 'warnung',
      recommendation: 'CHECK_LOCATION_TAX_RATES',
      groupId: ID(901),
      productId: ID(11),
      rate: 16,
    })
  })

  it('trifft das Menü selbst ohne groupId', () => {
    expect(check({ taxInside: 16, taxOutside: 7 }, [])).toEqual([
      {
        rule: 5,
        code: 'RATE_NOT_IN_LOCATION',
        severity: 'warnung',
        recommendation: 'CHECK_LOCATION_TAX_RATES',
        productId: ID(1),
        rate: 16,
      },
    ])
  })

  it('prüft den Ersatzwert der Kasse: ein fehlender Satz außer Haus zählt als 7 %', () => {
    const findings = check(
      { taxInside: 19, taxOutside: 19, optionGroups: [group(1, 'Getränk', [11])] },
      [product(11, 3, 19, undefined)],
      [19],
    )
    expect(findings.filter(f => f.rule === 5).map(f => f.rate)).toEqual([7])
  })

  it('trifft nicht: alle Sätze kommen vor', () => {
    expect(check({}, [])).toEqual([])
  })

  it('trifft nicht ohne Filialsätze: es gibt nichts zu vergleichen', () => {
    expect(check({ taxInside: 16 }, [], [])).toEqual([])
  })
})

describe('Regel 6 — Satz fehlt oder steht auf 0', () => {
  it('trifft: Option ohne Satz außer Haus; Regel 5 sieht den Ersatzwert 7 und schweigt', () => {
    expect(check({ optionGroups: [group(1, 'Getränk', [11])] }, [product(11, 3, 19, undefined)])).toEqual([
      {
        rule: 6,
        code: 'RATE_MISSING_OR_ZERO',
        severity: 'warnung',
        recommendation: 'ENTER_TAX_RATE_EXPLICITLY',
        groupId: ID(901),
        productId: ID(11),
      },
    ])
  })

  it('trifft: Menü mit 0 %, Regel 5 prüft danach den Ersatzwert 19 und findet ihn nicht in der Filiale', () => {
    expect(check({ taxInside: 0, taxOutside: 0 }, [], [7]).map(f => [f.rule, f.rate])).toEqual([
      [6, undefined],
      [5, 19],
    ])
  })

  it('trifft nicht: beide Sätze ausdrücklich gesetzt', () => {
    expect(check({}, [])).toEqual([])
  })

  it('vergleicht mit dem Ersatzwert: ein Option ohne Satz weicht vom 7-%-Menü ab (19 im Haus)', () => {
    const findings = check({ optionGroups: [group(1, 'Dazu', [11])] }, [product(11, 3, undefined, undefined)])
    expect(findings.map(f => f.rule)).toEqual([1, 6])
  })
})

describe('Regel 7 — Option nicht auflösbar', () => {
  it('trifft: Hinweis, und an der Option wird nichts weiter geprüft', () => {
    expect(check({ optionGroups: [group(1, 'Getränk', [99])] }, [])).toEqual([
      {
        rule: 7,
        code: 'OPTION_UNRESOLVED',
        severity: 'hinweis',
        recommendation: 'CHECK_OPTION_PRODUCT',
        groupId: ID(901),
        productId: ID(99),
      },
    ])
  })

  it('trifft nicht: Option ist auflösbar', () => {
    expect(check({ optionGroups: [group(1, 'Getränk', [11])] }, [product(11, 3, 7, 7)])).toEqual([])
  })
})

describe('Robustheit', () => {
  it('endet bei einem Zirkelbezug zwischen Options-Produkten', () => {
    const a = product(11, 3, 7, 7, { optionGroups: [group(2, 'Beilage', [12])] })
    const b = product(12, 2, 7, 7, { optionGroups: [group(3, 'Beilage', [11])] })
    expect(check({ optionGroups: [group(1, 'Beilage', [11])] }, [a, b])).toEqual([])
  })

  it('ein Menü ohne Gruppen hat keinen Befund', () => {
    expect(check({ optionGroups: undefined }, [])).toEqual([])
  })
})
