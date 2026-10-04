import { BindingType, parseTemplate, type TmplAstNode } from '@angular/compiler'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Die Komponenten-Spec instanziiert den Dialog direkt und rendert das Template nicht —
// deshalb hier ein Blick auf die Quelle: Beilage und Getraenk eines Menues sind Objekte,
// ausgegeben werden darf nur ihr Name (#564: „Getraenk: [object Object]" in der Kombination).
const template = readFileSync(fileURLToPath(new URL('./order-dialog.component.html', import.meta.url)), 'utf8')

describe('OrderDialog-Template — Menue-Beilage und -Getraenk (#564)', () => {
  it('gibt menuSideDish und menuDrink nie als Objekt aus', () => {
    expect(template.match(/\{\{\s*lineItem\.(menuSideDish|menuDrink)\s*(\|\||\}\}|\|)/g)).toBeNull()
  })

  it('zeigt in Einzel- und Kombinationszeile je den Namen', () => {
    expect(template.match(/\{\{\s*lineItem\.menuSideDish\?\.name \|\| 'ohne' \}\}/g)).toHaveLength(2)
    expect(template.match(/\{\{\s*lineItem\.menuDrink\?\.name \|\| 'ohne' \}\}/g)).toHaveLength(2)
  })
})

// Angular trennt den Namen einer [class.…]-Bindung am Punkt: [class.translate-y-[0.3125rem]]
// band nur „translate-y-[0" — eine Klasse ohne CSS, die Menue-Striche wurden nie zum „X" (#573).
type BindingNode = TmplAstNode & {
  inputs?: { name: string; type: BindingType; value: { source?: string | null } }[]
  children?: BindingNode[]
  branches?: BindingNode[]
  cases?: BindingNode[]
}

function collectInputs(nodes: BindingNode[], out: NonNullable<BindingNode['inputs']> = []) {
  for (const node of nodes) {
    out.push(...(node.inputs ?? []))
    for (const key of ['children', 'branches', 'cases'] as const) collectInputs(node[key] ?? [], out)
  }
  return out
}

describe('OrderDialog-Template — Klassenbindungen (#573)', () => {
  const parsed = parseTemplate(template, 'order-dialog.component.html', {})
  const inputs = collectInputs(parsed.nodes as BindingNode[])

  it('parst fehlerfrei', () => {
    expect(parsed.errors ?? []).toEqual([])
  })

  it('bindet keinen am Punkt abgeschnittenen Klassennamen', () => {
    const truncated = inputs
      .filter(i => i.type === BindingType.Class)
      .map(i => i.name)
      .filter(name => (name.match(/\[/g) ?? []).length !== (name.match(/\]/g) ?? []).length)
    expect(truncated).toEqual([])
  })

  it('verschiebt die aeusseren Menue-Striche um den vollen Wert', () => {
    const sources = inputs.filter(i => i.type === BindingType.Property && i.name === 'class').map(i => i.value.source)
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'translate-y-[0.3125rem] rotate-45'"),
        expect.stringContaining("'-translate-y-[0.3125rem] -rotate-45'"),
      ]),
    )
  })
})
