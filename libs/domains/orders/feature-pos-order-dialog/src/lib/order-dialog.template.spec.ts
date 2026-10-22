import { BindingType, parseTemplate, type TmplAstNode } from '@angular/compiler'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GROUP_MIN_WIDTH_REM } from './group-bar'

// Die Komponenten-Spec instanziiert den Dialog direkt und rendert das Template nicht —
// deshalb hier ein Blick auf die Quelle: Beilage und Getraenk eines Menues sind Objekte,
// ausgegeben werden darf nur ihr Name (#564: „Getraenk: [object Object]" in der Kombination).
const template = readFileSync(fileURLToPath(new URL('./order-dialog.component.html', import.meta.url)), 'utf8')

describe('OrderDialog-Template — Menue-Beilage und -Getraenk (#564)', () => {
  it('gibt menuSideDish und menuDrink nie als Objekt aus', () => {
    expect(template.match(/\{\{\s*lineItem\.(menuSideDish|menuDrink)\s*(\|\||\}\}|\|)/g)).toBeNull()
  })

  it('zeigt in Einzel- und Kombinationszeile je den Namen', () => {
    expect(template.match(/\{\{\s*lineItem\.menuSideDish\?\.name \|\| 'ohne' \}\}/g)).toHaveLength(2)
    expect(template.match(/\{\{\s*lineItem\.menuDrink\?\.name \|\| 'ohne' \}\}/g)).toHaveLength(2)
  })
})

// core#781: Der Aufpreis einer Menue-Komponente kommt aus menuSurcharge (Festpreis-Menue → 0, wie der Bon),
// in Einzel- UND Kombinationszeile. Die rohe Differenz price − generalPrice zeigte „+€6.50" unter dem
// Getraenk eines Festpreis-Menues; beim ersten Fix blieb sie in der Kombinationszeile stehen.
describe('OrderDialog-Template — Aufpreis der Menue-Komponenten (core#781)', () => {
  it('rechnet den Aufpreis nie im Template aus', () => {
    expect(template.match(/\.price\s*-\s*general(SideDish|Drink)Price/g)).toBeNull()
  })

  it('nutzt menuSurcharge in Einzel- und Kombinationszeile je fuer Beilage und Getraenk', () => {
    expect(template.match(/menuSurcharge\(lineItem, lineItem\.menuSideDish, generalSideDishPrice\)/g)).toHaveLength(2)
    expect(template.match(/menuSurcharge\(lineItem, lineItem\.menuDrink, generalDrinkPrice\)/g)).toHaveLength(2)
  })
})

// Angular trennt den Namen einer [class.…]-Bindung am Punkt: [class.translate-y-[0.3125rem]]
// band nur „translate-y-[0" — eine Klasse ohne CSS, die Menue-Striche wurden nie zum „X" (#573).
// Das Überlauf-Menü mit den Strichen ist mit core#829 entfallen; die Regel gilt für jede Bindung.
type BindingNode = TmplAstNode & {
  inputs?: { name: string; type: BindingType; value: { source?: string | null } }[]
  children?: BindingNode[]
  branches?: BindingNode[]
  cases?: BindingNode[]
}

function collectInputs(nodes: BindingNode[], out: NonNullable<BindingNode['inputs']> = []) {
  for (const node of nodes) {
    out.push(...(node.inputs ?? []))
    for (const key of ['children', 'branches', 'cases'] as const) collectInputs(node[key] ?? [], out)
  }
  return out
}

describe('OrderDialog-Template — Klassenbindungen (#573)', () => {
  const parsed = parseTemplate(template, 'order-dialog.component.html', {})
  const inputs = collectInputs(parsed.nodes as BindingNode[])

  it('parst fehlerfrei', () => {
    expect(parsed.errors ?? []).toEqual([])
  })

  it('bindet keinen am Punkt abgeschnittenen Klassennamen', () => {
    const truncated = inputs
      .filter(i => i.type === BindingType.Class)
      .map(i => i.name)
      .filter(name => (name.match(/\[/g) ?? []).length !== (name.match(/\]/g) ?? []).length)
    expect(truncated).toEqual([])
  })
})

// Der Umschalter „1 Stück | alle n" (#699) lebt im Panel; ohne die Bindung bliebe er stumm auf „alle".
describe('OrderDialog-Template — Umschalter im Anpassen-Panel (#699)', () => {
  it('reicht Umfang und Sperre hinein und nimmt die Wahl entgegen', () => {
    expect(template).toContain('[scope]="customizeScope()"')
    expect(template).toContain('[scopeLocked]="customizeScopeLocked()"')
    expect(template).toContain('(scopeChanged)="onCustomizeScopeChanged($event)"')
  })
})

// Spalte 2 ist mit core#829 entfallen. Ihre Mengen- und Löschtasten sitzen in der Steuerleiste unter der
// markierten Zeile — im Bestandsmaß, nie geschrumpft (ADR 0034, #757: gestauchte Tasten bei 800×600).
describe('Kasse-Template — Steuerleiste der Markierung (core#829)', () => {
  const start = template.indexOf('<ng-template #steuerleiste>')
  const leiste = template.slice(start, template.indexOf('</ng-template>', start))
  const tasten = [...leiste.matchAll(/<button[^>]*class="([^"]*)"/g)].map(m => m[1].split(/\s+/))

  it('hat −, +, Anpassen bzw. Kombi lösen und Löschen, alle im 3,5rem-Maß und nie geschrumpft', () => {
    expect(start).toBeGreaterThan(-1)
    // Anpassen und Kombi lösen stehen in @if/@else — gerendert wird je eine, im Template stehen beide.
    expect(tasten).toHaveLength(5)
    expect(tasten.filter(klassen => !klassen.includes('h-14') || !klassen.includes('shrink-0'))).toEqual([])
  })

  it('wirkt über die bestehenden Auswahl-Methoden, nicht über eigene Logik', () => {
    for (const aufruf of [
      'decreaseSelectedQuantity()',
      'increaseSelectedQuantity()',
      'customizeSelection()',
      'resolveSelectedCombination()',
      'deleteSelection()',
    ]) {
      expect(leiste).toContain(`(click)="${aufruf}"`)
    }
    expect(leiste).toContain('[disabled]="!canDecreaseSelection()"')
  })

  it('erscheint unter freier Zeile, Kombinationskopf und Position — als eigene Fläche außerhalb des Klickziels', () => {
    expect(template.match(/<ng-container \[ngTemplateOutlet\]="steuerleiste" \/>/g)).toHaveLength(3)
  })
})

// Die Ziffernleiste lief bei 1280 px über (#798): Die Schwelle misst die Leiste selbst (Container-Query) und
// muss die Summe der festen Breiten tragen — ohne Padding, denn eine Container-Query vergleicht die Inhaltsbreite.
describe('Kasse-Template — Ziffernleiste (#798, core#829)', () => {
  const start = template.indexOf('<!-- ═══════════════ ZIFFERNLEISTE ═══════════════ -->')
  const ende = template.indexOf('<!-- ═══ Ende Ziffernleiste ═══ -->')
  const leiste = template.slice(start, ende)
  const leistenTag = leiste.match(/<div class="([^"]*)">/)?.[1].split(/\s+/) ?? []
  const inline = leiste.slice(leiste.indexOf('<!-- Ziffern inline'), leiste.indexOf('<!-- Kompakt'))
  const inlineKlassen = inline.match(/<div class="([^"]*)">/)?.[1].split(/\s+/) ?? []
  const kompakt = leiste.slice(leiste.indexOf('<!-- Kompakt'))
  const kompaktKlassen = kompakt.match(/<div class="([^"]*)">/)?.[1].split(/\s+/) ?? []
  const schwelle = (klassen: string[], wert: string) =>
    klassen.map(k => k.match(new RegExp(`^@min-\\[([\\d.]+)rem\\]:${wert}$`))?.[1]).find(Boolean)

  it('ist selbst der Container und schaltet beide Ziffernblöcke an derselben Schwelle', () => {
    expect(start).toBeGreaterThan(-1)
    expect(leistenTag).toContain('@container')
    expect(inlineKlassen).toContain('hidden')
    expect(schwelle(inlineKlassen, 'flex')).toBeDefined()
    expect(schwelle(kompaktKlassen, 'hidden')).toEqual(schwelle(inlineKlassen, 'flex'))
    expect([...inlineKlassen, ...kompaktKlassen].filter(k => /^(sm|md|lg|xl|2xl):/.test(k))).toEqual([])
  })

  it('schaltet die Ziffern erst inline, wenn Multiplier, 0–9 und C nebeneinander passen', () => {
    const feld = Number(leiste.match(/<button[^>]*class="[^"]*\bw-\[([\d.]+)rem\]/)?.[1])
    const taste = Number(inline.match(/<button[^>]*class="[^"]*\bw-(\d+)\b/)?.[1]) * 0.25
    // Feld + zehn Ziffern + C, dazwischen elf Lücken à gap-1.5 = 0.375rem.
    const bedarf = feld + 11 * taste + 11 * 0.375
    expect(feld).toBeGreaterThan(0)
    expect(taste).toBe(3.5)
    expect(Number(schwelle(inlineKlassen, 'flex'))).toBeGreaterThanOrEqual(bedarf)
  })

  it('hält das Ziffern-Popup außerhalb des Containers', () => {
    expect(ende).toBeGreaterThan(start)
    expect(template.indexOf('@if (showNumpadPopup)')).toBeGreaterThan(ende)
  })
})

// core#829: Zonen-Grid mit Spiegelung je Mitarbeiter, Gruppenleiste ohne Wischen, Kacheln ohne Silbentrennung.
describe('Kasse-Template — Layout B1 (core#829)', () => {
  const scss = readFileSync(fileURLToPath(new URL('./order-dialog.component.scss', import.meta.url)), 'utf8')
  const areas = (block: string) => [...block.matchAll(/'([a-z ]+)'/g)].map(m => m[1].split(/\s+/))

  it('bindet die Seite des Warenkorbs an die Händigkeit des Mitarbeiters', () => {
    expect(template).toContain('[attr.data-hand]="handedness()"')
  })

  it('spiegelt nur Zonen: Warenkorb ↔ Raster und Primärtaste ↔ Ziffernleiste, Kopf und Gruppen bleiben', () => {
    const links = scss.slice(scss.indexOf('.kasse {'), scss.indexOf("&[data-hand='right']"))
    const rechts = scss.slice(scss.indexOf("&[data-hand='right']"), scss.indexOf('.kasse__head'))
    const gespiegelt = areas(links).map(zeile => [...zeile].reverse())

    expect(areas(links)).toEqual([
      ['head', 'head'],
      ['groups', 'groups'],
      ['cart', 'grid'],
      ['primary', 'keys'],
    ])
    expect(areas(rechts)).toEqual(gespiegelt)
  })

  it('legt jede Zone auf ihre grid-area', () => {
    for (const zone of ['head', 'groups', 'cart', 'grid', 'primary', 'keys']) {
      expect(template).toContain(`kasse__${zone}`)
      expect(scss).toMatch(new RegExp(`\\.kasse__${zone} \\{\\s*grid-area: ${zone};`))
    }
  })

  it('baut die Gruppenleiste mit derselben Mindestbreite, mit der group-bar.ts rechnet', () => {
    expect(template).toContain(`grid-cols-[repeat(auto-fill,minmax(${GROUP_MIN_WIDTH_REM}rem,1fr))]`)
  })

  it('trennt Namen auf Kacheln und Gruppen nicht mitten im Wort (core#853)', () => {
    expect(template).not.toMatch(/hyphens/)
    expect(template).not.toMatch(/lang="de"/)
  })

  it('hat keine Spalte 2 mehr', () => {
    expect(template).not.toContain('SPALTE 2')
    expect(template).not.toContain('Abwählen')
  })
})
