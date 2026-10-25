import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')

// core#1025: Ein Eintrag unter „Als Nächstes abholen" ließ sich antippen, tat aber nichts.
describe('Start: „Als Nächstes abholen" öffnet die Vorbestellung (core#1025)', () => {
  it('jeder Eintrag ist eine Taste, die openPreOrder aufruft', () => {
    const template = read('./dashboard.component.html')
    const eintrag = template.slice(template.indexOf('@for (preOrder of nextPreOrders()'), template.indexOf('} @empty'))
    expect(eintrag).toContain('<button')
    expect(eintrag).toContain('(click)="openPreOrder(preOrder)"')
  })

  it('openPreOrder navigiert mit ?select=<id> zu den Vorbestellungen', () => {
    expect(read('./dashboard.component.ts')).toContain(
      "this.#router.navigate(['/pre-orders'], { queryParams: { select: preOrder._id } })",
    )
  })

  it('die Vorbestellungen lesen ?select beim Laden', () => {
    expect(
      read('../../../../pre-orders/feature-pos-list/src/lib/pre-order-list/pre-order-list.component.ts'),
    ).toContain("queryParamMap.get('select')")
  })
})
