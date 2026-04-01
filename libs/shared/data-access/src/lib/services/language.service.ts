import { inject, Injectable, signal } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { UserPreferencesService } from '@panary-core/user-preferences/data-access'

export interface LanguageOption {
  code: string
  label: string
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
]

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  #translate = inject(TranslateService)
  #prefs = inject(UserPreferencesService)

  currentLanguage = signal<string>('de')
  languages = LANGUAGES

  constructor() {
    this.#translate.addLangs(LANGUAGES.map(l => l.code))
    this.#translate.setDefaultLang('de')
    this.loadLanguagePreference().then()
  }

  async loadLanguagePreference(): Promise<void> {
    const lang = await this.#prefs.getPreference<string>('language', 'de')
    this.currentLanguage.set(lang)
    this.#translate.use(lang)
  }

  async setLanguage(lang: string): Promise<void> {
    const saved = await this.#prefs.setPreference<string>('language', lang)
    this.currentLanguage.set(saved)
    this.#translate.use(saved)
  }
}
