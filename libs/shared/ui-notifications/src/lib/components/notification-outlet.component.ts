import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core'

import { NotificationService } from '../services/notification.service'
import type { NotificationType } from '../models/notification.types'

/**
 * Globaler Toast-Outlet. Rendert die Notifications aus dem signal-basierten
 * `NotificationService` (gespeist u.a. von `handleError`). Ohne diese Komponente
 * aktualisiert `show()` zwar das Signal, aber nichts wird angezeigt — genau der
 * Grund, warum Service-Fehler bisher still in der Konsole verschwanden.
 *
 * Auto-Dismiss läuft über `service.remove(id)` (Signal-Write) → rendert auch im
 * zoneless-Betrieb korrekt neu. Pro Toast wird genau EIN Timer geplant
 * (`#scheduled`-Set verhindert Doppel-Timer bei jedem Re-Render).
 *
 * Touch-First (Sunmi D3): Schließen-Button ≥48px.
 */
@Component({
  selector: 'lib-notification-outlet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed top-4 right-4 z-[2000] flex flex-col gap-2 max-w-[92vw] w-[380px] pointer-events-none">
      @for (n of notifications(); track n.id) {
        <div
          class="pointer-events-auto flex items-start gap-3 rounded-xl border-l-4 bg-white dark:bg-gray-900 shadow-lg px-4 py-3"
          [class]="borderClass(n.type)"
          role="alert"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold" [class]="titleClass(n.type)">{{ n.title }}</p>
            <p class="text-sm text-gray-700 dark:text-gray-200 break-words">{{ n.message }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 w-12 h-12 -mr-2 -mt-1 flex items-center justify-center text-2xl leading-none text-gray-400 hover:text-gray-700 dark:hover:text-gray-100"
            [attr.aria-label]="'Schließen'"
            (click)="dismiss(n.id)"
          >
            ×
          </button>
        </div>
      }
    </div>
  `,
})
export class NotificationOutletComponent {
  #service = inject(NotificationService)
  protected readonly notifications = this.#service.notifications

  // IDs mit bereits geplantem Auto-Dismiss-Timer (kein Doppel-Timer pro Re-Render).
  #scheduled = new Set<number>()

  constructor() {
    effect(() => {
      const list = this.notifications()
      // angular.md §2.1: Signal-Schreibzugriffe (remove) entkoppeln.
      untracked(() => {
        for (const n of list) {
          if (n.duration && n.duration > 0 && !this.#scheduled.has(n.id)) {
            this.#scheduled.add(n.id)
            setTimeout(() => {
              this.#service.remove(n.id)
              this.#scheduled.delete(n.id)
            }, n.duration)
          }
        }
        // Aufräumen: bereits manuell entfernte IDs aus dem Set werfen.
        const present = new Set(list.map(n => n.id))
        for (const id of this.#scheduled) {
          if (!present.has(id)) this.#scheduled.delete(id)
        }
      })
    })
  }

  protected dismiss(id: number): void {
    this.#service.remove(id)
  }

  protected borderClass(type: NotificationType): string {
    switch (type) {
      case 'error':
        return 'border-red-500'
      case 'success':
        return 'border-green-500'
      case 'warning':
        return 'border-amber-500'
      default:
        return 'border-blue-500'
    }
  }

  protected titleClass(type: NotificationType): string {
    switch (type) {
      case 'error':
        return 'text-red-700 dark:text-red-300'
      case 'success':
        return 'text-green-700 dark:text-green-300'
      case 'warning':
        return 'text-amber-700 dark:text-amber-300'
      default:
        return 'text-blue-700 dark:text-blue-300'
    }
  }
}
