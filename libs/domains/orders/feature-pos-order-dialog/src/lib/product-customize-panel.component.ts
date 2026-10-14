import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import { CurrencyPipe } from '@angular/common'

import type { CustomizeGroup, CustomizeModel, CustomizeScope } from './product-customize'

export interface CustomizeOptionEvent {
  groupName: string
  productId: string
}

/**
 * Anpassen-Panel (#639) in der rechten Spalte des Bestelldialogs.
 *
 * Reine Anzeige: Jede Bedienung geht als Output an den Dialog, der die Zeile ändert
 * und ein neues Modell hereinreicht. Das Panel hält keinen eigenen Zustand — so bleibt
 * es mit dem Warenkorb deckungsgleich, auch wenn die Zeile von außen geändert wird.
 */
@Component({
  selector: 'lib-product-customize-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
  template: `
    @let m = model();
    <section class="flex h-full min-h-0 flex-col" aria-label="Produkt anpassen">
      <!-- Kopf: was angepasst wird und was bisher geändert ist -->
      <header class="shrink-0 px-4 pb-3">
        <div class="flex items-baseline gap-2">
          <span class="text-[0.625rem] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500"
            >Anpassen</span
          >
          @if (m.amount > 1 && scopeLocked()) {
            <span
              class="rounded bg-gray-100 px-1.5 py-0.5 text-[0.625rem] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              data-testid="customize-scope-applied"
              >gilt für {{ scope() === 'one' ? 1 : m.amount }}×</span
            >
          }
        </div>
        <!-- Umschalter (#699): Die Zeile hat mehrere Stück — gilt die Anpassung für eines (es wird
             abgespalten) oder für alle? Nach der ersten Änderung fest. -->
        @if (m.amount > 1 && !scopeLocked()) {
          <div
            class="mt-2 inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
            role="radiogroup"
            aria-label="Anpassung gilt für"
          >
            <button
              type="button"
              role="radio"
              data-testid="customize-scope-one"
              class="pnry-touch min-h-12 px-4 text-sm font-semibold transition-colors"
              [class]="
                scope() === 'one'
                  ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200'
                  : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              "
              [attr.aria-checked]="scope() === 'one'"
              (click)="scopeChanged.emit('one')"
            >
              1 Stück
            </button>
            <button
              type="button"
              role="radio"
              data-testid="customize-scope-all"
              class="pnry-touch min-h-12 border-l border-gray-200 px-4 text-sm font-semibold transition-colors dark:border-gray-700"
              [class]="
                scope() === 'all'
                  ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200'
                  : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              "
              [attr.aria-checked]="scope() === 'all'"
              (click)="scopeChanged.emit('all')"
            >
              alle {{ m.amount }}
            </button>
          </div>
        }
        <h2 class="mt-0.5 text-lg font-bold leading-tight text-gray-900 dark:text-white">{{ m.name }}</h2>
        <p class="mt-1 min-h-[1.25rem] text-sm text-gray-500 dark:text-gray-400" data-testid="customize-summary">
          {{ m.summary || 'Wie bestellt — nichts geändert' }}
        </p>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        @if (m.ingredients.length > 0) {
          <section class="mb-5" aria-labelledby="customize-ingredients">
            <div class="mb-2 flex items-baseline justify-between">
              <h3
                id="customize-ingredients"
                class="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200"
              >
                Zutaten
              </h3>
              <span class="text-[0.6875rem] text-gray-400">Antippen zum Abwählen</span>
            </div>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              @for (ingredient of m.ingredients; track ingredient.externalId) {
                <button
                  type="button"
                  class="pnry-touch flex min-h-14 items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition-all active:scale-95"
                  [class]="
                    ingredient.removed
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                      : 'border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
                  "
                  [attr.aria-pressed]="!ingredient.removed"
                  (click)="ingredientToggled.emit(ingredient.externalId)"
                >
                  <span class="material-symbols-outlined shrink-0 !text-[1.125rem]" aria-hidden="true">{{
                    ingredient.removed ? 'block' : 'check_circle'
                  }}</span>
                  <span class="flex min-w-0 flex-col leading-tight">
                    <span [class.line-through]="ingredient.removed" class="truncate">{{ ingredient.name }}</span>
                    @if (ingredient.removed) {
                      <span class="text-[0.6875rem] font-bold uppercase tracking-wide">
                        ohne
                        @if (ingredient.priceAdjustment !== 0) {
                          · {{ ingredient.priceAdjustment | currency: 'EUR' }}
                        }
                      </span>
                    }
                  </span>
                </button>
              }
            </div>
          </section>
        }

        @for (group of m.groups; track group.id) {
          <section class="mb-5" [attr.aria-labelledby]="'customize-group-' + group.id">
            <div class="mb-2 flex items-baseline justify-between gap-2">
              <h3
                [id]="'customize-group-' + group.id"
                class="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200"
              >
                {{ group.name }}
              </h3>
              <span
                class="rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold"
                [class]="
                  group.missing > 0
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'text-gray-400'
                "
                >{{ groupHint(group) }}</span
              >
            </div>
            <ul
              class="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800"
            >
              @for (option of group.options; track option.productId) {
                <li class="flex min-h-14 items-center gap-3 px-3">
                  <span class="flex min-w-0 flex-1 flex-col leading-tight">
                    <span
                      class="truncate text-sm font-semibold text-gray-800 dark:text-gray-100"
                      [class.text-teal-700]="option.amount > 0"
                      >{{ option.name }}</span
                    >
                    @if (!option.isModifier) {
                      <span class="flex items-center gap-1 text-[0.6875rem] text-amber-700 dark:text-amber-400">
                        <span class="material-symbols-outlined !text-[0.875rem]" aria-hidden="true">warning</span>
                        kein Extra — im Admin auf Modifier stellen
                      </span>
                    } @else if (option.price > 0) {
                      <span class="text-xs text-gray-500">+{{ option.price | currency: 'EUR' }}</span>
                    }
                  </span>
                  <button
                    type="button"
                    class="pnry-touch flex h-12 w-12 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-all active:scale-95 disabled:opacity-30 dark:border-gray-600 dark:text-gray-300"
                    [disabled]="option.amount === 0"
                    [attr.aria-label]="option.name + ' entfernen'"
                    (click)="optionDecreased.emit({ groupName: group.name, productId: option.productId })"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">remove</span>
                  </button>
                  <span
                    class="w-6 text-center text-base font-bold tabular-nums text-gray-900 dark:text-white"
                    [attr.aria-label]="'Menge ' + option.name"
                    >{{ option.amount }}</span
                  >
                  <button
                    type="button"
                    class="pnry-touch flex h-12 w-12 items-center justify-center rounded-xl border-2 border-teal-200 bg-teal-50 text-teal-700 transition-all active:scale-95 disabled:opacity-30 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
                    [disabled]="group.full || !option.isModifier"
                    [attr.aria-label]="option.name + ' hinzufügen'"
                    (click)="optionIncreased.emit({ groupName: group.name, productId: option.productId })"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">add</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      </div>

      <!-- Fußleiste: immer sichtbar, Abbrechen verwirft die Änderungen seit dem Öffnen -->
      <footer class="flex shrink-0 items-stretch gap-2 border-t border-gray-200 px-4 pt-3 dark:border-gray-700">
        <button
          type="button"
          class="pnry-touch flex h-14 items-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 text-xs font-bold uppercase tracking-wide text-red-700 active:scale-95 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          (click)="cancelled.emit()"
        >
          <span class="material-symbols-outlined !text-[1.25rem]" aria-hidden="true">close</span>
          Abbrechen
        </button>
        <button
          type="button"
          class="pnry-touch flex h-14 items-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-bold uppercase tracking-wide text-gray-600 active:scale-95 dark:border-gray-700 dark:text-gray-300"
          (click)="showAllModifiers.emit()"
        >
          <span class="material-symbols-outlined !text-[1.25rem]" aria-hidden="true">apps</span>
          Alle Modifier
        </button>
        <button
          type="button"
          class="pnry-touch ml-auto flex h-14 min-w-[10rem] items-center justify-center gap-2 rounded-xl border-2 border-teal-400 bg-teal-100 px-5 text-sm font-bold uppercase tracking-wide text-teal-800 active:scale-95 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 dark:border-teal-700 dark:bg-teal-900/50 dark:text-teal-200 dark:disabled:border-gray-700 dark:disabled:bg-gray-800"
          [disabled]="!m.canFinish"
          (click)="finished.emit()"
        >
          <span class="material-symbols-outlined !text-[1.25rem]" aria-hidden="true">check</span>
          {{ finishLabel(m) }}
        </button>
      </footer>
    </section>
  `,
})
export class ProductCustomizePanelComponent {
  readonly model = input.required<CustomizeModel>()
  /** Gilt die Anpassung für ein Stück oder alle der Zeile (#699)? */
  readonly scope = input<CustomizeScope>('all')
  /** Nach der ersten Änderung fest — der Kopf zeigt dann nur noch, wofür sie gilt. */
  readonly scopeLocked = input(false)

  readonly ingredientToggled = output<string>()
  readonly optionIncreased = output<CustomizeOptionEvent>()
  readonly optionDecreased = output<CustomizeOptionEvent>()
  readonly finished = output<void>()
  readonly cancelled = output<void>()
  readonly showAllModifiers = output<void>()
  readonly scopeChanged = output<CustomizeScope>()

  groupHint(group: CustomizeGroup): string {
    if (group.missing > 0) return `Pflicht · noch ${group.missing}`
    if (group.maxSelections !== null) return `${group.selected} / ${group.maxSelections}`
    return 'optional'
  }

  finishLabel(model: CustomizeModel): string {
    const missing = model.groups.reduce((sum, group) => sum + group.missing, 0)
    return missing > 0 ? `Noch ${missing} wählen` : 'Fertig'
  }
}
