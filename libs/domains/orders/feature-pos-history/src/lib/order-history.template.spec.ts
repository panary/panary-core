import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./order-history.component.html', import.meta.url)), 'utf8')

describe('Historie-Template (core#975)', () => {
  it('enthält keine Lila-Klassen mehr', () => {
    expect(source.match(/\b[\w:-]*-purple-\d{2,3}\b/g) ?? []).toEqual([])
  })

  it('hat kein Klassen-Binding ohne Klassennamen', () => {
    expect(source.match(/\[class\.\]/g) ?? []).toEqual([])
  })

  it('liegt im Split-Layout mit 820-px-Liste', () => {
    expect(source).toContain('listMaxWidth="51.25rem"')
  })
})

describe('Historie-Kopf (core#975)', () => {
  it('nutzt den gemeinsamen Seitenkopf ohne eigenen Zurück-Pfeil', () => {
    expect(source).toContain('<lib-page-header')
    expect(source).not.toContain('goBack()')
  })
})
