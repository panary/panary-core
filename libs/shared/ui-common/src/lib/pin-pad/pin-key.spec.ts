import { pinKeyAction } from './pin-key'

const key = (k: string, extra: Partial<Parameters<typeof pinKeyAction>[0]> = {}) =>
  pinKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra })

describe('pinKeyAction', () => {
  it.each(['0', '1', '5', '9'])('Ziffer %s ergibt eine Ziffern-Aktion', digit => {
    expect(key(digit)).toEqual({ type: 'digit', digit })
  })

  it.each(['Backspace', 'Delete'])('%s loescht eine Stelle', k => {
    expect(key(k)).toEqual({ type: 'backspace' })
  })

  it.each(['a', 'Z', '-', '.', ' ', 'Enter', 'Escape', 'Tab', 'ArrowLeft', '10', '²', '٣'])('ignoriert %j', k => {
    expect(key(k)).toBeNull()
  })

  it('ignoriert Kuerzel mit Strg, Cmd oder Alt (z. B. Cmd+1, Strg+Backspace)', () => {
    expect(key('1', { metaKey: true })).toBeNull()
    expect(key('1', { ctrlKey: true })).toBeNull()
    expect(key('1', { altKey: true })).toBeNull()
    expect(key('Backspace', { metaKey: true })).toBeNull()
  })

  it('wiederholt eine gehaltene Ziffer nicht, Backspace schon', () => {
    expect(key('7', { repeat: true })).toBeNull()
    expect(key('Backspace', { repeat: true })).toEqual({ type: 'backspace' })
  })
})
