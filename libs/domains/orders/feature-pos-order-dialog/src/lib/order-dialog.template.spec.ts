import { BindingType, parseTemplate, type TmplAstNode } from '@angular/compiler'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GROUP_BURGER_WIDTH_REM, GROUP_GAP_REM } from './group-bar'

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
// Das Überlauf-Menü mit den Strichen ist mit core#908 zurück; die Regel gilt für jede Bindung.
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
  // Die Zone ist der Anker des Popups, der Container sitzt eine Ebene tiefer (Containment fängt `fixed` ab).
  const zone = leiste.match(/<div class="(kasse__keys [^"]*)">/)?.[1].split(/\s+/) ?? []
  const leistenTag = leiste.match(/<div class="(@container[^"]*)">/)?.[1].split(/\s+/) ?? []
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

  it('hält das Ziffern-Popup außerhalb des Containers, aber in der Zone verankert', () => {
    const zonenEnde = template.indexOf('<!-- Steuerleiste der markierten')
    const popup = template.indexOf('@if (showNumpadPopup)')
    expect(ende).toBeGreaterThan(start)
    expect(popup).toBeGreaterThan(ende)
    expect(popup).toBeLessThan(zonenEnde)
    expect(zone).toContain('relative')
    expect(zone).not.toContain('@container')
  })
})

// core#829: Zonen-Grid mit Spiegelung je Mitarbeiter, Gruppenleiste ohne Wischen, Kacheln ohne Silbentrennung.
// core#908: ohne Kopfzeile, Gruppenleiste einzeilig mit Burger.
describe('Kasse-Template — Layout B1 (core#829)', () => {
  const scss = readFileSync(fileURLToPath(new URL('./order-dialog.component.scss', import.meta.url)), 'utf8')
  // Nur die Zeilen hinter `grid-template-areas:` — der Selektor `[data-hand='right']` trägt selbst Anführungszeichen.
  const areas = (block: string) =>
    [...block.slice(block.indexOf('grid-template-areas:')).matchAll(/'([a-z ]+)'/g)].map(m => m[1].split(/\s+/))

  it('bindet die Seite des Warenkorbs an die Händigkeit des Mitarbeiters', () => {
    expect(template).toContain('[attr.data-hand]="handedness()"')
  })

  it('spiegelt nur Zonen: Warenkorb ↔ Raster und Primärtaste ↔ Ziffernleiste, die Gruppen bleiben', () => {
    const links = scss.slice(scss.indexOf('.kasse {'), scss.indexOf("&[data-hand='right']"))
    const rechts = scss.slice(scss.indexOf("&[data-hand='right']"), scss.indexOf('.kasse__groups {'))
    const gespiegelt = areas(links).map(zeile => [...zeile].reverse())

    expect(areas(links)).toEqual([
      ['groups', 'groups'],
      ['cart', 'grid'],
      ['primary', 'keys'],
    ])
    expect(areas(rechts)).toEqual(gespiegelt)
  })

  it('legt jede Zone auf ihre grid-area', () => {
    for (const zone of ['groups', 'cart', 'grid', 'primary', 'keys']) {
      expect(template).toContain(`kasse__${zone}`)
      expect(scss).toMatch(new RegExp(`\\.kasse__${zone} \\{\\s*grid-area: ${zone};`))
    }
  })

  it('hat keine Kopfzeile mehr — Meldungen laufen über den Hinweis (core#908)', () => {
    expect(template).not.toContain('kasse__head')
    expect(template).not.toContain('infoBox')
    expect(scss).not.toContain("'head")
    expect(template).toContain('@if (notice(); as hint)')
  })

  // core#1019: Die Gruppentaste hat wieder eine feste Breite und trennt deshalb lange Ein-Wort-Namen wie vor dem
  // Redesign. Kacheln bleiben ohne Silbentrennung — dort las sich „FLAMMKU-CHEN" schlecht (core#853).
  it('trennt Namen auf Kacheln nicht mitten im Wort, nur in der Gruppentaste (core#853, core#1019)', () => {
    const chip = template.slice(template.indexOf('<ng-template #groupChip'), template.indexOf('</ng-template>'))
    const ohneChip = template.replace(chip, '')
    expect(ohneChip).not.toMatch(/hyphens/)
    expect(ohneChip).not.toMatch(/lang="de"/)
    expect(chip.match(/hyphens/g)).toHaveLength(1)
    // Ohne `lang` trennt der Browser nicht: Das Dokument ist `lang="en"` (apps/pos-client/src/index.html).
    expect(chip).toContain('lang="de"')
  })

  it('hat keine Spalte 2 mehr', () => {
    expect(template).not.toContain('SPALTE 2')
    expect(template).not.toContain('Abwählen')
  })
})

// core#908: Befunde aus dem MacBook-Test von pos-v26.10.25.
describe('Kasse-Template — Feinschliff (core#908)', () => {
  const scss = readFileSync(fileURLToPath(new URL('./order-dialog.component.scss', import.meta.url)), 'utf8')
  const klassen = (marker: string) =>
    template
      .slice(template.lastIndexOf('<', template.indexOf(marker)), template.indexOf('>', template.indexOf(marker)))
      .match(/class="([^"]*)"/)?.[1]
      .split(/\s+/) ?? []

  it('baut die Gruppenleiste einzeilig, mit demselben Abstand und derselben Burger-Breite wie group-bar.ts', () => {
    const leiste = template.match(/class="kasse__groups ([^"]*)"/)?.[1].split(/\s+/) ?? []
    expect(leiste).toContain('flex')
    expect(leiste).not.toContain('flex-wrap')
    expect(leiste.filter(k => k.startsWith('grid'))).toEqual([])
    // gap-N ist N × 0,25rem, w-N ebenso — beide stecken in der Rechnung.
    const gap = leiste.map(k => k.match(/^gap-(\d+(?:\.\d+)?)$/)?.[1]).find(Boolean)
    expect(Number(gap) * 0.25).toBe(GROUP_GAP_REM)
    const burger = klassen('[matMenuTriggerFor]="moreGroups"')
      .map(k => k.match(/^w-(\d+)$/)?.[1])
      .find(Boolean)
    expect(Number(burger) * 0.25).toBe(GROUP_BURGER_WIDTH_REM)
  })

  // core#1046: Mit fester Breite kürzte „ALKOHOLFREIE GETRÄNKE" und trennte „DES-SERTS", obwohl die halbe Leiste frei
  // war. Gezählt wird weiter mit dem Grundmaß, sichtbar wachsen die Tasten in den Rest — die Messzeile nicht.
  it('gibt jeder Gruppe dasselbe Grundmaß, lässt sie in den freien Platz wachsen und bricht lange Namen um', () => {
    const chip = klassen('(click)="createProductButtons(productGroup)"\n      [disabled]')
    expect(chip).toEqual(
      expect.arrayContaining(['basis-[var(--pnry-group-chip)]', 'grow', 'shrink-0', 'max-w-[8.5rem]']),
    )
    expect(chip.filter(k => /^(min-w|w)-/.test(k))).toEqual([])
    const messzeile = template.match(/#productGroupMeasure\s+class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    expect(messzeile).toContain('*:grow-0')
    expect(chip).not.toContain('whitespace-nowrap')
    const name = template.slice(template.indexOf('<ng-template #groupChip'), template.indexOf('</ng-template>'))
    expect(name).toContain('line-clamp-2')
    expect(name).not.toContain('truncate')
    expect(scss).toMatch(/\.kasse \{[^}]*--pnry-group-chip: 5\.25rem;/)
  })

  it('misst Leiste und Messzeile mit derselben Gruppen-Vorlage, Farbe als Punkt statt Unterkante', () => {
    expect(template.match(/\[ngTemplateOutlet\]="groupChip"/g)).toHaveLength(2)
    expect(template).toContain('#productGroupMeasure')
    expect(template).not.toContain("'3px solid ' + productGroup.color")
    expect(template.match(/\[style\.background-color\]="productGroup\.color"/g)).toHaveLength(2)
  })

  it('führt Kombination in der Warenkorb-Leiste, Positionsrabatt und Code unter „Optionen" (core#965)', () => {
    const optionen = template.slice(
      template.indexOf('<mat-menu #optionen'),
      template.indexOf('</mat-menu>', template.indexOf('<mat-menu #optionen')),
    )
    const leiste = template.slice(
      template.indexOf('<div class="grid grid-cols-3'),
      template.indexOf('<mat-menu #optionen'),
    )
    expect(leiste).toContain('(click)="setCombiSubButtons()"')
    expect(leiste).toContain('(click)="openDiscountPicker()"')
    expect(leiste).not.toContain('openLineDiscountPicker()')
    expect(optionen).toContain('(click)="openLineDiscountPicker()"')
    expect(optionen).toContain('[disabled]="!canApplyLineDiscount()"')
    expect(optionen).toContain('(click)="openPromoCodeDialog()"')
    expect(optionen).not.toContain('setCombiSubButtons()')
    expect(template.match(/\(click\)="setCombiSubButtons\(\)"/g)).toHaveLength(1)
  })

  it('macht Primärtaste und Ziffern gleich hoch', () => {
    expect(klassen('(click)="setTaxRateSubbuttons()"')).toContain('h-14')
    expect(klassen('(click)="applyProductSearch()"')).toContain('h-14')
  })

  // core#928: `h-14` stand da, aber `pnry-touch-primary` setzt global `min-height: 4rem` und schlug es — die
  // Taste blieb 64 px. Geprüft wird deshalb jede Mindesthöhe, die eine globale Klasse der Taste mitbringt.
  it('lässt keine globale Mindesthöhe über die 3,5rem der Ziffern wachsen (core#928)', () => {
    const styles = readFileSync(
      fileURLToPath(new URL('../../../../../../apps/pos-client/src/styles.scss', import.meta.url)),
      'utf8',
    )
    const mindesthoehe = (klasse: string) =>
      Number(styles.match(new RegExp(`\\.${klasse}\\s*\\{[^}]*min-height:\\s*max\\(([\\d.]+)rem`))?.[1] ?? 0)
    expect(mindesthoehe('pnry-touch-primary')).toBeGreaterThan(3.5)
    for (const marker of ['(click)="setTaxRateSubbuttons()"', '(click)="applyProductSearch()"']) {
      const zuHoch = klassen(marker).filter(k => mindesthoehe(k) > 3.5)
      expect(zuHoch, marker).toEqual([])
    }
  })

  it('legt die Ziffern an den Rand gegenüber dem Warenkorb und spiegelt das mit der Händigkeit', () => {
    expect(template).toContain('class="kasse__keys-row ')
    const links = scss.slice(scss.indexOf('.kasse__keys-row {'))
    expect(links.slice(0, links.indexOf('}'))).toContain('justify-content: flex-end')
    const rechts = scss.slice(scss.indexOf(".kasse[data-hand='right'] {"))
    const rechtsZeile = rechts.slice(rechts.indexOf('.kasse__keys-row {'))
    expect(rechtsZeile.slice(0, rechtsZeile.indexOf('}'))).toContain('justify-content: flex-start')
  })

  it('stellt das Ziffern-Popup je Seite über die Ziffern-Taste', () => {
    expect(template).toContain('class="kasse__numpad-popup ')
    expect(template).not.toMatch(/kasse__numpad-popup[^"]*left-\[/)
    const block = (css: string, selektor: string) => {
      const ab = css.slice(css.indexOf(selektor))
      return ab.slice(0, ab.indexOf('}'))
    }
    expect(block(scss, '.kasse__numpad-popup {')).toContain('right: 0')
    const rechts = scss.slice(scss.indexOf(".kasse[data-hand='right'] {"))
    expect(block(rechts, '.kasse__numpad-popup {')).toContain('left: 10.375rem')
  })
})

// Anpassen als Sheet (core#830): Das Panel liegt über der Rasterzone, sperrt Primärtaste, Ziffern und Gruppenleiste
// und schließt nur über Fertig/Abbrechen. Das Template wird hier nur gelesen — die Komponenten-Spec rendert es nicht.
describe('Kasse-Template — Anpassen-Sheet (core#830)', () => {
  const sheetStart = template.indexOf('kasse__scrim kasse-scrim-enter')
  const sheet = template.slice(sheetStart, template.indexOf('} @else {', sheetStart))
  /** Alle Start-Tags `<button …>`, in denen der Marker steht — ein Marker kann mehrfach vorkommen (breite/schmale Leiste). */
  const startTags = (marker: string): string[] => {
    const tags: string[] = []
    for (let at = template.indexOf(marker); at !== -1; at = template.indexOf(marker, at + 1)) {
      const from = template.lastIndexOf('<button', at)
      let to = template.indexOf('>', at)
      // Ein `>` innerhalb eines Attributwerts (ungerade Zahl `"` davor) beendet das Tag nicht.
      while ((template.slice(from, to).match(/"/g) ?? []).length % 2 === 1) to = template.indexOf('>', to + 1)
      tags.push(template.slice(from, to + 1))
    }
    return tags
  }

  it('legt Scrim und Sheet vor das Panel, mit Einblend-Klassen', () => {
    expect(sheetStart).toBeGreaterThan(-1)
    expect(sheet).toContain('kasse__scrim kasse-scrim-enter')
    expect(sheet).toContain('kasse__sheet kasse-sheet-enter')
    // Eingeblendet wird per CSS-Klasse; `animate.enter` und `@Component.animations` schlossen sich bis core#908 aus (NG2027).
    expect(template).not.toMatch(/animate\.(enter|leave)\s*=/)
    expect(sheet).toContain('<lib-product-customize-panel')
  })

  it('lässt den Scrim-Tipp ins Leere laufen, damit nichts versehentlich verworfen wird', () => {
    const scrim = template.slice(sheetStart, template.indexOf('</div>', sheetStart))
    expect(scrim).not.toContain('(click)')
  })

  // „Übersicht" im Kopf ist mit der Rail entfallen (core#832); die Rail sperrt über `KasseDraftRegistry.sheetOpen`.
  it('sperrt Primärtaste, Ziffern, Feld und Gruppenleiste über sheetOpen()', () => {
    for (const marker of [
      '(click)="setTaxRateSubbuttons()"',
      '(click)="applyProductSearch()"',
      '(click)="numpadAction(number)"',
      '(click)="numpadAction(0)"',
      '(click)="numpadReset()"',
      '(click)="showNumpadPopup = !showNumpadPopup"',
      '(click)="createProductButtons(productGroup)"',
      '[matMenuTriggerFor]="moreGroups"',
    ]) {
      const tags = startTags(marker)
      expect(tags.length, marker).toBeGreaterThan(0)
      // Jedes Vorkommen, nicht nur eines: `numpadReset()` steht in der breiten und der schmalen Leiste.
      expect(
        tags.filter(tag => !tag.includes('[disabled]="sheetOpen()"')),
        marker,
      ).toEqual([])
    }
    // Der Warenkorb bleibt bedienbar: die Zeilenwahl hat keine Sperre, egal an welcher Stelle im Tag.
    const zeilen = startTags('(click)="selectCombinationByIndex(i, j)"')
    expect(zeilen.length).toBeGreaterThan(0)
    expect(zeilen.filter(tag => tag.includes('sheetOpen'))).toEqual([])
  })

  it('markiert die angepasste Zeile im Warenkorb — freie Zeile UND Kombinationszeile (#879)', () => {
    // Zwei Zeilenvorlagen: die freie Zeile (`lineItems`, Normalfall) und die Zeile in einer Kombination.
    // Die erste Fassung trug die Markierung nur in der Kombination, die freie Zeile blieb stumm.
    expect(template.match(/\[class\.kasse-line-customizing\]="isCustomizeLine\(lineItem\)"/g)).toHaveLength(2)
    expect(template.match(/'ORDER_DIALOG\.LINE_CUSTOMIZING' \| translate/g)).toHaveLength(2)
    // Der Hinweis hängt in beiden Vorlagen an `isCustomizeLine` — ohne diese Bedingung stünde er an jeder Zeile.
    expect(template.match(/@if \(isCustomizeLine\(lineItem\)\) \{/g)).toHaveLength(2)
  })
})

// core#909: Das Sheet liegt über Raster UND Ziffernleiste (Konzept 2.3), ohne Scrim-Streifen darüber und ohne
// eckige Unterkante mitten im Bildschirm. Die Extras stehen in einem gleichmäßigen Raster statt in Spalten.
describe('Kasse-Template — Sheet über Raster und Ziffernleiste (core#909)', () => {
  const scss = readFileSync(fileURLToPath(new URL('./order-dialog.component.scss', import.meta.url)), 'utf8')
  const panel = readFileSync(fileURLToPath(new URL('./product-customize-panel.component.ts', import.meta.url)), 'utf8')
  const block = (selektor: string) => {
    const ab = scss.slice(scss.indexOf(selektor))
    return ab.slice(0, ab.indexOf('}'))
  }

  it('hängt beide Sheets in einen eigenen Host außerhalb der Rasterzone', () => {
    const raster = template.indexOf('<div class="kasse__grid ')
    const host = template.indexOf('<div class="kasse__sheet-host">')
    expect(host).toBeGreaterThan(raster)
    const hostBlock = template.slice(host, template.indexOf('PRIMÄRTASTE', host))
    expect(hostBlock).toContain('@if (payment(); as pending)')
    expect(hostBlock).toContain('@if (customizeModel(); as model)')
    expect(template.slice(raster, host)).not.toContain('kasse__sheet')
    expect(template.slice(raster, host)).toContain('@if (!customizeModel())')
  })

  it('spannt den Host über Raster- und Ziffernzone derselben Spalte und füllt ihn bis unten', () => {
    expect(block('.kasse__sheet-host {')).toContain('grid-area: grid-start / grid-start / keys-end / grid-end')
    expect(block('.kasse__sheet {')).toMatch(/inset: 0;/)
    expect(block('.kasse__sheet {')).toContain('border-radius: 1rem 1rem 0 0')
    expect(block('.kasse__sheet {')).toContain('border-bottom-width: 0')
  })

  it('ordnet die Extras als Raster gleich breiter Spalten, nicht als Spalten-Liste', () => {
    expect(panel).toContain('grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]')
    expect(panel).not.toMatch(/columns-\[|column-fill/)
  })
})

// Bezahlansicht „nur Bar" (core#831): Das Template verdrahtet die Primärtaste und die Ansicht; die Logik prüft
// order-dialog.component.spec.ts. Hier nur, dass die Bindungen stehen.
describe('Kasse-Template — Bezahlansicht (core#831)', () => {
  const start = template.indexOf('@if (payment(); as pending)')
  const ansicht = template.slice(start, template.indexOf('<!-- Anpassen-Sheet', start))

  it('beschriftet die Primärtaste im Kassenbetrieb mit „Bezahlen"', () => {
    expect(template).toContain("(paysAtCounter() ? 'ORDER_DIALOG.PAY' : 'ORDER_DIALOG.ORDER') | translate")
  })

  it('zeigt die Ansicht als Sheet und reicht Summe, Sperre und beide Ausgänge durch', () => {
    expect(start).toBeGreaterThan(-1)
    expect(ansicht).toContain('kasse__sheet')
    expect(ansicht).toContain('[total]="pending.total"')
    expect(ansicht).toContain('[busy]="paying()"')
    expect(ansicht).toContain('(collect)="onCollect()"')
    expect(ansicht).toContain('(keepOpen)="onKeepOpen()"')
  })

  it('hat keinen Weg am Sheet vorbei: der Scrim reagiert nicht auf Tipps', () => {
    const scrim = ansicht.slice(0, ansicht.indexOf('</div>'))
    expect(scrim).not.toContain('(click)')
  })
})

describe('Bezahlansicht-Template — Karte und Gutschein (core#831)', () => {
  const view = readFileSync(fileURLToPath(new URL('./cash-payment.component.html', import.meta.url)), 'utf8')

  it('zeigt Karte und Gutschein, aber nicht antippbar und mit „bald"', () => {
    const block = view.slice(
      view.indexOf("@for (method of ['PAYMENT_CARD'"),
      view.indexOf('</button>', view.indexOf('PAYMENT_SOON')),
    )
    expect(block).toContain('disabled')
    expect(block).toContain("'ORDER_DIALOG.PAYMENT_SOON' | translate")
    expect(block).not.toContain('(click)')
  })

  it('sperrt „Bar kassieren", bis der Betrag gedeckt ist, und während des Abschlusses', () => {
    expect(view).toContain('[disabled]="busy() || !canCollect()"')
  })
})

// core#1021: Die Steuerleiste einer unteren Zeile lag halb unter dem Listenrand. Gerendert wird hier nichts (Node),
// deshalb prüft die Spec die Verdrahtung an der Quelle; was der Helfer tut, prüft cart-scroll.spec.ts.
describe('Kasse — markierte Zeile in den Sichtbereich (core#1021)', () => {
  const component = readFileSync(fileURLToPath(new URL('./order-dialog.component.ts', import.meta.url)), 'utf8')
  const leiste = template.slice(template.indexOf('<ng-template #steuerleiste>'))
  // Der öffnende Tag der Leiste selbst — Kommentare davor zählen nicht.
  const tag = leiste.match(/<div\s[^>]*role="toolbar"/)?.[0] ?? ''

  it('markiert die eine Steuerleiste, die alle Zeilenarten teilen', () => {
    expect(template.match(/#selectionToolbar\b/g)).toHaveLength(1)
    expect(tag).toMatch(/\s#selectionToolbar\s/)
    expect(template.match(/\[ngTemplateOutlet\]="steuerleiste"/g)).toHaveLength(3)
  })

  it('scrollt nach jedem neuen Rendern der Leiste, mit ihrem Außenabstand', () => {
    expect(component).toContain("viewChild<ElementRef<HTMLElement>>('selectionToolbar')")
    expect(component).toContain('effect(() => revealCartSelection(this.selectionToolbar()?.nativeElement))')
    expect(tag.match(/class="([^"]*)"/)?.[1].split(/\s+/)).toContain('scroll-mb-2')
  })
})

// core#1020: Auf der Sunmi passten nur 3×4 Produkte. Kachel und Funktionstaste schrumpfen auf rund 0,6 der Fläche,
// bleiben aber gemeinsam ein Maß (code-style.md §9.1) und ein Touch-Ziel ≥ 48 px.
describe('Kasse — Kachelmaß (core#1020)', () => {
  const scss = readFileSync(fileURLToPath(new URL('./order-dialog.component.scss', import.meta.url)), 'utf8')
  const kasse = scss.slice(scss.indexOf('.kasse {'), scss.indexOf("&[data-hand='right']"))
  const rem = (token: string) => Number(kasse.match(new RegExp(`--${token}: (\\d+(?:\\.\\d+)?)rem;`))?.[1])

  it('verkleinert die Kachel gegenüber 12,5 × 6,5rem auf etwa 0,6 der Fläche', () => {
    const anteil = (rem('pnry-tile-min') * rem('pnry-tile-h')) / (12.5 * 6.5)
    expect(anteil).toBeGreaterThanOrEqual(0.55)
    expect(anteil).toBeLessThanOrEqual(0.65)
  })

  it('hält Breite und Höhe über 48 px bei Dichte 1', () => {
    expect(rem('pnry-tile-min') * 16).toBeGreaterThanOrEqual(48)
    expect(rem('pnry-tile-h') * 16).toBeGreaterThanOrEqual(48)
  })

  it('gibt Produktkachel und Funktionstaste dieselbe Höhe aus dem Token, ohne festes Maß daneben', () => {
    expect(template.match(/h-\[var\(--pnry-tile-h\)\]/g)).toHaveLength(2)
    expect(template).toContain('w-[var(--pnry-tile-min)] h-[var(--pnry-tile-h)]')
    expect(template).toContain('minmax(var(--pnry-tile-min),1fr)')
    expect(template).not.toMatch(/h-\[6\.5rem\]/)
  })
})
