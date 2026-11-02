import { Injectable } from '@angular/core'
import type { KasseReorder } from '@panary/orders/domain'

/**
 * Übergabe „Nachbestellen" → Kasse (core#1140): Die Liste „Offen" legt Tisch und Kreis ab, die Kasse nimmt sie
 * beim Aufbau genau einmal.
 *
 * Bewusst kein Navigations-State: Den legt der Router in `history.state` und stellt ihn bei Neuladen und
 * Browser-Zurück wieder her. Eine Kasse, die nach einem Neuladen wieder an Tisch 4 bucht, wäre eine stille
 * Fehlbuchung. Ein Wert im Speicher ist nach dem Neuladen fort, und `take()` leert ihn.
 */
@Injectable({ providedIn: 'root' })
export class KasseReorderHandoff {
  #pending: KasseReorder | null = null

  offer(reorder: KasseReorder): void {
    this.#pending = reorder
  }

  /** Die abgelegte Vorbelegung, danach ist sie weg. */
  take(): KasseReorder | null {
    const pending = this.#pending
    this.#pending = null
    return pending
  }
}
