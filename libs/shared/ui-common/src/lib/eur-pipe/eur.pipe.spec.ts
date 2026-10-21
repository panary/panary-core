import { EurPipe } from './eur.pipe'

describe('EurPipe', () => {
  const pipe = new EurPipe()

  it('formatiert de-DE', () => {
    expect(pipe.transform(16.5)).toBe('16,50 €')
  })

  it('liefert für null/undefined einen leeren Text', () => {
    expect(pipe.transform(null)).toBe('')
    expect(pipe.transform(undefined)).toBe('')
  })
})
