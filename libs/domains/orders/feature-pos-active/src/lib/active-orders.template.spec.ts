import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// core#807: Unter „Offene Bestellungen" stand unter einem Festpreis-Menü der volle Listenpreis des
// Getränks, und Menüs in einer Kombination zeigten Beilage und Getränk gar nicht.
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')

describe('Offene Bestellungen — Menü-Komponenten (core#807)', () => {
  const template = read('./active-orders.component.html')
  const component = read('./active-orders.component.ts')

  it('freie Positionen und Kombinationen rendern Beilage und Getränk über dieselbe Vorlage', () => {
    expect(template.match(/\[ngTemplateOutlet\]="menuParts"/g)).toHaveLength(2)
    expect(template.match(/<ng-template #menuParts let-line>/g)).toHaveLength(1)
  })

  it('der Preis unter der Komponente kommt aus menuComponentSurcharge, nicht aus dem Listenpreis', () => {
    expect(component).not.toMatch(/formatPrice\(item\.menu(SideDish|Drink)\.price\)/)
    expect(component).toMatch(/menuComponentSurcharge\(item, component, generalPrice\)/)
  })
})

// core#834: „Abschließen" kassiert im Kassenbetrieb nicht mehr selbst fest Bar, sondern öffnet die Bezahlansicht;
// der Bestellbetrieb (orders-only) schließt weiter ohne Zahlung ab.
describe('Offene Bestellungen — Abschließen (core#834)', () => {
  const component = read('./active-orders.component.ts')
  const finalize = component.slice(component.indexOf('async finalizeOrder'), component.indexOf('  #resolveCashierId()'))

  it('öffnet im Kassenbetrieb die Bezahlansicht und kassiert nicht selbst', () => {
    expect(finalize).toMatch(/open<CashPaymentDialogComponent/)
    expect(finalize).not.toMatch(/\.payCash\(/)
    expect(finalize).toMatch(/cashierId: performedById/)
    expect(finalize).toMatch(/\.\.\.CASH_PAYMENT_DIALOG_CONFIG/)
  })

  it('der Bestellbetrieb schließt weiter über complete() ab, vor dem Öffnen der Bezahlansicht', () => {
    expect(finalize.indexOf('#orderService.complete')).toBeGreaterThan(-1)
    expect(finalize.indexOf('#orderService.complete')).toBeLessThan(finalize.indexOf('open<CashPaymentDialogComponent'))
    expect(finalize.indexOf('!this.#isCashierMode()')).toBeLessThan(finalize.indexOf('#orderService.complete'))
  })
})

// core#973: Auf „Offen" entfällt die schwebende Leiste (sie verdeckte Rail und Avatar); die Kartengröße
// sitzt im Seitenkopf und wird je Gerät gespeichert.
describe('Offene Bestellungen — Kopf statt Leiste (core#973)', () => {
  const template = read('./active-orders.component.html')
  const component = read('./active-orders.component.ts')

  it('hat keine schwebende Leiste mehr, die Kartengröße steht im Seitenkopf', () => {
    expect(template).not.toMatch(/fixed bottom-6 right-6/)
    const header = template.slice(template.indexOf('<lib-page-header'), template.indexOf('</lib-page-header>'))
    expect(header).toMatch(/decreaseZoom\(\)/)
    expect(header).toMatch(/increaseZoom\(\)/)
  })

  it('speichert die Kartengröße in localStorage und liest sie beim Start', () => {
    expect(component).toMatch(/localStorage\.setItem\(ZOOM_STORAGE_KEY/)
    expect(component).toMatch(/signal\(readStoredZoom\(\)\)/)
  })
})

// core#1126: Bon-Karte mit Preisspalte, Kopf in einer Zeile und einem Overlay, das die Karte wachsen lässt statt
// auf kurzen Karten oben abgeschnitten zu werden.
describe('Offene Bestellungen — Bon-Karte (core#1126)', () => {
  const template = read('./active-orders.component.html')
  const component = read('./active-orders.component.ts')
  const menuParts = template.slice(
    template.indexOf('<ng-template #menuParts'),
    template.indexOf('<ng-template #componentModifiers'),
  )

  it('freie Positionen und Kombinationen stehen im Raster Menge | Name | Preis', () => {
    expect(template.match(/data-testid="line-grid"/g)).toHaveLength(2)
    expect(template.match(/grid-cols-\[[\d.]+rem_minmax\(0,1fr\)_auto\]/g)).toHaveLength(2)
  })

  it('jede Unterzeile trägt eine eigene Preiszelle rechtsbündig in der Preisspalte', () => {
    // Modifier: Name in Spalte 2, Preiszelle immer gerendert (auch leer), damit das Raster nicht verrutscht
    // Drei Stellen: freie Position, Kombination und Komponenten-Modifier (core#1127)
    expect(template.match(/extra\.priceFormatted\s*\}\}<\/span>/g)).toHaveLength(3)
    expect(template).not.toMatch(/@if \(extra\.priceFormatted\)/)
    expect(menuParts).not.toMatch(/@if \(line\.(sideDish|drink)PriceFormatted\)/)
    expect(menuParts.match(/text-right">\{\{/g)).toHaveLength(2)
  })

  it('Beilage und Getränk stehen in weißer Schrift, Modifier bleiben gedämpft', () => {
    expect(menuParts.match(/col-start-2 text-sm text-ink /g)).toHaveLength(2)
    expect(menuParts).not.toMatch(/text-xs text-ink-muted pl-2/)
  })

  it('der Modifier-Aufpreis trägt ein Plus wie der Menü-Aufpreis', () => {
    expect(component).toMatch(/priceFormatted: extra\.price > 0 \? `\+\$\{this\.formatPrice\(/)
  })

  it('der Kopf steht in einer Zeile, ohne „Uhr“', () => {
    expect(template).toMatch(/grid-cols-\[1fr_auto_1fr\] items-center gap-2" data-testid="receipt-head"/)
    expect(template).not.toMatch(/COMMON\.CLOCK/)
  })

  it('Overlay und Bon-Inhalt teilen eine Grid-Zelle, das Overlay ist nicht mehr absolut', () => {
    expect(template).toMatch(/class="grid grid-cols-1 grid-rows-\[minmax\(0,1fr\)\] w-full/)
    const overlay = template.slice(template.indexOf('<!-- Selection Overlay -->'), template.indexOf('order-overlay'))
    expect(overlay).toMatch(/row-start-1 col-start-1 min-h-0 /)
    expect(overlay).toMatch(/justify-center-safe/)
    expect(overlay).not.toMatch(/absolute inset-0/)
    expect(template).toMatch(
      /row-start-1 col-start-1 min-h-0 flex flex-col overflow-hidden" data-testid="order-receipt"/,
    )
  })
})

// core#1127: Modifier, die zu Beilage oder Getränk gewählt wurden, stehen unter der Komponente statt am Hauptartikel.
describe('Offene Bestellungen — Modifier je Menü-Komponente (core#1127)', () => {
  const template = read('./active-orders.component.html')
  const component = read('./active-orders.component.ts')
  const menuParts = template.slice(
    template.indexOf('<ng-template #menuParts'),
    template.indexOf('<ng-template #componentModifiers'),
  )
  const componentModifiers = template.slice(template.indexOf('<ng-template #componentModifiers'))

  it('gruppiert über den Domain-Helfer und lässt components[]-Modifier am Hauptartikel', () => {
    expect(component).toMatch(/groupModifiersByComponent\(item, \{ components: false \}\)/)
    expect(component).toMatch(/modifiers: groups\.main\.map/)
    expect(component).toMatch(/sideDishModifiers: groups\.sideDish\.map/)
    expect(component).toMatch(/drinkModifiers: groups\.drink\.map/)
  })

  it('Beilage und Getränk geben ihre Modifier direkt unter sich aus', () => {
    const side = menuParts.slice(menuParts.indexOf('menuSideDish.name'), menuParts.indexOf('@if (line.item.menuDrink)'))
    const drink = menuParts.slice(menuParts.indexOf('menuDrink.name'))
    expect(side).toMatch(/\$implicit: line\.sideDishModifiers/)
    expect(drink).toMatch(/\$implicit: line\.drinkModifiers/)
  })

  it('Komponenten-Modifier tragen ihre Preiszelle in der Preisspalte', () => {
    expect(componentModifiers).toMatch(/col-start-2 text-xs text-ink-muted pl-6/)
    expect(componentModifiers.match(/text-right">\{\{ extra\.priceFormatted \}\}/g)).toHaveLength(1)
  })
})
