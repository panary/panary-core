import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  model,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core'

export interface SelectItem {
  id: string
  label: string
  sublabel?: string
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
  template: `
    <!-- Trigger -->
    <button type="button" (click)="open()"
      class="w-full flex items-center justify-between gap-1 bg-white dark:bg-gray-900
             border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5
             text-sm outline-none hover:border-slate-400 dark:hover:border-gray-600
             focus:border-slate-900 dark:focus:border-white transition min-w-0">
      @if (selectedItem(); as item) {
        <span class="truncate text-slate-900 dark:text-white">
          {{ item.label }}
          @if (item.sublabel) {
            <span class="text-slate-400 dark:text-gray-500">({{ item.sublabel }})</span>
          }
        </span>
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <span (click)="clear($event)"
          class="text-slate-300 dark:text-gray-600 hover:text-red-400 shrink-0 text-xs cursor-pointer px-0.5">
          &#x2715;
        </span>
      } @else {
        <span class="truncate text-slate-300 dark:text-gray-600">{{ placeholder() }}</span>
        <svg class="w-3 h-3 shrink-0 text-slate-300 dark:text-gray-600" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      }
    </button>

    <!-- Overlay-Panel (fixiert, rechte Seite, volle Höhe) -->
    @if (isOpen()) {
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
      <div class="fixed inset-0 z-50 flex justify-end" (click)="close()">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/20 dark:bg-black/40"></div>

        <!-- Panel -->
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <div class="relative w-full max-w-sm my-4 mr-4 flex flex-col bg-white dark:bg-gray-950
                    border border-slate-200 dark:border-gray-800 rounded-xl shadow-2xl overflow-hidden"
             (click)="$event.stopPropagation()">

          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-gray-800">
            <span class="text-sm font-medium text-slate-900 dark:text-white">Produkt auswählen</span>
            <button type="button" (click)="close()"
              class="text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white transition text-sm">
              &#x2715;
            </button>
          </div>

          <!-- Suchfeld -->
          <div class="px-4 py-2 border-b border-slate-100 dark:border-gray-800/50">
            <input #searchInput
              [value]="searchText()"
              (input)="searchText.set(searchInput.value)"
              (keydown.arrowdown)="highlightNext()"
              (keydown.arrowup)="highlightPrev()"
              (keydown.enter)="selectHighlighted()"
              type="text"
              [placeholder]="placeholder()"
              class="w-full bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                     rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none
                     focus:border-slate-900 dark:focus:border-white transition" />
          </div>

          <!-- Liste -->
          <div class="flex-1 overflow-y-auto overscroll-contain">
            @for (item of filteredItems(); track item.id; let i = $index) {
              <button type="button"
                (click)="select(item)"
                (mouseenter)="highlightedIndex.set(i)"
                [class]="'w-full text-left px-4 py-2.5 text-sm border-b border-slate-50 dark:border-gray-900 transition-colors ' +
                  (item.id === value()
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-black font-medium'
                    : i === highlightedIndex()
                      ? 'bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-white'
                      : 'text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800/50')">
                {{ item.label }}
                @if (item.sublabel) {
                  <span class="text-xs ml-1.5" [class]="item.id === value()
                    ? 'text-white/60 dark:text-black/50'
                    : 'text-slate-400 dark:text-gray-500'">({{ item.sublabel }})</span>
                }
              </button>
            } @empty {
              <p class="px-4 py-8 text-sm text-slate-300 dark:text-gray-600 text-center">
                Keine Treffer
              </p>
            }
          </div>

          <!-- Footer mit Anzahl -->
          <div class="px-4 py-2 border-t border-slate-200 dark:border-gray-800
                      text-xs text-slate-400 dark:text-gray-500 text-center">
            {{ filteredItems().length }} von {{ items().length }} Produkten
          </div>
        </div>
      </div>
    }
  `,
})
export class SearchableSelectComponent implements OnInit {
  items = input.required<SelectItem[]>()
  value = model<string>('')
  placeholder = input<string>('Produkt suchen...')
  autoOpen = input(false)
  selected = output<string>()
  closed = output<void>()

  isOpen = signal(false)
  searchText = signal('')
  highlightedIndex = signal(0)

  private searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput')

  selectedItem = computed(() => {
    const v = this.value()
    if (!v) return null
    return this.items().find(i => i.id === v) ?? null
  })

  filteredItems = computed(() => {
    const query = this.searchText().toLowerCase().trim()
    const all = this.items()
    if (!query) return all
    return all.filter(i => i.label.toLowerCase().includes(query) || i.sublabel?.toLowerCase().includes(query))
  })

  ngOnInit() {
    if (this.autoOpen()) {
      this.open()
    }
  }

  open() {
    this.searchText.set('')
    this.highlightedIndex.set(0)
    this.isOpen.set(true)
    setTimeout(() => this.searchInput()?.nativeElement.focus())
  }

  close() {
    this.isOpen.set(false)
    this.closed.emit()
  }

  select(item: SelectItem) {
    this.value.set(item.id)
    this.selected.emit(item.id)
    this.close()
  }

  clear(event: Event) {
    event.stopPropagation()
    this.value.set('')
  }

  selectHighlighted() {
    const items = this.filteredItems()
    const idx = this.highlightedIndex()
    if (items[idx]) {
      this.select(items[idx])
    }
  }

  highlightNext() {
    const max = this.filteredItems().length - 1
    this.highlightedIndex.update(i => Math.min(i + 1, max))
  }

  highlightPrev() {
    this.highlightedIndex.update(i => Math.max(i - 1, 0))
  }
}
