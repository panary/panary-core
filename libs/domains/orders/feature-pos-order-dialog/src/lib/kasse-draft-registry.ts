import { computed, Injectable, signal, type Signal } from '@angular/core'

/**
 * Meldet, ob in der Kasse gerade eine Bestellung angefangen ist.
 *
 * Der Inaktivitäts-Logout setzt seine Frist aus, solange ein Entwurf offen ist — der lebt
 * komponenten-privat und wäre nach dem Logout verloren. Als MatDialog genügte „Dialog offen"
 * als Signal; als Route ist die Kasse aber dauernd offen, und der Logout käme nie (core#828).
 * Gefragt wird deshalb die Kasse selbst, je Takt, statt eines gebuchten Zustands: Ein
 * vergessenes Abmelden würde den Logout sonst dauerhaft und unsichtbar abschalten.
 */
@Injectable({ providedIn: 'root' })
export class KasseDraftRegistry {
  #probe: (() => boolean) | null = null
  readonly #sheet = signal<Signal<boolean> | null>(null)

  /**
   * Liegt in der Kasse gerade ein Sheet (Extras, Bezahlen, Abschicken)? Dann sperrt die Rail
   * (Konzept §5, core#832). Anders als der Entwurf ein Signal: Die Rail zeigt die Sperre an.
   */
  readonly sheetOpen = computed(() => this.#sheet()?.() ?? false)

  /** Hängt die laufende Kasse an. Die Rückgabe löst genau diese Anmeldung wieder. */
  attach(probe: () => boolean): () => void {
    this.#probe = probe
    return () => {
      if (this.#probe === probe) this.#probe = null
    }
  }

  /** Wurde in der laufenden Kasse schon etwas eingegeben? Ohne Kasse: nein. */
  hasDraft(): boolean {
    return this.#probe?.() ?? false
  }

  /** Hängt den Sheet-Zustand der laufenden Kasse an. Die Rückgabe löst genau diese Anmeldung wieder. */
  attachSheet(sheet: Signal<boolean>): () => void {
    this.#sheet.set(sheet)
    return () => {
      if (this.#sheet() === sheet) this.#sheet.set(null)
    }
  }
}
