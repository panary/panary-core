import { ChangeDetectionStrategy, Component, computed, signal, input, output } from '@angular/core'

@Component({
  selector: 'app-touch-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; height: 100%; }
  `,
  template: `
    <div class="flex flex-col h-full bg-white dark:bg-gray-900 select-none">
      <div class="flex items-center justify-between p-2 mb-2">
        <button (click)="prevMonth()"
          class="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <span class="text-lg font-bold text-slate-800 dark:text-white">{{ monthLabel() }}</span>
        <button (click)="nextMonth()"
          class="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      <div class="grid grid-cols-7 mb-2 text-center text-slate-500 dark:text-gray-400 font-bold text-sm">
        @for (day of weekDays; track day) {
          <div class="py-1">{{ day }}</div>
        }
      </div>

      <div class="grid grid-cols-7 gap-1 flex-1 content-start">
        @for (date of daysInMonth(); track $index) {
          @if (date) {
            <button
              class="w-14 h-14 flex items-center justify-center rounded-full font-medium text-xl transition-all active:scale-90 mx-auto"
              [class.bg-slate-800]="isSelected(date)"
              [class.text-white]="isSelected(date)"
              [class.bg-slate-100]="!isSelected(date) && !isPast(date)" [class.dark:bg-gray-800]="!isSelected(date) && !isPast(date)"
              [class.text-slate-700]="!isSelected(date) && !isPast(date)" [class.dark:text-gray-200]="!isSelected(date) && !isPast(date)"
              [class.hover:bg-slate-200]="!isSelected(date) && !isPast(date)"
              [class.text-slate-300]="isPast(date)"
              [class.bg-slate-50]="isPast(date)"
              [class.cursor-not-allowed]="isPast(date)"
              [disabled]="isPast(date)"
              (click)="selectDate(date)">
              {{ date.getDate() }}
            </button>
          } @else {
            <div class="w-14 h-14 mx-auto"></div>
          }
        }
      </div>
    </div>
  `,
})
export class TouchCalendarComponent {
  selectedDate = input<Date | null>(null)
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
}
