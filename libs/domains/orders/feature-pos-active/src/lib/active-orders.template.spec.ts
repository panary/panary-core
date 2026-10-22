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
