import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core'
import { DecimalPipe } from '@angular/common'

@Component({
  selector: 'app-touch-time-picker',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; height: 100%; }
  `,
  template: `
    <div class="flex flex-col items-center h-full select-none">
      <!-- Stunden:Minuten Anzeige -->
      <div class="flex items-end gap-2 text-4xl font-bold mb-6 mt-4">
        <button (click)="switchToHours()"
          class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          [class.text-gray-800]="mode() === 'HOURS'"
          [class.text-gray-400]="mode() !== 'HOURS'">
          {{ hour() !== null ? (hour()! | number:'2.0') : '--' }}
        </button>
        <span class="mb-2 text-gray-400">:</span>
        <button (click)="switchToMinutes()"
          class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          [class.text-gray-800]="mode() === 'MINUTES'"
          [class.text-gray-400]="mode() !== 'MINUTES'">
          {{ minute() !== null ? (minute()! | number:'2.0') : '--' }}
        </button>
      </div>

      <!-- Uhren-Zifferblatt -->
      <div class="relative w-96 h-96 bg-gray-50 dark:bg-gray-800 rounded-full border border-gray-200 dark:border-gray-700 shadow-inner flex items-center justify-center">
        @if (mode() === 'HOURS') {
          <!-- Äußerer Ring (1-12) -->
          @for (h of outerHours; track h) {
            <button
              class="absolute w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-colors"
              [class.bg-gray-800]="hour() === h"
              [class.text-white]="hour() === h"
              [class.bg-white]="hour() !== h"
              [style.transform]="hourTransform(h, '9.5rem')"
              (click)="selectHour(h)">
              {{ h }}
            </button>
          }
          <!-- Innerer Ring (13-00) -->
          @for (h of innerHours; track h) {
            <button
              class="absolute w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors"
              [class.bg-gray-800]="hour() === h"
              [class.text-white]="hour() === h"
              [class.bg-gray-200]="hour() !== h"
              [class.text-gray-500]="hour() !== h"
              [style.transform]="hourTransform(h === 0 ? 12 : h - 12, '6.5rem')"
              (click)="selectHour(h)">
              {{ h | number:'2.0' }}
            </button>
          }
        } @else {
          <!-- Minuten (0, 5, 10 ... 55) -->
          @for (m of minuteSteps; track m) {
            <button
              class="absolute w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl transition-colors"
              [class.bg-gray-800]="minute() === m"
              [class.text-white]="minute() === m"
              [class.bg-white]="minute() !== m"
              [style.transform]="minuteTransform(m)"
              (click)="selectMinute(m)">
              {{ m | number:'2.0' }}
            </button>
          }
          <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
        }
      </div>
    </div>
  `,
})
export class TouchTimePickerComponent {
  selectedTime = input<string | null>(null)
  timeChange = output<string>()

  mode = signal<'HOURS' | 'MINUTES'>('HOURS')
  hour = signal<number | null>(null)
  minute = signal<number | null>(null)

  outerHours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  innerHours = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0]
  minuteSteps = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

  selectHour(h: number) {
    this.hour.set(h)
    this.mode.set('MINUTES')
    this.emitIfComplete()
  }

  selectMinute(m: number) {
    this.minute.set(m)
    this.emitIfComplete()
  }

  switchToHours() {
    this.mode.set('HOURS')
  }

  switchToMinutes() {
    if (this.hour() !== null) this.mode.set('MINUTES')
  }

  hourTransform(h: number, radius: string): string {
    const deg = h * 30 - 90
    return `rotate(${deg}deg) translate(${radius}) rotate(${-deg}deg)`
  }

  minuteTransform(m: number): string {
    const deg = (m / 60) * 360 - 90
    return `rotate(${deg}deg) translate(9rem) rotate(${-deg}deg)`
  }

  private emitIfComplete() {
    const h = this.hour()
    const m = this.minute()
    if (h !== null && m !== null) {
      this.timeChange.emit(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
}
