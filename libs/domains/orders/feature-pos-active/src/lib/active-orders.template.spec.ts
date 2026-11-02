import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isOrderOpen, OrderStatus } from '@panary/orders/domain'

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
    expect(template.match(/extra\.priceFormatted\s*\}\}<\/span\s*>/g)).toHaveLength(3)
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

// core#1125: Die Kachel einer Bestellung ohne Tisch zeigte den synthetischen Abrechnungskreis
// roh als „auto:7539ce3e-b8…“. Echte Kreise bleiben sichtbar.
describe('Offene Bestellungen — Abrechnungskreis (core#1125)', () => {
  const template = read('./active-orders.component.html')
  const chip = template.slice(
    template.indexOf('} @else if (order.settlementScope'),
    template.indexOf('@if (order.pager)'),
  )

  it('zeigt den Kreis nur, wenn er nicht synthetisch ist', () => {
    expect(chip).toMatch(/@else if \(order\.settlementScope && !isSyntheticSettlementScope\(order\.settlementScope\)\)/)
    expect(chip).toMatch(/\{\{ order\.settlementScope \}\}/)
  })
})

// core#1141: Eine Karte je Abrechnungskreis. Die Gruppierung selbst prüft `open-order-groups.spec.ts` in der
// Domain-Lib; hier steht, dass die Liste sie benutzt und die Summe nicht selbst gerechnet wird.
describe('Offene Bestellungen — Karte je Abrechnungskreis (core#1141)', () => {
  const template = read('./active-orders.component.html')
  const component = read('./active-orders.component.ts')
  const circle = template.slice(template.indexOf(`entry.kind === 'circle'`), template.indexOf('@let vm = entry.vm'))

  it('die Liste läuft über die gruppierten Einträge und nutzt den Domain-Helfer', () => {
    expect(template).toMatch(/@for \(entry of entries\(\); track entry\.key\)/)
    expect(component).toMatch(/groupOpenOrdersBySettlementScope\(this\.sortedOrders\(\)\)/)
  })

  it('die Kreis-Karte zeigt Tisch, Zahl, Zeit seit der ersten Bestellung und Summe, und klappt auf', () => {
    expect(circle).toMatch(/data-testid="circle-title"/)
    expect(circle).toMatch(/CIRCLE_TITLE' \| translate: \{ table: entry\.table, count: entry\.orderCount \}/)
    expect(circle).toMatch(/data-testid="circle-since"/)
    expect(circle).toMatch(/data-testid="circle-total"/)
    expect(circle).toMatch(/\(click\)="toggleCircle\(entry\.key\)"/)
    expect(circle).toMatch(/\[attr\.aria-expanded\]="entry\.expanded"/)
  })

  it('die Summe kommt aus dem Domain-Helfer, der Cent-Beträge der Einzelkarten addiert (open-order-groups.spec.ts)', () => {
    expect(component).toMatch(/openOrderCircleTotalCents\(entry\.orders, order => this\.calculateTotal\(order\)\)/)
    expect(circle).toMatch(/@if \(entry\.totalFormatted; as total\)/)
  })
})

// core#1257: Die Menge steht erst ab 2 da, wie im Bestelldialog (#795) und auf dem Bon. Die Mengenzelle bleibt
// stehen, sonst rückt der Name im dreispaltigen Raster in die Mengenspalte.
describe('Offene Bestellungen — Menge erst ab 2 (core#1257)', () => {
  const template = read('./active-orders.component.html')
  const raster = template
    .split('data-testid="line-grid"')
    .slice(1)
    .map(teil => teil.slice(0, teil.indexOf('line.lineTotalFormatted')))

  it('jede Position blendet die Menge 1 innerhalb der Mengenzelle aus', () => {
    expect(raster).toHaveLength(2)
    for (const teil of raster) {
      expect(teil.replace(/\s+/g, ' ')).toMatch(
        /<span class="font-bold[^"]*"> @if \(item\.amount > 1\) \{ \{\{ item\.amount \}\}x \} <\/span> <span class="text-ink/,
      )
    }
    expect(template).not.toMatch(/<span class="font-bold[^"]*">\{\{ item\.amount \}\}x<\/span>/)
  })
})

// core#1264: Der Stempel „storniert" hing an `production` („Küche in Bearbeitung"). Ein echter Storno
// (`aborted`) erscheint hier nie, `ordersActive` filtert ihn über `isOrderOpen` heraus — der Stempel
// hatte also keinen richtigen Anlass und ist entfernt.
describe('Offene Bestellungen — kein Storno-Stempel für production (core#1264)', () => {
  const template = read('./active-orders.component.html')
  const styles = read('./active-orders.component.scss')
  const component = read('./active-orders.component.ts')

  it('rendert keinen Storno-Stempel und keine Statusbedingung auf production', () => {
    expect(template).not.toContain('stamp-canceled')
    expect(template).not.toContain('ACTIVE_ORDERS.CANCELED')
    expect(template).not.toContain('OrderStatus.PRODUCTION')
    expect(styles).not.toContain('.stamp-canceled')
  })

  it('die Liste bleibt auf offene Bestellungen beschränkt, aborted gehört nicht dazu', () => {
    expect(component).toContain('this.#orderService.ordersActive()')
    expect(isOrderOpen(OrderStatus.PRODUCTION)).toBe(true)
    expect(isOrderOpen(OrderStatus.ABORTED)).toBe(false)
  })
})

// core#1140: „Nachbestellen" an Einzel- und Kreis-Karte öffnet die Kasse mit Tisch und Kreis, nur mit Tisch.
describe('Offene Bestellungen — Nachbestellen (core#1140)', () => {
  const template = read('./active-orders.component.html')
  const component = read('./active-orders.component.ts')
  const circle = template.slice(template.indexOf(`entry.kind === 'circle'`), template.indexOf('@let vm = entry.vm'))
  const overlay = template.slice(template.indexOf('<!-- Selection Overlay -->'), template.indexOf("'staff-meal'"))

  it('die Kreis-Karte trägt die Aktion über der Karte, nicht im Aufklapp-Button', () => {
    const actions = circle.slice(0, circle.indexOf('data-testid="circle-card"'))
    expect(actions).toMatch(/@if \(entry\.reorder; as preset\)/)
    expect(actions).toMatch(/data-testid="circle-reorder"/)
    expect(actions).toMatch(/\(click\)="reorder\(preset\)"/)
  })

  it('die Einzelkarte bietet die Aktion im Overlay nur mit Vorbelegung an', () => {
    expect(overlay).toMatch(/@if \(vm\.reorder; as preset\)/)
    expect(overlay).toMatch(/data-testid="order-reorder"/)
  })

  it('die Vorbelegung kommt aus dem Domain-Helfer und reist per Einmal-Übergabe zur Kasse', () => {
    expect(component.match(/reorder: kasseReorderFor\(/g)).toHaveLength(2)
    const reorder = component.slice(component.indexOf('  reorder(preset'), component.indexOf('  toggleCircle('))
    expect(reorder).toMatch(/#reorderHandoff\.offer\(preset\)/)
    expect(reorder).not.toMatch(/state:/)
    // Scheitert die Navigation, wird die Vorbelegung wieder genommen.
    expect(reorder.match(/#reorderHandoff\.take\(\)/g)).toHaveLength(2)
  })
})

// core#1142: „Tisch kassieren" an der Kreis-Karte — ein Bezahlvorgang über alle offenen Bestellungen des Kreises.
describe('Offene Bestellungen — Tisch kassieren (core#1142)', () => {
  const template = read('./active-orders.component.html')
  const component = read('./active-orders.component.ts')
  const circle = template.slice(template.indexOf(`entry.kind === 'circle'`), template.indexOf('@let vm = entry.vm'))
  const single = template.slice(template.indexOf('@let vm = entry.vm'))
  const checkout = component.slice(component.indexOf('  async checkoutCircle('), component.indexOf('  toggleCircle('))

  it('steht nur an der Kreis-Karte, über der Karte, und nur mit Zahlliste', () => {
    const actions = circle.slice(0, circle.indexOf('data-testid="circle-card"'))
    expect(actions).toMatch(/@if \(entry\.checkout\)/)
    expect(actions).toMatch(/data-testid="circle-checkout"/)
    expect(actions).toMatch(/\(click\)="checkoutCircle\(entry\)"/)
    expect(single).not.toMatch(/checkoutCircle/)
  })

  it('Zahlliste und gezahlter Teil kommen aus den Domain-Helfern', () => {
    expect(component).toMatch(/checkout: tableCheckoutPlan\(entry\.orders, order => this\.calculateTotal\(order\)\)/)
    expect(component).toMatch(/settledCount: settledOrdersInCircle\(this\.#orderService\.orders\(\)/)
    expect(circle).toMatch(/@if \(entry\.settledCount > 0\)/)
  })

  it('kassiert im Kassenbetrieb über die Bezahlansicht mit Summe aus denselben Cent-Beträgen', () => {
    expect(checkout).toMatch(/total: fromCents\(sumCents\(plan\.map\(item => item\.totalCents\)\)\)/)
    expect(checkout).toMatch(/total: fromCents\(item\.totalCents\)/)
    expect(checkout).toMatch(/open<CashPaymentDialogComponent/)
    expect(checkout).not.toMatch(/payCash/)
  })

  it('schließt im Bestellbetrieb nur ab und hält beim ersten Fehler an', () => {
    expect(checkout.indexOf('!this.#isCashierMode()')).toBeLessThan(checkout.indexOf('#orderService.complete'))
    expect(checkout).toMatch(/catch \{[\s\S]*?return\s*\}/)
  })
})
