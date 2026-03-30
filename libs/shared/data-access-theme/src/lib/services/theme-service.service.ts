import { inject, Injectable, signal } from '@angular/core'
import { UserPreferencesService } from '@panary-core/user-preferences/data-access'

@Injectable({
  providedIn: 'root',
})
export class ThemeServiceService {
  #userPreferenceService: UserPreferencesService = inject(UserPreferencesService)

  private currentTheme = signal<string>('system')

  constructor() {
    this.loadThemePreference().then()
  }

  async loadThemePreference(): Promise<void> {
    const theme = await this.#userPreferenceService.getPreference<string>('theme', 'system')
    this.currentTheme.set(theme)
    this.applyTheme(theme)
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
      // System-Modus: data-theme entfernen → CSS-Mediaquery übernimmt automatisch
      root.removeAttribute('data-theme')
      document.body.classList.remove('dark')
    }
  }
}
