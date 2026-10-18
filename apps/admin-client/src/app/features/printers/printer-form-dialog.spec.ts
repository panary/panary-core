import { TestBed } from '@angular/core/testing'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { describe, expect, it, vi } from 'vitest'

import { PrinterFormDialogComponent, type PrinterFormData } from './printer-form-dialog'

// #759: Ein Bestandsdrucker ohne `paperWidth` druckt 80 mm, die Maske stand aber
// leer. Direkt instanziiert (Muster admin-layout.spec): geprueft wird das
// Formularmodell, an das das `<select>` bindet.
function createDialog(data: PrinterFormData | null): PrinterFormDialogComponent {
  TestBed.configureTestingModule({
    providers: [
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: MAT_DIALOG_DATA, useValue: data },
    ],
  })
  return TestBed.runInInjectionContext(() => new PrinterFormDialogComponent())
}

const bestand = (overrides: Partial<PrinterFormData> = {}): PrinterFormData => ({
  pid: 'p-1',
  active: true,
  type: 'ip',
  name: 'Theke',
  ip: '192.168.1.50',
  port: 9100,
  ...overrides,
})

describe('PrinterFormDialogComponent — Papierbreite beim Bearbeiten (#759)', () => {
  it('Bestandsdrucker ohne paperWidth → 80mm, wie gedruckt wird', () => {
    expect(createDialog(bestand()).form.paperWidth).toBe('80mm')
  })

  it('Bestandsdrucker mit 58mm bleibt 58mm', () => {
    expect(createDialog(bestand({ paperWidth: '58mm' })).form.paperWidth).toBe('58mm')
  })

  it('neuer Drucker → 80mm', () => {
    expect(createDialog(null).form.paperWidth).toBe('80mm')
  })
})
