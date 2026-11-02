// core#1173: Druck- und MQTT-Einstellungen binden einen Feldbaum, den die Druckerverwaltung besitzt.
// Geprüft wird das Schema der Verwaltung (Grenzen wie `printSettings` im Domain-Schema, Speichern
// gesperrt) und über das gerenderte Template der Kinder, dass die Eingabe im Modell der Verwaltung landet.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { form, required } from '@angular/forms/signals'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { EmergencyOverrideService } from '../../core/emergency-override.service'
import { MqttSettingsFormComponent, type MqttSettingsData } from './mqtt-settings-form'
import { PrintSettingsFormComponent, type PrintSettingsData } from './print-settings-form'
import { PrinterManagementComponent } from './printer-management'
import { PrinterService } from './printer.service'

function management() {
  const api = { patch: vi.fn().mockResolvedValue({}), find: vi.fn() }
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: PrinterService, useValue: { getStatus: vi.fn(), restart: vi.fn() } },
      {
        provide: CloudManagedService,
        useValue: {
          printerWritable: signal(true),
          printerEmergency: signal(false),
          emergencyOverrideSinceMin: signal(null),
          canOfferEmergency: signal(false),
          refresh: vi.fn(),
        },
      },
      { provide: EmergencyOverrideService, useValue: { setActive: vi.fn() } },
    ],
  })
  const component = TestBed.runInInjectionContext(() => new PrinterManagementComponent())
  return { component, api }
}

describe('PrinterManagementComponent — Schema der Einstellungen', () => {
  it('ist mit den Vorgabewerten gültig', () => {
    const { component } = management()
    expect(component.printSettingsForm().invalid()).toBe(false)
    expect(component.mqttSettingsForm().invalid()).toBe(false)
  })

  it('sperrt einen MQTT-Port außerhalb 1–65535 und speichert nicht', async () => {
    const { component, api } = management()
    component.mqttSettingsForm.mqttServerPort().value.set(70000)

    await component.onSave()

    expect(component.mqttSettingsForm().invalid()).toBe(true)
    expect(api.patch).not.toHaveBeenCalled()
    // Ohne Guard liefe `persistSettings` los und meldete „Settings nicht geladen".
    expect(component.error()).toBe('')
  })

  it('sperrt eine leere Server-URL', () => {
    const { component } = management()
    component.mqttSettingsForm.mqttServerUrl().value.set('')
    expect(component.mqttSettingsForm().invalid()).toBe(true)
  })

  it('sperrt mehr als 200 Zeichen Artikelname wie das Domain-Schema', () => {
    const { component } = management()
    component.printSettingsForm.maxNameCharacters().value.set(201)
    expect(component.printSettingsForm().invalid()).toBe(true)
  })
})

describe('Einstellungs-Kinder — Bindung im Template', () => {
  it('MQTT: getippte URL und Port landen im Modell der Verwaltung', async () => {
    const model = signal<MqttSettingsData>({
      mqttServerProtocol: 'ws',
      mqttServerUrl: 'localhost',
      mqttServerPort: 9001,
    })
    await TestBed.configureTestingModule({ imports: [MqttSettingsFormComponent] }).compileComponents()
    const settingsForm = TestBed.runInInjectionContext(() => form(model, s => required(s.mqttServerUrl)))
    const fixture = TestBed.createComponent(MqttSettingsFormComponent)
    fixture.componentRef.setInput('settingsForm', settingsForm)
    await fixture.whenStable()
    const el = fixture.nativeElement as HTMLElement

    const url = el.querySelector<HTMLInputElement>('#mqttServerUrl')!
    const port = el.querySelector<HTMLInputElement>('#mqttPort')!
    expect(url.value).toBe('localhost')
    url.value = 'broker.lan'
    url.dispatchEvent(new Event('input'))
    port.value = '1884'
    port.dispatchEvent(new Event('input'))
    await fixture.whenStable()

    expect(model()).toEqual({ mqttServerProtocol: 'ws', mqttServerUrl: 'broker.lan', mqttServerPort: 1884 })
  })

  it('MQTT: der Verbindungstest meldet ein ungültiges Formular, statt zu verbinden', async () => {
    const model = signal<MqttSettingsData>({ mqttServerProtocol: 'ws', mqttServerUrl: '', mqttServerPort: 9001 })
    await TestBed.configureTestingModule({ imports: [MqttSettingsFormComponent] }).compileComponents()
    const settingsForm = TestBed.runInInjectionContext(() => form(model, s => required(s.mqttServerUrl)))
    const fixture = TestBed.createComponent(MqttSettingsFormComponent)
    fixture.componentRef.setInput('settingsForm', settingsForm)
    await fixture.whenStable()

    fixture.componentInstance.testConnection()

    expect(fixture.componentInstance.testResult()).toBe('error')
    expect(fixture.componentInstance.testing()).toBe(false)
  })

  it('Druck: Checkbox und Zahlenfeld schreiben ins Modell der Verwaltung', async () => {
    const model = signal<PrintSettingsData>({
      printServerEnabled: true,
      maxNameCharacters: 42,
      separationCharacter: '_',
      separationCharacterCount: 47,
      showDialogAfterOrder: true,
    })
    await TestBed.configureTestingModule({ imports: [PrintSettingsFormComponent] }).compileComponents()
    const settingsForm = TestBed.runInInjectionContext(() => form(model))
    const fixture = TestBed.createComponent(PrintSettingsFormComponent)
    fixture.componentRef.setInput('settingsForm', settingsForm)
    await fixture.whenStable()
    const el = fixture.nativeElement as HTMLElement

    const maxName = el.querySelector<HTMLInputElement>('#maxNameCharacters')!
    expect(maxName.value).toBe('42')
    maxName.value = '30'
    maxName.dispatchEvent(new Event('input'))
    const [autostart] = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    autostart.click()
    await fixture.whenStable()

    expect(model().maxNameCharacters).toBe(30)
    expect(model().printServerEnabled).toBe(false)
  })
})
