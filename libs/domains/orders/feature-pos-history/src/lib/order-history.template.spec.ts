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

// core#1024: ID und Aktionen standen unter dem Bon und waren erst nach Scrollen erreichbar.
describe('Historie: ID und Aktionen im Detailkopf (core#1024)', () => {
  const kopf = source.slice(source.indexOf('data-testid="detail-head"'), source.indexOf('<!-- Detail Content -->'))

  it('Kopf und scrollender Inhalt sind im Template auffindbar, der Kopf steht davor', () => {
    expect(source.indexOf('data-testid="detail-head"')).toBeGreaterThan(-1)
    expect(source.indexOf('<!-- Detail Content -->')).toBeGreaterThan(source.indexOf('data-testid="detail-head"'))
  })

  it('der Kopf trägt ID, Drucken und Stornieren', () => {
    expect(kopf).toContain('data-testid="detail-id"')
    expect(kopf).toContain('selectedOrder()?._id')
    expect(kopf).toContain('(click)="printOrder()"')
    expect(kopf).toContain('(click)="cancelOrder()"')
  })

  it('der scrollende Inhalt enthält weder ID noch Aktionen', () => {
    const inhalt = source.slice(source.indexOf('<!-- Detail Content -->'))
    expect(inhalt).not.toContain('printOrder()')
    expect(inhalt).not.toContain('cancelOrder()')
    expect(inhalt).not.toContain('selectedOrder()?._id')
  })
})

// core#1054: „ID" klebte an der Nummer.
describe('Historie: ID mit Abstand (core#1054)', () => {
  it('die ID-Beschriftung hat Abstand zur Nummer', () => {
    expect(source).toContain('<span class="font-bold uppercase mr-1">ID</span>')
  })
})
