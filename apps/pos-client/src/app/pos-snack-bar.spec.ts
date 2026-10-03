// Rangfolge quittierpflichtiger Meldungen (core#531) — gegen den ECHTEN `MatSnackBar`,
// nicht gegen einen Mock: Der Befund des Issues lag genau in Materials Semantik
// („eine Meldung zur Zeit", `dismiss()` schliesst die gerade offene), die ein Mock
// nicht nachbildet. Die Dialog-Spec zaehlte nur `open`-Aufrufe und blieb deshalb gruen,
// waehrend die Rabattcode-Meldung in jedem Fall sofort wieder verschwand.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestBed } from '@angular/core/testing'
import { MATERIAL_ANIMATIONS } from '@angular/material/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { PosSnackBar, providePosSnackBar } from './pos-snack-bar'

/** Enter/Exit laufen ohne Animation ueber Microtasks — ein Makrotask reicht, um sie abzuwarten. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

describe('PosSnackBar', () => {
  let snackBar: MatSnackBar

  /** Was gerade angezeigt wird — `null`, wenn keine Snackbar offen ist. */
  const shown = (): string | null => snackBar._openedSnackBarRef?.instance?.data?.message ?? null

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [providePosSnackBar(), { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    })
    snackBar = TestBed.inject(MatSnackBar)
  })

  afterEach(async () => {
    snackBar.ngOnDestroy()
    await settle()
  })

  it('ist app-weit unter dem MatSnackBar-Token bereitgestellt', () => {
    expect(snackBar).toBeInstanceOf(PosSnackBar)
  })

  it('eine Kurzmeldung verdraengt die quittierpflichtige, danach kehrt diese zurueck', async () => {
    snackBar.open('Rabattcode nicht eingelöst', 'OK')
    await settle()
    const transient = snackBar.open('Bestellungen aktualisiert', 'OK', { duration: 5000 })
    await settle()

    expect(shown()).toBe('Bestellungen aktualisiert')

    transient.dismiss() // Ablauf der duration
    await settle()

    expect(shown()).toBe('Rabattcode nicht eingelöst')
  })

  it('kehrt auch nach echtem Ablauf einer duration zurueck', async () => {
    snackBar.open('Rabattcode nicht eingelöst', 'OK')
    snackBar.open('Bestellungen aktualisiert', 'OK', { duration: 20 })
    await settle()

    expect(shown()).toBe('Bestellungen aktualisiert')

    await new Promise(resolve => setTimeout(resolve, 60))
    await settle()

    expect(shown()).toBe('Rabattcode nicht eingelöst')
  })

  it('dismiss() schliesst sie nicht endgueltig', async () => {
    // Genau der Weg aus #270: `#invalidateUndo` rief `matSnackBar.dismiss()`.
    snackBar.open('Rabattcode nicht eingelöst', 'OK')
    await settle()

    snackBar.dismiss()
    await settle()

    expect(shown()).toBe('Rabattcode nicht eingelöst')
  })

  it('erst der Tipp auf ihre Aktion beendet sie', async () => {
    const sticky = snackBar.open('Rabattcode nicht eingelöst', 'OK')
    await settle()

    sticky.dismissWithAction()
    await settle()
    expect(shown()).toBeNull()

    const transient = snackBar.open('Bestellungen aktualisiert', 'OK', { duration: 5000 })
    await settle()
    transient.dismiss()
    await settle()

    expect(shown()).toBeNull()
  })

  it('auch eine zurueckgekehrte endet mit dem Tipp auf ihre Aktion', async () => {
    snackBar.open('Rabattcode nicht eingelöst', 'OK')
    snackBar.dismiss()
    await settle()

    snackBar._openedSnackBarRef?.dismissWithAction()
    await settle()
    snackBar.dismiss()
    await settle()

    expect(shown()).toBeNull()
  })

  it('ein „Rueckgaengig" funktioniert, waehrend sie wartet', async () => {
    snackBar.open('Rabattcode nicht eingelöst', 'OK')
    await settle()
    const undo = snackBar.open('Menge: 2× Brötchen', 'Rückgängig', { duration: 6000 })
    let undone = false
    undo.onAction().subscribe(() => (undone = true))
    await settle()

    undo.dismissWithAction()
    await settle()

    expect(undone).toBe(true)
    expect(shown()).toBe('Rabattcode nicht eingelöst')
  })

  it('mehrere Kurzmeldungen hintereinander: sie kehrt erst nach der letzten zurueck', async () => {
    snackBar.open('Rabattcode nicht eingelöst', 'OK')
    const first = snackBar.open('Menge: 2× Brötchen', 'Rückgängig', { duration: 6000 })
    await settle()
    const second = snackBar.open('Menge: 3× Brötchen', 'Rückgängig', { duration: 6000 })
    await settle()

    expect(first.instance.data.message).toBe('Menge: 2× Brötchen')
    expect(shown()).toBe('Menge: 3× Brötchen')

    second.dismiss()
    await settle()

    expect(shown()).toBe('Rabattcode nicht eingelöst')
  })

  it('ohne quittierpflichtige Meldung bleibt nach einer Kurzmeldung nichts stehen', async () => {
    const transient = snackBar.open('Bestellungen aktualisiert', 'OK', { duration: 5000 })
    await settle()
    transient.dismiss()
    await settle()

    expect(shown()).toBeNull()
  })

  it('ohne Aktion ist eine Meldung nicht quittierpflichtig', async () => {
    // Ohne Aktion gaebe es keinen Weg, sie je zu beenden.
    snackBar.open('Hinweis ohne Knopf')
    await settle()
    snackBar.dismiss()
    await settle()

    expect(shown()).toBeNull()
  })

  it('eine neue quittierpflichtige ersetzt eine aeltere offene', async () => {
    snackBar.open('Rabattcode nicht eingelöst', 'OK')
    snackBar.open('Zweite Meldung', 'OK')
    await settle()

    snackBar.dismiss()
    await settle()

    expect(shown()).toBe('Zweite Meldung')
  })
})
