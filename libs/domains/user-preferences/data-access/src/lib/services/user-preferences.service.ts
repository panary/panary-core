import { Injectable } from '@angular/core'

@Injectable({
  providedIn: 'root',
})
export class UserPreferencesService {
  private readonly STORAGE_KEY_PREFIX = 'app_preference.'

  async getPreference<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const stored = localStorage.getItem(`${this.STORAGE_KEY_PREFIX}${key}`)
      return stored ? JSON.parse(stored) : defaultValue
    } catch {
      return defaultValue
    }
  }

  async setPreference<T>(key: string, value: T): Promise<T> {
    try {
      localStorage.setItem(`${this.STORAGE_KEY_PREFIX}${key}`, JSON.stringify(value))
    } catch (error) {
      console.error(`Fehler beim Speichern der Einstellung "${key}":`, error)
    }
    return value
  }
}
