import { parseTemplate, type TmplAstNode } from '@angular/compiler'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { touchKeyboardRows } from './touch-keyboard.component'

// Rabattcodes wie SOMMER25 brauchen Ziffern (panary/panary-core#749). Die Lib laeuft
// in `environment: 'node'`, deshalb Template-Parse statt TestBed.
const promoSource = readFileSync(fileURLToPath(new URL('./promo-code-dialog.component.ts', import.meta.url)), 'utf8')
const promoTemplate = promoSource.match(/template: `([\s\S]*?)`,\n/)![1]

const findElements = (nodes: TmplAstNode[], name: string): any[] =>
  nodes.flatMap((n: any) => [
    ...(n.name === name ? [n] : []),
    ...findElements([...(n.children ?? []), ...(n.branches ?? [])], name),
  ])

describe('touchKeyboardRows', () => {
  it('alphanumeric setzt die Ziffern 1–0 ueber die Buchstaben', () => {
    const rows = touchKeyboardRows('alphanumeric')
    expect(rows[0]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    expect(rows.slice(1)).toEqual(touchKeyboardRows('qwertz'))
  })

  it('qwertz bleibt ohne Ziffern', () => {
    expect(touchKeyboardRows('qwertz').flat().some(k => /\d/.test(k))).toBe(false)
  })
})

describe('Rabattcode-Dialog', () => {
  it('nutzt die Tastatur mit Ziffern', () => {
    const keyboards = findElements(parseTemplate(promoTemplate, 'promo.html').nodes, 'app-touch-keyboard')
    expect(keyboards).toHaveLength(1)
    const layout = keyboards[0].attributes.find((a: any) => a.name === 'layout')
    expect(layout?.value).toEqual('alphanumeric')
  })
})
