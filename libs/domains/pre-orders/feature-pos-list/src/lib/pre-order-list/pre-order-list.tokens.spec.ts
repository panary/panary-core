import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Tailwind-Farbklassen der alten Palette; Primär- und Akzentfarben kommen aus den App-Tokens (ADR 0058). */
const ALTE_PALETTE = /\b[\w:-]*-(?:indigo|violet|purple)-\d{2,3}\b/g

// core#894: „Neue Vorbestellung" und „Bestellung erstellen" waren nach dem Token-Umbau noch Indigo.
describe('Vorbestellungen nutzen die App-Tokens (core#894)', () => {
  it('das Template enthält keine Indigo-/Violett-Klassen', () => {
    const source = readFileSync(fileURLToPath(new URL('./pre-order-list.component.ts', import.meta.url)), 'utf8')
    expect(source.match(ALTE_PALETTE) ?? []).toEqual([])
  })

  it('die Primärtasten sind Mint mit Navy-Schrift', () => {
    const source = readFileSync(fileURLToPath(new URL('./pre-order-list.component.ts', import.meta.url)), 'utf8')
    expect(source.match(/bg-action text-on-action/g)?.length).toBe(3)
  })
})

// core#975: der date-Pipe folgt LOCALE_ID (en-US); Wochentage kommen deshalb über Intl.
describe('Vorbestellungen: Wochentag in der App-Sprache (core#975)', () => {
  it('formatiert den Wochentag nicht über die date-Pipe', () => {
    const source = readFileSync(fileURLToPath(new URL('./pre-order-list.component.ts', import.meta.url)), 'utf8')
    expect(source).not.toContain("date: 'EEEE")
    expect(source).toContain("weekday: 'long'")
  })
})

// core#1023: Der Auswahlring (ring-2, außen gezeichnet) wurde vom overflow der Liste links abgeschnitten.
describe('Vorbestellungen: Auswahlring bleibt sichtbar (core#1023)', () => {
  it('die scrollende Liste hat Innenabstand für den Ring', () => {
    const source = readFileSync(fileURLToPath(new URL('./pre-order-list.component.ts', import.meta.url)), 'utf8')
    const liste = source.match(/<div posSplitList class="([^"]*)"/)?.[1].split(' ') ?? []
    expect(liste).toEqual(expect.arrayContaining(['overflow-y-auto', 'p-1']))
    expect(source).toContain('[class.ring-2]="selectedOrder()?._id === order._id"')
  })
})

// core#1024: ID und Aktionen standen unter dem Bon und waren erst nach Scrollen erreichbar.
describe('Vorbestellungen: ID und Aktionen im Detailkopf (core#1024)', () => {
  const source = readFileSync(fileURLToPath(new URL('./pre-order-list.component.ts', import.meta.url)), 'utf8')
  const kopf = source.slice(source.indexOf('data-testid="detail-head"'), source.indexOf('<!-- Detail Content -->'))

  it('der Kopf trägt ID, Bestellung erstellen und Stornieren', () => {
    expect(kopf).toContain('data-testid="detail-id"')
    expect(kopf).toContain('selectedOrder()?._id')
    expect(kopf).toContain('convertToLiveOrder(selectedOrder()!)')
    expect(kopf).toContain('cancelOrder(selectedOrder()!)')
  })

  it('der scrollende Inhalt enthält keine Aktionen mehr', () => {
    const inhalt = source.slice(source.indexOf('<!-- Detail Content -->'), source.indexOf('<!-- Placeholder -->'))
    expect(inhalt).not.toContain('convertToLiveOrder(')
    expect(inhalt).not.toContain('cancelOrder(')
  })
})
