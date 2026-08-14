import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { MatDialogRef } from '@angular/material/dialog'
import {
  DiscountCodeService,
  codeResultMessage,
  isTechnicalCodeFailure,
  type CodeCheckResult,
} from '@panary/discounts/data-access'

import { TouchKeyboardComponent } from './touch-keyboard.component'

/**
 * Touch-Eingabe für Rabattcodes an der Kasse.
 *
 * Zwei Schritte, bewusst getrennt: Hier wird nur **geprüft** (`check`), die
 * Einlösung passiert beim Bestellabschluss. Sonst verbrauchte ein Abbruch nach
 * der Eingabe den Code — bei `usageLimit: 1` unwiederbringlich.
 *
 * Der Dialog schließt mit dem Prüfergebnis; der Order-Dialog hält es bis zum
 * Abschluss und löst dann ein.
 */
@Component({
  selector: 'app-promo-code-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TouchKeyboardComponent],
  template: `
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-code-title"
      class="flex flex-col w-full bg-white dark:bg-gray-950 rounded-2xl shadow-xl overflow-hidden"
    >
      <!-- HEADER -->
      <div class="h-20 shrink-0 px-6 py-5 flex justify-between items-start">
        <div>
          <h2 id="promo-code-title" class="text-lg font-bold text-gray-900 dark:text-white">Rabattcode</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Code eingeben und prüfen</p>
        </div>
        <button
          (click)="close()"
          type="button"
          aria-label="Schließen"
          class="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 dark:text-gray-500
                 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95 transition-all"
        >
          <span class="material-symbols-outlined text-[1.25rem]">close</span>
        </button>
      </div>

      <!-- CONTENT -->
      <div class="px-6 pb-4 flex flex-col gap-4">
        <!-- Eingabefeld -->
        <div
          class="h-16 rounded-xl border-2 px-4 flex items-center gap-1
                 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
        >
          <span class="text-2xl font-black tracking-widest text-gray-900 dark:text-white uppercase">
            {{ code() || 'CODE' }}
          </span>
          <div class="w-0.5 h-7 bg-gray-800 dark:bg-white animate-pulse ml-0.5"></div>
        </div>

        <!-- Rückmeldung -->
        @if (result(); as r) {
          <div
            class="rounded-xl px-4 py-3 flex items-start gap-3"
            [class]="feedbackClasses()"
            role="status"
            aria-live="polite"
          >
            <span class="material-symbols-outlined text-[1.25rem] shrink-0">{{ feedbackIcon() }}</span>
            <div class="min-w-0">
              <p class="text-sm font-semibold">{{ feedbackTitle() }}</p>
              @if (r.ok && r.discount) {
                <p class="text-xs mt-0.5 truncate">{{ r.discount.name }} · {{ valueLabel(r.discount) }}</p>
              } @else if (isTechnical()) {
                <p class="text-xs mt-0.5">Bestellung ohne Code abschließen oder es gleich erneut versuchen.</p>
              }
            </div>
          </div>
        } @else if (checking()) {
          <div class="rounded-xl px-4 py-3 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
            <p class="text-sm">Code wird geprüft…</p>
          </div>
        }

        <!-- Tastatur -->
        <app-touch-keyboard
          layout="qwertz"
          (keyPress)="onKey($event)"
          (backspace)="onBackspace()"
          (confirm)="check()"
        />
      </div>

      <!-- FOOTER -->
      <div
        class="h-[4.5rem] shrink-0 border-t border-gray-200 dark:border-gray-700 px-6 flex items-center justify-between gap-3"
      >
        <button
          type="button"
          (click)="close()"
          class="pnry-touch h-12 px-5 rounded-xl border-2 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40
                 text-sm font-semibold text-red-700 dark:text-red-300 active:scale-[0.98] transition-all"
        >
          Abbrechen
        </button>

        @if (canApply()) {
          <button
            type="button"
            (click)="apply()"
            class="pnry-touch h-12 px-6 rounded-xl border-2 border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40
                   text-sm font-bold text-teal-800 dark:text-teal-200 active:scale-[0.98] transition-all"
          >
            Rabatt übernehmen
          </button>
        } @else {
          <button
            type="button"
            (click)="check()"
            [disabled]="code().length === 0 || checking()"
            class="pnry-touch h-12 px-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900
                   text-sm font-bold text-gray-800 dark:text-gray-100 active:scale-[0.98] transition-all
                   disabled:opacity-40 disabled:active:scale-100"
          >
            Prüfen
          </button>
        }
      </div>
    </div>
  `,
})
export class PromoCodeDialogComponent {
  readonly #dialogRef = inject(MatDialogRef<PromoCodeDialogComponent, CodeCheckResult | undefined>)
  readonly #codeService = inject(DiscountCodeService)

  readonly code = signal('')
  readonly checking = signal(false)
  readonly result = signal<CodeCheckResult | null>(null)

  readonly canApply = computed(() => this.result()?.ok === true)
  readonly isTechnical = computed(() => {
    const r = this.result()
    return !!r && !r.ok && isTechnicalCodeFailure(r.reason)
  })

  readonly feedbackTitle = computed(() => {
    const r = this.result()
    return r ? codeResultMessage(r.reason) : ''
  })

  readonly feedbackIcon = computed(() => {
    const r = this.result()
    if (!r) return 'info'
    if (r.ok) return 'check_circle'
    return this.isTechnical() ? 'cloud_off' : 'cancel'
  })

  // Technische Ablehnung sieht bewusst anders aus als fachliche: „Cloud weg" ist
  // kein ungültiger Code, und der Kassierer soll den Unterschied ohne Lesen sehen.
  readonly feedbackClasses = computed(() => {
    const r = this.result()
    if (!r) return ''
    if (r.ok) return 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200'
    return this.isTechnical()
      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
      : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200'
  })

  onKey(key: string): void {
    if (this.code().length >= 64) return
    this.code.update(c => (c + key).toUpperCase())
    // Jede Änderung verwirft das alte Urteil — sonst stünde „gültig" über einem
    // inzwischen anderen Code.
    this.result.set(null)
  }

  onBackspace(): void {
    this.code.update(c => c.slice(0, -1))
    this.result.set(null)
  }

  async check(): Promise<void> {
    const code = this.code().trim()
    if (!code || this.checking()) return
    this.checking.set(true)
    try {
      this.result.set(await this.#codeService.check(code))
    } finally {
      this.checking.set(false)
    }
  }

  apply(): void {
    const r = this.result()
    if (!r?.ok) return
    this.#dialogRef.close({ ...r, code: this.code().trim() })
  }

  close(): void {
    this.#dialogRef.close(undefined)
  }

  valueLabel(d: { valueType: string; valuePercent: number; valueCents: number }): string {
    return d.valueType === 'percent' || d.valueType === 'PERCENT'
      ? `${d.valuePercent} %`
      : `${(d.valueCents / 100).toFixed(2).replace('.', ',')} €`
  }
}
