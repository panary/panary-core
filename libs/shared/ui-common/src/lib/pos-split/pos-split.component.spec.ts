import { TestBed } from '@angular/core/testing'
import { PosSplitComponent } from './pos-split.component'

describe('PosSplitComponent', () => {
  it('setzt die Klassen aus reverse und detailOpen', () => {
    const fixture = TestBed.createComponent(PosSplitComponent)
    fixture.componentRef.setInput('reverse', true)
    fixture.componentRef.setInput('detailOpen', true)
    fixture.detectChanges()
    const classes = (fixture.nativeElement as HTMLElement).classList
    expect(classes.contains('pos-split--reverse')).toBe(true)
    expect(classes.contains('pos-split--detail-open')).toBe(true)
  })

  it('deckelt die Liste über listMaxWidth', () => {
    const fixture = TestBed.createComponent(PosSplitComponent)
    fixture.componentRef.setInput('listMaxWidth', '51.25rem')
    fixture.detectChanges()
    const list = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.pos-split__list')
    expect(list?.style.maxWidth).toBe('51.25rem')
  })
})
