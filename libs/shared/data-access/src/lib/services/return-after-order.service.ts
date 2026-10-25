import { Injectable, signal } from '@angular/core'

const STORAGE_KEY = 'pos_return_after_order'

const readStored = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * Geräteeinstellung „Nach dem Bestellen zur Ausgangsseite zurück" (core#974, Standard an).
 * Gerätelokal wie die Kartengröße auf „Offen": Sie gehört zum Terminal, nicht zum Bediener.
 */
@Injectable({ providedIn: 'root' })
export class ReturnAfterOrderService {
  readonly #enabled = signal(readStored())
  readonly enabled = this.#enabled.asReadonly()

  set(value: boolean): void {
    this.#enabled.set(value)
    try {
      localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // Speicher gesperrt: Die Einstellung gilt dann nur bis zum Neuladen
    }
  }
}
