import { inject, Injectable, signal } from '@angular/core'
import { UserPreferencesService } from '@panary-core/user-preferences/data-access'

const THEME_STORAGE_KEY = 'app_preference.theme'

@Injectable({
  providedIn: 'root',
})
export class ThemeServiceService {
  #userPreferenceService: UserPreferencesService = inject(UserPreferencesService)
  #systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)')

  private currentTheme = signal<string>('system')

  constructor() {
    // Synchron aus localStorage lesen und sofort anwenden — kein Flash of Wrong Theme
    const cached = this.#readCachedTheme()
    this.currentTheme.set(cached)
    this.applyTheme(cached)

    // OS-Präferenz-Wechsel beobachten — nur im System-Modus relevant
    this.#systemDarkQuery.addEventListener('change', e => {
      if (this.currentTheme() === 'system') {
        this.#applySystemDarkClass(e.matches)
      }
    })
  }

  get theme(): string {
    return this.currentTheme()
  }

  async setTheme(theme: string): Promise<void> {
    const savedTheme = await this.#userPreferenceService.setPreference<string>('theme', theme)
    this.currentTheme.set(savedTheme)
    this.applyTheme(savedTheme)
  }

  private applyTheme(theme: string): void {
    const root = document.documentElement

    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark')
      document.body.classList.add('dark')
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light')
      document.body.classList.remove('dark')
    } else {
      // System-Modus: data-theme entfernen → CSS-Mediaquery übernimmt für Angular Material.
      // .dark-Klasse anhand OS-Präferenz setzen → Tailwind dark:-Utilities greifen.
      root.removeAttribute('data-theme')
      this.#applySystemDarkClass(this.#systemDarkQuery.matches)
    }
  }

  /** Liest den Theme-Wert synchron aus localStorage — kein async, kein Microtask-Delay */
  #readCachedTheme(): string {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      return stored ? JSON.parse(stored) : 'system'
    } catch {
      return 'system'
    }
  }

  #applySystemDarkClass(prefersDark: boolean): void {
    if (prefersDark) {
      document.body.classList.add('dark')
    } else {
      document.body.classList.remove('dark')
    }
  }
}
