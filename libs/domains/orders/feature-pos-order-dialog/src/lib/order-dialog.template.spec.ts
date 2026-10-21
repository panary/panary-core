import { BindingType, parseTemplate, type TmplAstNode } from '@angular/compiler'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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

  it('verschiebt die aeusseren Menue-Striche um den vollen Wert', () => {
    const sources = inputs.filter(i => i.type === BindingType.Property && i.name === 'class').map(i => i.value.source)
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'translate-y-[0.3125rem] rotate-45'"),
        expect.stringContaining("'-translate-y-[0.3125rem] -rotate-45'"),
      ]),
    )
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

// Spalte 2 wurde bei niedriger Fensterhoehe gestaucht: Die Tasten hatten `flex-shrink: 1`,
// bei 1024×600 ohne Fluid-Flag noch 45 px, bei 800×600 36 px (#757).
describe('OrderDialog-Template — Funktionstasten in Spalte 2 (#757)', () => {
  const start = template.indexOf('<!-- SPALTE 2: Funktionstasten -->')
  const spalte = template.slice(start, template.indexOf('<!-- SPALTE 3: Produkte -->'))
  const container = spalte.match(/<div class="([^"]*)">/)?.[1].split(/\s+/) ?? []
  const tasten = [...spalte.matchAll(/<button[^>]*class="([^"]*)"/g)].map(m => m[1].split(/\s+/))

  it('hat sieben Tasten, keine davon schrumpft', () => {
    expect(start).toBeGreaterThan(-1)
    expect(tasten).toHaveLength(7)
    expect(tasten.filter(klassen => !klassen.includes('shrink-0') || !klassen.includes('h-14'))).toEqual([])
  })

  it('scrollt bei zu wenig Hoehe, statt abzuschneiden', () => {
    expect(container).toEqual(expect.arrayContaining(['shrink-0', 'min-h-0', 'overflow-y-auto']))
  })
})

// Die untere Leiste lief bei 1280 px über: Der Inline-Ziffernblock schaltete bei `lg` (1024 px)
// ein, die Leiste braucht aber rund 1380 px (#798). Die Schwelle misst jetzt die Leiste selbst
// (Container-Query) und muss die Summe der festen Breiten tragen — ohne Padding, denn eine
// Container-Query vergleicht die Inhaltsbreite.
describe('OrderDialog-Template — untere Leiste (#798)', () => {
  const start = template.indexOf('<!-- ═══════════════ EINHEITLICHE UNTERE LEISTE ═══════════════ -->')
  const leiste = template.slice(start, template.indexOf('<!-- Customer Filter / Selection -->'))
  const leistenTag = leiste.match(/<div class="([^"]*)">/)?.[1].split(/\s+/) ?? []
  const inline = leiste.slice(leiste.indexOf('<!-- Numpad: Inline'), leiste.indexOf('<!-- Clear + Numpad: Kompakt'))
  const inlineKlassen = inline.match(/<div class="([^"]*)">/)?.[1].split(/\s+/) ?? []
  const kompakt = leiste.slice(leiste.indexOf('<!-- Clear + Numpad: Kompakt'))
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

  it('schaltet den Inline-Ziffernblock erst ein, wenn alle Tasten nebeneinander passen', () => {
    // Inline-Modus: Funktionstasten, Bestellen, Multiplier, Ziffern 0–9 und C — 19 Elemente mit
    // fester Breite. Dazu kommt der Spacer ohne Breite, also 20 Elemente und 19 Lücken à gap-1.5
    // = 0.375rem: so viele Lücken, wie es Breiten gibt.
    const ohneKompakt = leiste.slice(0, leiste.indexOf('<!-- Clear + Numpad: Kompakt'))
    const elemente = [...ohneKompakt.matchAll(/class="[^"]*\bw-(\d+)\b[^"]*"/g)].map(m => Number(m[1]) * 0.25)
    const ziffernTaste = inline.match(/<button[^>]*class="[^"]*\bw-(\d+)\b/)?.[1]
    // Die @for-Schleife steht einmal im Template, rendert aber zehn Ziffern.
    const breiten = [...elemente, ...Array(9).fill(Number(ziffernTaste) * 0.25)]
    const bedarf = breiten.reduce((a, b) => a + b, 0) + breiten.length * 0.375
    expect(breiten).toHaveLength(19)
    expect(Number(schwelle(inlineKlassen, 'flex'))).toBeGreaterThanOrEqual(bedarf)
  })

  it('hält das Ziffern-Popup außerhalb des Containers', () => {
    const leistenEnde = leiste.indexOf('<!-- ═══ Ende untere Leiste ═══ -->')
    expect(leistenEnde).toBeGreaterThan(-1)
    expect(leiste.indexOf('@if (showNumpadPopup)')).toBeGreaterThan(leistenEnde)
  })
})
