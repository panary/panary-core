import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), 'utf8')

// core#976: die Spiegelung hängt allein am Attribut der Shell, die Komponenten kennen die Shell nicht.
describe('Spiegelung mit der Bedienhand (core#976)', () => {
  it('lib-pos-split vertauscht die Seiten bei Rail links', () => {
    expect(quelle('./pos-split.component.ts')).toContain(
      ":host-context([data-rail-side='left']) {\n        flex-direction: row-reverse;",
    )
  })

  // core#1022: Die Aktionen stehen dem Titel gegenüber am rechten Rand, auch bei Rail links.
  it('lib-page-header spiegelt nicht: Titel links, Aktionen hinter dem Abstandhalter am rechten Rand', () => {
    const kopf = quelle('../page-header/page-header.component.ts')
    expect(kopf).not.toContain('data-rail-side')
    expect(kopf).not.toContain('row-reverse')
    expect(kopf).not.toContain('order:')
    expect(kopf.indexOf('page-header-spacer flex-1')).toBeGreaterThan(kopf.indexOf('{{ title() }}'))
    expect(kopf.indexOf('select="[pageHeaderActions]"')).toBeGreaterThan(kopf.indexOf('page-header-spacer flex-1'))
  })

  it('die Einstellungs-Navigation wechselt mit der Rail die Seite', () => {
    expect(quelle('../../../../../domains/devices/feature-pos-settings/src/lib/settings.component.html')).toContain(
      '[[data-rail-side=left]_&]:flex-row-reverse',
    )
  })

  it('die Shell setzt das Attribut', () => {
    expect(quelle('../../../../../apps/pos-client/shell/src/lib/shell/shell.ts')).toContain(
      '[attr.data-rail-side]="staff.railSide()"',
    )
  })
})
