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
