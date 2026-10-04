import { BindingType, parseTemplate, type TmplAstNode } from '@angular/compiler'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Das mobile Slide-in der Arbeitszeiterfassung blieb auf dem Login dauerhaft ausgefahren
// und verdeckte die Benutzer-Kacheln ab Reihe 2 (core#572). Ursache war die Bindung
// `[class.translate-y-[calc(100%-4.5rem)]]`: Angular trennt den Bindungsnamen am Punkt
// und bindet `translate-y-[calc(100%-4` — eine Klasse, die es im CSS nicht gibt.
// Tailwind erkennt die volle Klasse sehr wohl, deshalb fiel es nirgends auf.
// Die Specs dieser Lib laufen ohne DOM; geprüft wird daher, was der Angular-Parser
// aus dem Template macht — genau die Stelle, an der der Fehler entstand.

const LIB_SRC = join(__dirname, '..')
const PANEL_TEMPLATE = join(__dirname, 'time-clock-panel.component.html')
const COLLAPSED_CLASS = 'translate-y-[calc(100%-4.5rem)]'

type AnyNode = TmplAstNode & {
  name?: string
  attributes?: { name: string; value: string }[]
  inputs?: { name: string; type: BindingType; value: { source?: string | null } }[]
  children?: AnyNode[]
  branches?: AnyNode[]
  cases?: AnyNode[]
}

function collectElements(nodes: AnyNode[], out: AnyNode[] = []): AnyNode[] {
  for (const node of nodes) {
    if (node.attributes && node.inputs) out.push(node)
    for (const key of ['children', 'branches', 'cases'] as const) collectElements(node[key] ?? [], out)
  }
  return out
}

function parseElements(file: string): AnyNode[] {
  const parsed = parseTemplate(readFileSync(file, 'utf8'), file, {})
  expect(parsed.errors ?? []).toEqual([])
  return collectElements(parsed.nodes as AnyNode[])
}

function templatesBelow(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return templatesBelow(path)
    return path.endsWith('.html') ? [path] : []
  })
}

describe('TimeClockPanel — mobiles Einklappen (core#572)', () => {
  it('bindet die Einklapp-Klasse vollständig über den [class]-Ausdruck', () => {
    const sheet = parseElements(PANEL_TEMPLATE).find(el =>
      el.attributes?.some(a => a.name === 'class' && a.value.includes('fixed inset-x-0 bottom-0')),
    )
    expect(sheet).toBeDefined()

    const classExpression = sheet?.inputs?.find(i => i.type === BindingType.Property && i.name === 'class')
    expect(classExpression?.value.source).toContain(`'${COLLAPSED_CLASS}'`)
    expect(classExpression?.value.source).toContain(`'translate-y-0'`)
  })

  it('kein Template der Lib bindet einen abgeschnittenen Klassennamen', () => {
    const truncated = templatesBelow(LIB_SRC).flatMap(file =>
      parseElements(file).flatMap(el =>
        (el.inputs ?? [])
          .filter(i => i.type === BindingType.Class)
          .filter(i => (i.name.match(/\[/g) ?? []).length !== (i.name.match(/\]/g) ?? []).length)
          .map(i => `${file}: ${i.name}`),
      ),
    )
    expect(truncated).toEqual([])
  })
})
