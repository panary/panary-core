import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Maus-Hover der Rail (core#959): Jeder Eintrag trägt `pnry-hover` (global in styles.scss, nur mit feinem Zeiger).
 * Die Tönung ist ein `background-image`; eine `background`-Kurzform in pos-rail.css setzte es zurück, und der
 * Hover fehlte gerade auf der eingestempelten Stempeltaste. `.is-active` und `:active` dürfen ihn bewusst überdecken.
 */
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const railItems = (source: string) => [...source.matchAll(/class="(rail-item[^"]*)"/g)].map(m => m[1].split(/\s+/))

describe('Rail — Maus-Hover (core#959)', () => {
  it('gibt jedem Rail-Eintrag die Klasse pnry-hover', () => {
    const items = [...railItems(read('./pos-rail.html')), ...railItems(read('./pos-time-clock.ts'))]
    expect(items).toHaveLength(4)
    expect(items.filter(classes => !classes.includes('pnry-hover'))).toEqual([])
  })

  it('setzt die Fläche nur für aktiv und gedrückt als Kurzform', () => {
    const css = read('./pos-rail.css')
    const shorthand = [...css.matchAll(/([^{}]+)\{[^}]*\bbackground:/g)].map(m => m[1].trim())
    expect(shorthand).toEqual(['.rail-item:active', '.rail-item.is-active'])
  })
})
