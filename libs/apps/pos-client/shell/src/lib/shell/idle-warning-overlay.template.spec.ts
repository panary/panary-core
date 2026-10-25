import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Die Vorwarnung des Auto-Logouts lag unsichtbar unter der Rückfrage „Bestellung verwerfen?“ (core#1080): CDK-Dialoge
 * stehen im Top-Layer (core#1060), gegen den kein `z-index` hilft. Die Shell hat keine DOM-Umgebung (vitest `node`),
 * deshalb prüft der Spec die Quelle; ob der Browser sie wirklich über dem Dialog zeigt, belegt der Sichttest.
 */
const source = readFileSync(fileURLToPath(new URL('./idle-warning-overlay.component.ts', import.meta.url)), 'utf8')
const rootElement = /template: `\s*(<div[\s\S]*?>)/.exec(source)?.[1] ?? ''

describe('Vorwarnung des Auto-Logouts im Top-Layer (core#1080)', () => {
  it('die Wurzel der Vorwarnung ist ein manuelles Popover', () => {
    expect(rootElement).toMatch(/\spopover="manual"/)
    expect(rootElement).toMatch(/#layer\b/)
  })

  it('öffnet das Popover nach dem Rendern über syncTopLayer der Meldungsebene', () => {
    expect(source).toMatch(/import \{ syncTopLayer, type TopLayerElement \} from '@panary\/shared\/ui-notifications'/)
    expect(source).toMatch(/afterNextRender\(\(\) => \{[\s\S]*?syncTopLayer\(layer, true, 0\)/)
  })

  it('neutralisiert die Browser-Vorgaben für Popover (Rand, Breite, Höhe), damit die Fläche den Schirm deckt', () => {
    for (const cls of ['m-0', 'border-0', 'w-full', 'h-full', 'max-w-none', 'max-h-none']) {
      expect(rootElement.split(/\s+/)).toContain(cls)
    }
  })
})
