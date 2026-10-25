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

  it('lib-page-header spiegelt die Kopfzeile bei Rail links', () => {
    expect(quelle('../page-header/page-header.component.ts')).toContain(
      ":host-context([data-rail-side='left']) .page-header {\n        flex-direction: row-reverse;",
    )
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
