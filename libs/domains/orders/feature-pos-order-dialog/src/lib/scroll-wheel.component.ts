import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  viewChild,
} from '@angular/core'

@Component({
  selector: 'app-scroll-wheel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center">
      @if (label()) {
        <span class="text-sm text-gray-400 dark:text-gray-500 mb-2">{{ label() }}</span>
      }
      <div #scrollContainer
        class="w-20 h-72 overflow-y-scroll snap-y snap-mandatory rounded-lg bg-gray-50 dark:bg-gray-800
               scrollbar-none relative"
        (scroll)="onScroll()">
        <!-- Top padding (2.5 Items = 120px) -->
        <div class="h-[120px] shrink-0"></div>
        @for (val of values(); track val) {
          <button type="button"
            [attr.data-value]="val"
            (click)="selectValue(val)"
            [class]="val === selected()
              ? 'h-12 w-full flex items-center justify-center text-xl font-bold text-gray-900 dark:text-white bg-gray-200 dark:bg-gray-700 rounded-lg snap-center transition-all'
              : 'h-12 w-full flex items-center justify-center text-xl text-gray-400 dark:text-gray-500 opacity-50 snap-center transition-all'">
            {{ val.toString().padStart(2, '0') }}
          </button>
        }
        <!-- Bottom padding (2.5 Items = 120px) -->
        <div class="h-[120px] shrink-0"></div>
      </div>
    </div>
  `,
  styles: `
    .scrollbar-none { scrollbar-width: none; }
    .scrollbar-none::-webkit-scrollbar { display: none; }
  `,
})
export class ScrollWheelComponent {
  values = input.required<number[]>()
  selected = input<number | null>(null)
  label = input<string>('')
  valueChange = output<number>()

  private scrollEl = viewChild<ElementRef<HTMLElement>>('scrollContainer')
  private isScrolling = false

  constructor() {
    afterNextRender(() => this.scrollToSelected())
  }

  selectValue(val: number) {
    this.valueChange.emit(val)
    this.scrollToValue(val)
  }

  onScroll() {
    if (this.isScrolling) return
    clearTimeout((this as any)._scrollTimer)
    ;(this as any)._scrollTimer = setTimeout(() => this.detectSelected(), 100)
  }

  private detectSelected() {
    const el = this.scrollEl()?.nativeElement
    if (!el) return
    const center = el.scrollTop + el.clientHeight / 2
    const buttons = el.querySelectorAll('button[data-value]')
    let closest: HTMLElement | null = null
    let minDist = Infinity
    buttons.forEach((btn: any) => {
      const mid = btn.offsetTop + btn.offsetHeight / 2
      const dist = Math.abs(mid - center)
      if (dist < minDist) {
        minDist = dist
        closest = btn
      }
    })
    if (closest) {
      const val = parseInt((closest as HTMLElement).getAttribute('data-value')!, 10)
      if (val !== this.selected()) {
        this.valueChange.emit(val)
      }
    }
  }

  private scrollToSelected() {
    const sel = this.selected()
    if (sel != null) this.scrollToValue(sel)
  }

  private scrollToValue(val: number) {
    const el = this.scrollEl()?.nativeElement
    if (!el) return
    const btn = el.querySelector(`button[data-value="${val}"]`) as HTMLElement | null
    if (!btn) return
    this.isScrolling = true
    const target = btn.offsetTop - el.clientHeight / 2 + btn.offsetHeight / 2
    el.scrollTo({ top: target, behavior: 'smooth' })
    setTimeout(() => (this.isScrolling = false), 300)
  }
}
