import { describe, expect, it } from 'vitest'
import { slugifyHandle } from './slugify.util'

describe('slugifyHandle', () => {
  it('lowercases and dashes simple words', () => {
    expect(slugifyHandle('Burger Heaven')).toBe('burger-heaven')
  })

  it('maps German umlauts and ß to ASCII equivalents', () => {
    expect(slugifyHandle('Café Brötchen')).toBe('cafe-broetchen')
  })

  it('trims surrounding whitespace and collapses repeated whitespace', () => {
    expect(slugifyHandle('  Spaces   ')).toBe('spaces')
  })

  it('strips punctuation but keeps digits', () => {
    expect(slugifyHandle('123 Numbers!')).toBe('123-numbers')
  })

  it('returns empty string for empty input', () => {
    expect(slugifyHandle('')).toBe('')
  })

  it('caps length at 60 characters', () => {
    expect(slugifyHandle('a'.repeat(80)).length).toBe(60)
  })

  it('strips leading and trailing dashes', () => {
    expect(slugifyHandle('---leading-trailing---')).toBe('leading-trailing')
  })

  it('collapses mixed separator runs to one dash', () => {
    expect(slugifyHandle('a - _ - b')).toBe('a-b')
    expect(slugifyHandle('-!-a-!-')).toBe('a')
  })

  it('trims long dash runs at both edges', () => {
    expect(slugifyHandle('-'.repeat(100_000) + 'x' + '-'.repeat(100_000))).toBe('x')
    expect(slugifyHandle('a-'.repeat(100_000) + '!')).toBe('a-'.repeat(30))
  })
})
