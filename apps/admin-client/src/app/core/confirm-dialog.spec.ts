// core#1319: Der Dirty-Dialog („Ungespeicherte Änderungen“) stand fest auf Deutsch — als Default im
// Dialog selbst und als Literal in der Produktliste. Geprüft wird gegen die echten Sprachdateien,
// damit ein fehlender Schlüssel in en/tr genauso rot wird wie ein deutsches Literal.
import { TestBed } from '@angular/core/testing'
import { TranslateModule, TranslateService, type TranslationObject } from '@ngx-translate/core'
import { describe, expect, it } from 'vitest'

import de from '../../assets/i18n/de.json'
import en from '../../assets/i18n/en.json'
import tr from '../../assets/i18n/tr.json'
import { ConfirmDialogComponent } from './confirm-dialog'

const LANGS: Record<string, TranslationObject> = { de, en, tr }
const i18n = (lang: string) => LANGS[lang]

async function render(lang: string) {
  await TestBed.configureTestingModule({ imports: [ConfirmDialogComponent, TranslateModule.forRoot()] }).compileComponents()
  const translate = TestBed.inject(TranslateService)
  translate.setTranslation(lang, i18n(lang))
  translate.use(lang)
  const fixture = TestBed.createComponent(ConfirmDialogComponent)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement
  return [...el.querySelectorAll('p, button')].map(e => e.textContent?.trim()).join(' | ')
}

describe('ConfirmDialogComponent – Standardtexte', () => {
  it('zeigt den Dirty-Dialog ohne Eingaben auf Englisch', async () => {
    const text = await render('en')
    expect(text).toBe('Unsaved changes | Do you want to save your changes? | Save | Discard')
  })

  it('zeigt den Dirty-Dialog ohne Eingaben auf Türkisch', async () => {
    const text = await render('tr')
    expect(text).toBe('Kaydedilmemiş değişiklikler | Değişiklikleri kaydetmek istiyor musunuz? | Kaydet | Yoksay')
  })

  it('bleibt auf Deutsch unverändert', async () => {
    const text = await render('de')
    expect(text).toBe('Ungespeicherte Änderungen | Möchten Sie die Änderungen speichern? | Speichern | Verwerfen')
  })
})
