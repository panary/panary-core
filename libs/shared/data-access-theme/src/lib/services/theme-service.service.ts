import { inject, Injectable, signal } from '@angular/core'
import { UserPreferencesService } from '@panary-core/user-preferences/data-access'

@Injectable({
  providedIn: 'root',
})
export class ThemeServiceService {
  /** INJECTION */
  #userPreferenceService: UserPreferencesService = inject(UserPreferencesService)

  /** PRIVATE PROPERTIES */
  private currentTheme = signal<string>('light')
  private mediaQueryListener: (e: MediaQueryListEvent) => void

  /** CONSTRUCTOR */
  constructor() {
    this.mediaQueryListener = (_e: MediaQueryListEvent) => {
      if (this.currentTheme() === 'system') {
        this.applyTheme('system')
      }
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', this.mediaQueryListener)
    } else {
      // Fallback for older browsers if needed, though mostly not required for this stack
      mediaQuery.addListener(this.mediaQueryListener)
    }

    this.loadThemePreference().then()
  }

  async loadThemePreference(): Promise<void> {
    const theme = await this.#userPreferenceService.getPreference<string>(
      'theme',
      'system', // Changed default to system
    )
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
    let effectiveTheme = theme

    if (theme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = systemDark ? 'dark' : 'light'
    }

    document.body.classList.remove('theme-light', 'theme-dark', 'dark')
    document.body.classList.add(`theme-${effectiveTheme}`)

    if (effectiveTheme === 'dark') {
      document.body.classList.add('dark')
    }
  }
}
