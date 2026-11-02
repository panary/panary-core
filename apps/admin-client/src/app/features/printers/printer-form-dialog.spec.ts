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
    expect(createDialog(bestand()).printer().paperWidth).toBe('80mm')
  })

  it('Bestandsdrucker mit 58mm bleibt 58mm', () => {
    expect(createDialog(bestand({ paperWidth: '58mm' })).printer().paperWidth).toBe('58mm')
  })

  it('neuer Drucker → 80mm', () => {
    expect(createDialog(null).printer().paperWidth).toBe('80mm')
  })
})

// core#1173: Der Dialog läuft auf Signal Forms. Geprüft wird über das gerenderte Template: Pflichtname
// und IP-Format sperren das Speichern nur für Netzwerkdrucker, die getippten Werte landen im Ergebnis,
// und ein geleerter Port fällt heraus statt als `null` am Schema zu scheitern.
async function render(data: PrinterFormData | null) {
  const close = vi.fn()
  await TestBed.configureTestingModule({
    imports: [PrinterFormDialogComponent],
    providers: [
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DIALOG_DATA, useValue: data },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(PrinterFormDialogComponent)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement
  async function type(id: string, value: string) {
    const field = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
    field.value = value
    // Auch die Auswahl im `<select>` feuert im Browser `input`; darauf hört `[formField]`.
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  async function submit() {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await fixture.whenStable()
  }
  const saveButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!
  return { el, close, type, submit, saveButton }
}

describe('PrinterFormDialogComponent — Formular (core#1173)', () => {
  it('sperrt Speichern ohne Namen und bei ungültiger IP', async () => {
    const { type, saveButton } = await render(null)
    expect(saveButton().disabled).toBe(true)

    await type('printerName', 'Theke')
    await type('printerIp', '192.168.1')
    expect(saveButton().disabled).toBe(true)

    await type('printerIp', '192.168.1.50')
    expect(saveButton().disabled).toBe(false)
  })

  it('schließt den Dialog bei ungültigem Formular auch per Submit nicht', async () => {
    const { submit, close } = await render(null)
    await submit()
    expect(close).not.toHaveBeenCalled()
  })

  it('verlangt beim MQTT-Drucker keine IP', async () => {
    const { type, saveButton } = await render(null)
    await type('printerName', 'Küche')
    await type('printerType', 'mqtt')
    expect(saveButton().disabled).toBe(false)
  })

  it('gibt die getippten Werte zurück und lässt einen geleerten Port weg', async () => {
    const { type, submit, close } = await render(bestand())
    await type('printerName', 'Küche hinten')
    await type('printerPort', '')
    await submit()

    const result = close.mock.calls[0][0] as PrinterFormData
    expect(result.name).toBe('Küche hinten')
    expect(result.ip).toBe('192.168.1.50')
    expect('port' in result).toBe(false)
    // Ein Netzwerkdrucker ohne MQTT-Topic bekommt keinen leeren String dazu.
    expect('mqttTopic' in result).toBe(false)
  })
})
