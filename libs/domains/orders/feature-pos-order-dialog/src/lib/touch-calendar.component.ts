import { ChangeDetectionStrategy, Component, computed, signal, input, output } from '@angular/core'

@Component({
  selector: 'app-touch-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; height: 100%; }
  `,
  template: `
    <div class="flex flex-col h-full bg-transparent select-none">
      <div class="flex items-center justify-between p-2 mb-2">
        <button (click)="prevMonth()"
          class="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <span class="text-lg font-bold text-gray-800 dark:text-white">{{ monthLabel() }}</span>
        <button (click)="nextMonth()"
          class="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      <div class="grid grid-cols-7 mb-2 text-center text-gray-500 dark:text-gray-400 font-bold text-sm">
        @for (day of weekDays; track day) {
          <div class="py-1">{{ day }}</div>
        }
      </div>

      <div class="grid grid-cols-7 gap-1.5 flex-1 content-start">
        @for (date of daysInMonth(); track $index) {
          @if (date) {
            <button [class]="dayClass(date)" [disabled]="isDisabled(date)" (click)="selectDate(date)">
              {{ date.getDate() }}
            </button>
          } @else {
            <div class="w-10 h-10 mx-auto"></div>
          }
        }
      </div>
    </div>
  `,
})
export class TouchCalendarComponent {
  selectedDate = input<Date | null>(null)
  closedDates = input<Set<string>>(new Set())
  dateChange = output<Date>()

  currentMonth = signal(new Date())
  weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

  monthLabel = computed(() => {
    const d = this.currentMonth()
    return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(d)
  })

  daysInMonth = computed(() => {
    const date = this.currentMonth()
    const year = date.getFullYear()
    const month = date.getMonth()
    const days = new Date(year, month + 1, 0).getDate()
    const offset = (new Date(year, month, 1).getDay() + 6) % 7

    const result: (Date | null)[] = []
    for (let i = 0; i < offset; i++) result.push(null)
    for (let i = 1; i <= days; i++) result.push(new Date(year, month, i))
    return result
  })

  prevMonth() {
    const c = this.currentMonth()
    this.currentMonth.set(new Date(c.getFullYear(), c.getMonth() - 1, 1))
  }

  nextMonth() {
    const c = this.currentMonth()
    this.currentMonth.set(new Date(c.getFullYear(), c.getMonth() + 1, 1))
  }

  selectDate(date: Date) {
    this.dateChange.emit(date)
  }

  dayClass(date: Date): string {
    const base = 'w-10 h-10 flex items-center justify-center rounded-full font-medium text-sm transition-all active:scale-90 mx-auto'
    if (this.isSelected(date)) {
      return `${base} bg-gray-800 text-white dark:bg-white dark:text-gray-900`
    }
    if (this.isDisabled(date)) {
      return `${base} bg-gray-50 text-gray-300 dark:bg-transparent dark:text-gray-600 cursor-not-allowed`
    }
    return `${base} bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600`
  }

  isSelected(date: Date): boolean {
    const sel = this.selectedDate()
    if (!sel) return false
    return date.getDate() === sel.getDate() &&
      date.getMonth() === sel.getMonth() &&
      date.getFullYear() === sel.getFullYear()
  }

  isPast(date: Date): boolean {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return date < today
  }

  isClosed(date: Date): boolean {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return this.closedDates().has(`${y}-${m}-${d}`)
  }

  isDisabled(date: Date): boolean {
    return this.isPast(date) || this.isClosed(date)
  }
}
