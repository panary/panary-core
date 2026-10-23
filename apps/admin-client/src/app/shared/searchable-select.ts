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
    <button
      type="button"
      (click)="open()"
      class="w-full flex items-center justify-between gap-1 bg-surface-input
             border border-line-soft rounded-lg px-2 py-1.5
             text-sm outline-none hover:border-line-strong
             focus:border-ink transition min-w-0"
    >
      @if (selectedItem(); as item) {
        <span class="truncate text-ink">
          {{ item.label }}
          @if (item.sublabel) {
            <span class="text-ink-faint">({{ item.sublabel }})</span>
          }
        </span>
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <span
          (click)="clear($event)"
          class="text-line-strong hover:text-red-400 shrink-0 text-xs cursor-pointer px-0.5"
        >
          &#x2715;
        </span>
      } @else {
        <span class="truncate text-line-strong">{{ placeholder() }}</span>
        <svg
          class="w-3 h-3 shrink-0 text-line-strong"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
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
        <div
          class="relative w-full max-w-sm my-4 mr-4 flex flex-col bg-surface-input
                    border border-line-soft rounded-xl shadow-2xl overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-line-soft">
            <span class="text-sm font-medium text-ink">Produkt auswählen</span>
            <button type="button" (click)="close()" class="text-ink-faint hover:text-ink transition text-sm">
              &#x2715;
            </button>
          </div>

          <!-- Suchfeld -->
          <div class="px-4 py-2 border-b border-line-soft">
            <input
              #searchInput
              [value]="searchText()"
              (input)="searchText.set(searchInput.value)"
              (keydown.arrowdown)="highlightNext()"
              (keydown.arrowup)="highlightPrev()"
              (keydown.enter)="selectHighlighted()"
              type="text"
              [placeholder]="placeholder()"
              class="w-full bg-surface-bg border border-line-soft
                     rounded-lg px-3 py-2 text-sm text-ink outline-none
                     focus:border-ink transition"
            />
          </div>

          <!-- Liste -->
          <div class="flex-1 overflow-y-auto overscroll-contain">
            @for (item of filteredItems(); track item.id; let i = $index) {
              <button
                type="button"
                (click)="select(item)"
                (mouseenter)="highlightedIndex.set(i)"
                [class]="
                  'w-full text-left px-4 py-2.5 text-sm border-b border-line-soft transition-colors ' +
                  (item.id === value()
                    ? 'bg-ink text-surface-panel font-medium'
                    : i === highlightedIndex()
                      ? 'bg-line-soft text-ink'
                      : 'text-ink hover:bg-surface-elevated dark:hover:bg-surface-elevated/50')
                "
              >
                {{ item.label }}
                @if (item.sublabel) {
                  <span
                    class="text-xs ml-1.5"
                    [class]="item.id === value() ? 'text-white/60 dark:text-black/50' : 'text-ink-faint'"
                    >({{ item.sublabel }})</span
                  >
                }
              </button>
            } @empty {
              <p class="px-4 py-8 text-sm text-line-strong text-center">Keine Treffer</p>
            }
          </div>

          <!-- Footer mit Anzahl -->
          <div
            class="px-4 py-2 border-t border-line-soft
                      text-xs text-ink-faint text-center"
          >
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
