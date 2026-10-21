import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import { EurPipe } from '@panary/shared/ui-common'

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
  imports: [EurPipe],
  template: `
    @let m = model();
    <section class="@container flex h-full min-h-0 flex-col" aria-label="Produkt anpassen">
      <!-- Kopf: was angepasst wird und was bisher geändert ist. Kompakt seit #795 — Umschalter neben
           dem Titel statt in eigener Zeile, Zusammenfassung einzeilig; auf niedrigen Kassen fraß der
           Kopf sonst ein Drittel der Spalte. -->
      <header class="flex shrink-0 items-start gap-4 px-4 pb-3">
        <div class="min-w-0">
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
          <h2 class="truncate text-lg font-bold leading-tight text-gray-900 dark:text-white">{{ m.name }}</h2>
          <p
            class="truncate text-sm text-gray-500 dark:text-gray-400"
            data-testid="customize-summary"
            [attr.title]="m.summary || null"
          >
            {{ m.summary || 'Wie bestellt — nichts geändert' }}
          </p>
        </div>
        <!-- Umschalter (#699): Die Zeile hat mehrere Stück — gilt die Anpassung für eines (es wird
             abgespalten) oder für alle? Nach der ersten Änderung fest. -->
        @if (m.amount > 1 && !scopeLocked()) {
          <div
            class="inline-flex shrink-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
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
      </header>

      <div class="flex min-h-0 flex-1 flex-col px-4 pb-4">
        @if (m.ingredients.length > 0) {
          <section class="mb-5 max-h-[40%] shrink-0 overflow-y-auto" aria-labelledby="customize-ingredients">
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
                          · {{ ingredient.priceAdjustment | eur }}
                        }
                      </span>
                    }
                  </span>
                </button>
              }
            </div>
          </section>
        }

        <!-- Extras wie die Listenansicht im Explorer (#795): erst untereinander, ist die Spalte voll,
             geht es rechts daneben weiter. column-fill:auto füllt jede Spalte bis zur Höhe statt zu
             balancieren; reicht die Breite nicht, scrollt der Bereich waagrecht. -->
        <div class="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div class="h-full columns-[16rem] gap-4 [column-fill:auto]">
            @for (group of m.groups; track group.id) {
              <section class="mb-5" [attr.aria-labelledby]="'customize-group-' + group.id">
                <div class="mb-2 flex items-baseline justify-between gap-2 break-after-avoid">
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
                <!-- Karten statt einer Zeile über die ganze Spaltenbreite (#795): Auf breiten Kassen stand
                 −/+ sonst eine Handbreit vom Namen entfernt. -->
                <ul>
                  @for (option of group.options; track option.productId) {
                    <li
                      class="mb-2 flex min-h-14 break-inside-avoid items-center gap-2 rounded-xl border bg-white py-1 pl-3 pr-1 dark:bg-gray-800"
                      [class]="
                        option.amount > 0
                          ? 'border-teal-300 dark:border-teal-700'
                          : 'border-gray-200 dark:border-gray-700'
                      "
                    >
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
                          <span class="text-xs text-gray-500">+{{ option.price | eur }}</span>
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
        </div>
      </div>

      <!-- Fußleiste: immer sichtbar, Abbrechen verwirft die Änderungen seit dem Öffnen -->
      <!-- Fußleiste: unter 42rem Panelbreite werden die Nebentasten quadratisch wie die mittlere
           Funktionsleiste (#795) — mit „Herauslösen" brachen vier breite Tasten sonst um. „Fertig"
           bleibt breit und füllt den Rest. Container-Query, weil die Panelbreite zählt, nicht die
           des Fensters. -->
      <footer class="flex shrink-0 items-stretch gap-2 border-t border-gray-200 px-4 pt-3 dark:border-gray-700">
        <button
          type="button"
          class="pnry-touch flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center text-[0.5625rem] font-bold uppercase leading-tight active:scale-95 @2xl:w-auto @2xl:tracking-wide @2xl:flex-row @2xl:gap-2 @2xl:px-4 @2xl:text-xs border-2 border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          (click)="cancelled.emit()"
        >
          <span class="material-symbols-outlined !text-[1.25rem]" aria-hidden="true">close</span>
          Abbrechen
        </button>
        <button
          type="button"
          class="pnry-touch flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center text-[0.5625rem] font-bold uppercase leading-tight active:scale-95 @2xl:w-auto @2xl:tracking-wide @2xl:flex-row @2xl:gap-2 @2xl:px-4 @2xl:text-xs border border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
          (click)="showAllModifiers.emit()"
        >
          <span class="material-symbols-outlined !text-[1.25rem]" aria-hidden="true">apps</span>
          <span class="@2xl:hidden">Modifier</span>
          <span class="hidden @2xl:inline">Alle Modifier</span>
        </button>
        <!-- Nur an einer Position in einer Kombination (#795): löst so viele Stück, wie der
             Multiplikator zeigt — die Zahl steht deshalb auf der Taste. -->
        @if (releaseLabel(); as label) {
          <button
            type="button"
            data-testid="customize-release"
            class="pnry-touch flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center text-[0.5625rem] font-bold uppercase leading-tight active:scale-95 @2xl:w-auto @2xl:tracking-wide @2xl:flex-row @2xl:gap-2 @2xl:px-4 @2xl:text-xs border-2 border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            (click)="released.emit()"
          >
            <span class="material-symbols-outlined !text-[1.25rem]" aria-hidden="true">call_split</span>
            <!-- „1 herauslösen" passt nicht in 64 px — kompakt reicht „1 lösen" -->
            <span class="@2xl:hidden">{{ shortReleaseLabel(label) }}</span>
            <span class="hidden @2xl:inline">{{ label }}</span>
          </button>
        }
        <button
          type="button"
          class="pnry-touch ml-auto flex h-14 min-w-16 max-w-[14rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-teal-400 bg-teal-100 px-1 text-center text-[0.625rem] font-bold uppercase leading-tight text-teal-800 @2xl:tracking-wide active:scale-95 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 @2xl:min-w-[10rem] @2xl:max-w-none @2xl:flex-none @2xl:flex-row @2xl:gap-2 @2xl:px-5 @2xl:text-sm dark:border-teal-700 dark:bg-teal-900/50 dark:text-teal-200 dark:disabled:border-gray-700 dark:disabled:bg-gray-800"
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
  /** Beschriftung „n herauslösen" an einer Kombinations-Position, sonst `null` — dann keine Taste (#795). */
  readonly releaseLabel = input<string | null>(null)

  readonly ingredientToggled = output<string>()
  readonly optionIncreased = output<CustomizeOptionEvent>()
  readonly optionDecreased = output<CustomizeOptionEvent>()
  readonly finished = output<void>()
  readonly cancelled = output<void>()
  readonly showAllModifiers = output<void>()
  readonly scopeChanged = output<CustomizeScope>()
  readonly released = output<void>()

  groupHint(group: CustomizeGroup): string {
    if (group.missing > 0) return `Pflicht · noch ${group.missing}`
    if (group.maxSelections !== null) return `${group.selected} / ${group.maxSelections}`
    return 'optional'
  }

  shortReleaseLabel(label: string): string {
    return label.replace('herauslösen', 'lösen')
  }

  finishLabel(model: CustomizeModel): string {
    const missing = model.groups.reduce((sum, group) => sum + group.missing, 0)
    return missing > 0 ? `Noch ${missing} wählen` : 'Fertig'
  }
}
