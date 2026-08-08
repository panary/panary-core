import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { LanguageService } from '@panary/shared/data-access'

/**
 * Sprachauswahl als Popup statt Toggle-Reihe.
 *
 * Die frühere Segmented-Pill rendert einen Button pro Sprache — mit jeder
 * weiteren Sprache wird sie schmaler und irgendwann unbenutzbar. Hier: eine
 * Schaltfläche in voller Breite mit dem Klarnamen der aktiven Sprache, Klick
 * öffnet eine Liste.
 *
 * **Bewusst ohne CDK-Overlay.** Es wäre der erste `@angular/cdk`-Import in
 * ganz panary-core, bräuchte `overlay-prebuilt.css` global (Konflikt mit
 * „Tailwind v4 zero-config", code-style.md §8) und legte ~40–60 kB in den
 * Initial-Chunk, weil das Layout eager ist. Für drei (perspektivisch ~10)
 * Einträge unverhältnismäßig; das Hausmuster steht in `searchable-select.ts`.
 *
 * Kein Clipping-Risiko: `overflow-y-auto` sitzt auf `<nav>`, dieser Picker im
 * Footer — einem Geschwister, nicht darin. `<aside>` hat keine
 * `overflow`-Regel (Beweis: der Toggle-Pill rendert bereits mit
 * `absolute left-full` außerhalb der Sidebar), und `<main>` hat kein
 * `z-index`. Ein `absolute bottom-full` im `relative`-Wrapper genügt also
 * ohne Positionsberechnung.
 */
@Component({
  selector: 'app-language-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="relative">
      @if (expanded()) {
        <button
          type="button"
          (click)="toggle()"
          [attr.aria-haspopup]="'listbox'"
          [attr.aria-expanded]="open()"
          class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg
                 bg-slate-100 dark:bg-gray-900 text-xs font-medium
                 text-slate-700 dark:text-gray-300
                 hover:text-slate-900 dark:hover:text-white transition"
        >
          <span class="truncate">{{ current().label }}</span>
          <span class="material-symbols-outlined shrink-0" style="font-size: 16px; line-height: 1">unfold_more</span>
        </button>
      } @else {
        <button
          type="button"
          (click)="toggle()"
          [title]="('COMMON.LANGUAGE' | translate) + ': ' + current().label"
          [attr.aria-haspopup]="'listbox'"
          [attr.aria-expanded]="open()"
          class="text-xs font-medium leading-none text-slate-500 dark:text-gray-400
                 hover:text-slate-900 dark:hover:text-white transition"
        >
          {{ current().code.toUpperCase() }}
        </button>
      }

      @if (open()) {
        <!--
          Backdrop als <button>, nicht als <div (click)>: erfuellt die
          a11y-Lint-Regeln ohne die eslint-disable-Zeilen, die
          searchable-select.ts dafuer braucht.
        -->
        <button
          type="button"
          (click)="close()"
          [attr.aria-label]="'COMMON.CLOSE' | translate"
          class="fixed inset-0 z-40 cursor-default"
        ></button>

        <!-- Oeffnet nach oben: der Picker sitzt am unteren Sidebar-Rand. -->
        <div
          role="listbox"
          [attr.aria-label]="'COMMON.LANGUAGE' | translate"
          class="absolute bottom-full left-0 mb-2 z-50 w-48 max-h-72 overflow-y-auto
                 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800
                 rounded-xl shadow-2xl py-1"
        >
          @for (l of lang.languages; track l.code) {
            <button
              type="button"
              role="option"
              [attr.aria-selected]="l.code === lang.currentLanguage()"
              (click)="select(l.code)"
              class="w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                     text-slate-700 dark:text-gray-300
                     hover:bg-slate-50 dark:hover:bg-gray-900 transition"
            >
              <span class="flex-1 truncate">{{ l.label }}</span>
              <span class="text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500">{{ l.code }}</span>
              @if (l.code === lang.currentLanguage()) {
                <span
                  class="material-symbols-outlined text-slate-900 dark:text-white"
                  style="font-size: 16px; line-height: 1"
                  >check</span
                >
              }
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class LanguagePickerComponent {
  /** true = ausgeklappte Sidebar (Button in voller Breite), false = w-16-Icon-Modus. */
  expanded = input(true)

  protected lang = inject(LanguageService)
  protected open = signal(false)

  protected current = computed(
    () => this.lang.languages.find(l => l.code === this.lang.currentLanguage()) ?? this.lang.languages[0],
  )

  protected toggle(): void {
    this.open.update(v => !v)
  }

  protected close(): void {
    this.open.set(false)
  }

  protected async select(code: string): Promise<void> {
    this.close()
    await this.lang.setLanguage(code)
  }
}
