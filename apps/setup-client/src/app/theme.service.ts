import { Injectable, computed, effect, signal } from '@angular/core'

type ThemeMode = 'dark' | 'light' | 'system'

const THEME_STORAGE_KEY = 'panary-setup-theme'

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemeMode>(
    (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null) ?? 'dark',
  )

  readonly themeIcon = computed<string>(() => {
    switch (this.theme()) {
      case 'light':
        return '☀'
      case 'dark':
        return '☽'
      default:
        return '◐'
    }
  })

  readonly themeLabel = computed<string>(() => {
    switch (this.theme()) {
      case 'light':
        return 'Light'
      case 'dark':
        return 'Dark'
      default:
        return 'System'
    }
  })

  constructor() {
    effect(() => this.#applyTheme(this.theme()))
  }

  cycleTheme(): void {
    const modes: ThemeMode[] = ['dark', 'light', 'system']
    const next = modes[(modes.indexOf(this.theme()) + 1) % modes.length]
    this.theme.set(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }

  #applyTheme(mode: ThemeMode): void {
    const root = document.documentElement
    if (mode === 'dark') {
      root.setAttribute('data-theme', 'dark')
    } else if (mode === 'light') {
      root.setAttribute('data-theme', 'light')
    } else {
      // System-Modus: kein Attribut → CSS-Mediaquery greift
      root.removeAttribute('data-theme')
    }
  }
}
