import { computed, Injectable, signal, type Signal } from '@angular/core'

/** Was die laufende Kasse der Shell über ihre angefangene Bestellung anbietet. */
export interface KasseDraft {
  /** Wurde schon etwas eingegeben? */
  readonly hasInput: () => boolean
  /** Rückfrage wie beim Seitenwechsel (core#828). `true`: darf verlassen werden, die Bestellung ist verworfen. */
  readonly confirmLeave: () => Promise<boolean>
  /** Verwirft ohne Rückfrage und protokolliert den Abbruch — nur für den Inaktivitäts-Logout. */
  readonly discard: () => void
}

/**
 * Meldet, ob in der Kasse gerade eine Bestellung angefangen ist, und lässt die Shell vor dem
 * Abmelden nachfragen (core#1064).
 *
 * Der Entwurf lebt komponenten-privat und wäre nach dem Logout verloren. Abmelden und „Gehen"
 * fragen deshalb wie der Seitenwechsel; der Logout-Weg nach `/login` lässt der Leave-Guard
 * bewusst ohne Rückfrage durch. Der Inaktivitäts-Logout fragt nicht, er verwirft (Entscheidung
 * Michael 2026-10-25): Bis core#1064 setzte er seine Frist bei offenem Entwurf aus, und eine
 * liegengelassene Kasse mit Artikeln blieb unbegrenzt angemeldet.
 * Gefragt wird die Kasse selbst statt eines gebuchten Zustands: Ein vergessenes Abmelden würde
 * sonst dauerhaft und unsichtbar einen Zustand vortäuschen.
 */
@Injectable({ providedIn: 'root' })
export class KasseDraftRegistry {
  #draft: KasseDraft | null = null
  #pendingConfirm: Promise<boolean> | null = null
  readonly #sheet = signal<Signal<boolean> | null>(null)

  /**
   * Liegt in der Kasse gerade ein Sheet (Extras, Bezahlen, Abschicken)? Dann sperrt die Rail
   * (Konzept §5, core#832). Anders als der Entwurf ein Signal: Die Rail zeigt die Sperre an.
   */
  readonly sheetOpen = computed(() => this.#sheet()?.() ?? false)

  /** Hängt die laufende Kasse an. Die Rückgabe löst genau diese Anmeldung wieder. */
  attach(draft: KasseDraft): () => void {
    this.#draft = draft
    return () => {
      if (this.#draft === draft) this.#draft = null
    }
  }

  /** Wurde in der laufenden Kasse schon etwas eingegeben? Ohne Kasse: nein. */
  hasDraft(): boolean {
    return this.#draft?.hasInput() ?? false
  }

  /**
   * Vor dem Abmelden: dieselbe Rückfrage wie beim Seitenwechsel. Ohne Kasse sofort `true`. Ein
   * zweiter Tipp während der offenen Rückfrage öffnet keine zweite.
   */
  confirmLeave(): Promise<boolean> {
    const draft = this.#draft
    if (!draft) return Promise.resolve(true)
    this.#pendingConfirm ??= draft.confirmLeave().finally(() => (this.#pendingConfirm = null))
    return this.#pendingConfirm
  }

  /** Inaktivitäts-Logout: eine angefangene Bestellung als abgebrochen protokollieren, ohne zu fragen. */
  discardDraft(): void {
    if (this.#draft?.hasInput()) this.#draft.discard()
  }

  /** Hängt den Sheet-Zustand der laufenden Kasse an. Die Rückgabe löst genau diese Anmeldung wieder. */
  attachSheet(sheet: Signal<boolean>): () => void {
    this.#sheet.set(sheet)
    return () => {
      if (this.#sheet() === sheet) this.#sheet.set(null)
    }
  }
}
