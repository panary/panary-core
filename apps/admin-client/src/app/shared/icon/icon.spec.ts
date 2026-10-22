import { TestBed } from '@angular/core/testing'
import { ICON_PATHS } from '@panary/shared/util-helpers'
import { describe, expect, it } from 'vitest'

import { AdminIconComponent } from './icon'
import { ADMIN_ICON_PATHS } from './icons.generated'

// core#825: Der Admin zeichnet Phosphor Regular aus der App-Registry, der POS Bold aus util-helpers.

function render(name: keyof typeof ADMIN_ICON_PATHS) {
  const fixture = TestBed.createComponent(AdminIconComponent)
  fixture.componentRef.setInput('name', name)
  fixture.detectChanges()
  return fixture
}

const drawnPath = (fixture: ReturnType<typeof render>) =>
  (fixture.nativeElement as HTMLElement).querySelector('svg path')?.getAttribute('d')

describe('AdminIconComponent', () => {
  it('zeichnet den Pfad des genannten Icons und folgt einem Namenswechsel', () => {
    const fixture = render('check')
    expect(drawnPath(fixture)).toBe(ADMIN_ICON_PATHS.check)

    fixture.componentRef.setInput('name', 'copy')
    fixture.detectChanges()
    expect(drawnPath(fixture)).toBe(ADMIN_ICON_PATHS.copy)
  })

  it('ist für Screenreader ausgeblendet', () => {
    const host = render('check').nativeElement as HTMLElement
    expect(host.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Admin-Icon-Registry', () => {
  it('führt Phosphor Regular, nicht die Bold-Pfade des POS', () => {
    expect(ADMIN_ICON_PATHS.check).not.toBe(ICON_PATHS.check)
  })

  it('führt je Icon einen Pfad, der mit einem Move-Befehl beginnt', () => {
    const invalid = (Object.entries(ADMIN_ICON_PATHS) as [string, string][])
      .filter(([, d]) => !/^M[-\d.,\s]/.test(d))
      .map(([name]) => name)
    expect(invalid).toEqual([])
  })
})
