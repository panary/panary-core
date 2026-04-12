import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

export interface StepDef {
  label: string
  index: number
}

@Component({
  selector: 'app-pre-order-stepper',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-sm mx-auto flex items-start" aria-label="Fortschritt">
      @for (step of steps(); track step.index; let i = $index) {
        <!-- Step: Kreis + Label -->
        <div class="flex flex-col items-center" [style.width.px]="100">
          <span [class]="circleClass(i)"
                [attr.aria-current]="i === currentStep() ? 'step' : null">
            @if (i < currentStep()) {
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            } @else {
              {{ i + 1 }}
            }
          </span>
          <span [class]="labelClass(i)" class="mt-1.5 text-center whitespace-nowrap">
            {{ step.label | translate }}
          </span>
        </div>
        <!-- Connector -->
        @if (i < steps().length - 1) {
          <div class="flex-1 mt-5">
            <div [class]="i < currentStep()
              ? 'h-0.5 w-full bg-green-400 rounded'
              : 'h-0.5 w-full bg-gray-200 dark:bg-gray-700 rounded'"></div>
          </div>
        }
      }
    </div>
  `,
})
export class PreOrderStepperComponent {
  steps = input.required<StepDef[]>()
  currentStep = input.required<number>()

  circleClass(i: number): string {
    const base = 'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors'
    if (i < this.currentStep()) return `${base} bg-green-500 text-white`
    if (i === this.currentStep()) return `${base} bg-gray-900 dark:bg-white text-white dark:text-black`
    return `${base} bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500`
  }

  labelClass(i: number): string {
    if (i === this.currentStep()) return 'text-xs font-medium text-gray-900 dark:text-white'
    if (i < this.currentStep()) return 'text-xs text-gray-700 dark:text-gray-300'
    return 'text-xs text-gray-400 dark:text-gray-500'
  }
}
