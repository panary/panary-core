import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms'
import { MatDialogRef } from '@angular/material/dialog'
import { MatStepperModule } from '@angular/material/stepper'
import { TouchCalendarComponent } from './touch-calendar.component'
import { TouchTimePickerComponent } from './touch-time-picker.component'
import { VirtualKeyboardComponent } from './virtual-keyboard.component'
import { TranslateModule } from '@ngx-translate/core'

/**
 * Vorbestelldialog mit 2-Schritt-Stepper.
 *
 * Schritt 1: Kalender (links) + Uhr-Zeitwahl (rechts)
 * Schritt 2: Kundenname + Telefonnummer mit virtuellem Tastaturlayout
 *
 * Gibt { date, time, name, phone } zurück.
 */
@Component({
  selector: 'app-pre-order-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatStepperModule,
    TouchCalendarComponent,
    TouchTimePickerComponent,
    VirtualKeyboardComponent,
    TranslateModule,
  ],
  styles: `
    ::ng-deep .mat-horizontal-content-container { overflow: visible !important; }
    ::ng-deep .mat-horizontal-stepper-header-container { z-index: 1; }
  `,
  template: `
    <div class="flex flex-col h-full w-full bg-white dark:bg-gray-950 rounded-xl overflow-hidden">
      <!-- Header -->
      <div class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex flex-row gap-2 items-center">
          <h2 class="text-xl font-bold text-gray-800 dark:text-white">{{ 'PRE_ORDER_DIALOG.TITLE' | translate }}</h2>
          @if (formattedDate()) {
            <span class="text-xl font-bold text-gray-600 dark:text-gray-300">für</span>
            <span class="text-xl font-bold px-2 py-0.5 rounded bg-gray-800 text-white">{{ formattedDate() }}</span>
          }
          @if (formattedTime()) {
            <span class="text-xl font-bold px-2 py-0.5 rounded bg-gray-800 text-white">{{ formattedTime() }} Uhr</span>
          }
        </div>
        <button (click)="close()"
          class="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 dark:text-gray-500">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- Stepper -->
      <div class="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950 relative">
        <mat-stepper [linear]="true" #stepper class="h-full bg-gray-50" [animationDuration]="'0'">

          <!-- Schritt 1: Zeitpunkt -->
          <mat-step [stepControl]="dateFormGroup">
            <ng-template matStepLabel>{{ 'PRE_ORDER_DIALOG.TIME_STEP' | translate }}</ng-template>
            <div class="flex flex-row h-full gap-4 p-4 items-stretch">
              <div class="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <app-touch-calendar
                  [selectedDate]="selectedDate()"
                  (dateChange)="onDateChange($event)" />
              </div>
              <div class="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden p-4">
                <app-touch-time-picker
                  [selectedTime]="selectedTime()"
                  (timeChange)="onTimeChange($event)" />
              </div>
            </div>
            <div class="flex justify-end p-6 pt-0">
              <button matStepperNext [disabled]="dateFormGroup.invalid"
                class="h-12 px-8 text-lg rounded-xl font-bold bg-gray-800 text-white
                       disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors">
                Weiter
              </button>
            </div>
          </mat-step>

          <!-- Schritt 2: Kontaktdaten -->
          <mat-step [stepControl]="contactFormGroup">
            <ng-template matStepLabel>{{ 'PRE_ORDER_DIALOG.CONTACT_STEP' | translate }}</ng-template>
            <div class="flex flex-col h-full bg-gray-50 dark:bg-gray-950 relative p-8">
              <div class="grid grid-cols-2 gap-8 items-start relative h-full">

                <!-- Name -->
                <div class="flex flex-col gap-2 relative">
                  <label class="font-bold text-gray-700 dark:text-gray-300 ml-1">{{ 'PRE_ORDERS.CUSTOMER_NAME' | translate }}</label>
                  <div
                    class="h-16 px-4 bg-white dark:bg-gray-800 border-2 rounded-xl flex items-center text-xl font-medium cursor-pointer dark:text-white transition-colors relative z-20"
                    [class.border-gray-800]="activeField() === 'name'"
                    [class.border-gray-200]="activeField() !== 'name'"
                    (click)="setActiveField('name')">
                    <span class="material-symbols-outlined text-gray-400 mr-2">person</span>
                    <span [class.text-gray-400]="!contactFormGroup.get('name')?.value">
                      {{ contactFormGroup.get('name')?.value || ('PRE_ORDER_DIALOG.ENTER_NAME' | translate) }}
                    </span>
                    @if (activeField() === 'name') {
                      <div class="w-0.5 h-6 bg-gray-800 animate-pulse ml-1"></div>
                    }
                  </div>

                  @if (activeField() === 'name') {
                    <div class="absolute top-[110%] left-0 z-50 filter drop-shadow-xl">
                      <div class="w-4 h-4 bg-gray-50 dark:bg-gray-950 border-t border-l border-gray-200 dark:border-gray-700 transform rotate-45 absolute -top-2 left-8 z-20"></div>
                      <app-virtual-keyboard
                        [layout]="'default'"
                        (keyPress)="onKeyPress($event)"
                        (backspace)="onBackspace()"
                        (enter)="onEnter()" />
                    </div>
                  }
                </div>

                <!-- Telefon -->
                <div class="flex flex-col gap-2 relative">
                  <label class="font-bold text-gray-700 dark:text-gray-300 ml-1">{{ 'PRE_ORDER_DIALOG.PHONE_NUMBER' | translate }}</label>
                  <div
                    class="h-16 px-4 bg-white dark:bg-gray-800 border-2 rounded-xl flex items-center text-xl font-medium cursor-pointer dark:text-white transition-colors relative z-20"
                    [class.border-gray-800]="activeField() === 'phone'"
                    [class.border-gray-200]="activeField() !== 'phone'"
                    (click)="setActiveField('phone')">
                    <span class="material-symbols-outlined text-gray-400 mr-2">phone</span>
                    <span [class.text-gray-400]="!contactFormGroup.get('phone')?.value">
                      {{ contactFormGroup.get('phone')?.value || ('PRE_ORDER_DIALOG.ENTER_PHONE' | translate) }}
                    </span>
                    @if (activeField() === 'phone') {
                      <div class="w-0.5 h-6 bg-gray-800 animate-pulse ml-1"></div>
                    }
                  </div>

                  @if (activeField() === 'phone') {
                    <div class="absolute top-[110%] right-0 z-50 filter drop-shadow-xl">
                      <div class="w-4 h-4 bg-gray-50 dark:bg-gray-950 border-t border-l border-gray-200 dark:border-gray-700 transform rotate-45 absolute -top-2 right-8 z-20"></div>
                      <app-virtual-keyboard
                        [layout]="'numeric'"
                        (keyPress)="onKeyPress($event)"
                        (backspace)="onBackspace()"
                        (enter)="onEnter()" />
                    </div>
                  }
                </div>
              </div>

              <!-- Navigation (nur sichtbar wenn keine Tastatur aktiv) -->
              @if (!activeField()) {
                <div class="flex justify-end gap-4 mt-auto pt-4">
                  <button matStepperPrevious
                    class="h-12 px-6 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    Zurück
                  </button>
                  <button (click)="submit()" [disabled]="contactFormGroup.invalid"
                    class="h-12 px-8 text-lg rounded-xl font-bold bg-yellow-400 text-gray-900
                           disabled:opacity-50 disabled:cursor-not-allowed hover:bg-yellow-500 transition-colors">
                    Abschließen
                  </button>
                </div>
              }
            </div>
          </mat-step>

        </mat-stepper>
      </div>
    </div>
  `,
})
export class PreOrderQuickDialogComponent {
  #dialogRef = inject(MatDialogRef<PreOrderQuickDialogComponent>)
  #fb = inject(FormBuilder)

  dateFormGroup = this.#fb.group({
    date: [new Date(), Validators.required],
    time: ['', Validators.required],
  })

  contactFormGroup = this.#fb.group({
    name: ['', Validators.required],
    phone: ['', Validators.required],
  })

  // Keyboard-State
  activeField = signal<'name' | 'phone' | null>(null)

  // Datum/Zeit-Anzeige
  selectedDate = signal<Date | null>(new Date())
  selectedTime = signal('')

  formattedDate = computed(() => {
    const d = this.selectedDate()
    if (!d) return ''
    return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(d)
  })

  formattedTime = computed(() => this.selectedTime())

  // --- Datum/Zeit-Handler ---

  onDateChange(date: Date) {
    this.selectedDate.set(date)
    this.dateFormGroup.patchValue({ date })
  }

  onTimeChange(time: string) {
    this.selectedTime.set(time)
    this.dateFormGroup.patchValue({ time })
  }

  // --- Tastatur-Handler ---

  setActiveField(field: 'name' | 'phone') {
    this.activeField.set(field)
  }

  onKeyPress(key: string) {
    const field = this.activeField()
    if (!field) return
    const current = this.contactFormGroup.get(field)?.value || ''
    this.contactFormGroup.patchValue({ [field]: current + key })
  }

  onBackspace() {
    const field = this.activeField()
    if (!field) return
    const current = this.contactFormGroup.get(field)?.value || ''
    if (current.length > 0) {
      this.contactFormGroup.patchValue({ [field]: current.slice(0, -1) })
    }
  }

  onEnter() {
    if (this.activeField() === 'name') {
      this.setActiveField('phone')
    } else {
      this.activeField.set(null)
    }
  }

  // --- Dialog-Aktionen ---

  close() {
    this.#dialogRef.close()
  }

  submit() {
    if (this.dateFormGroup.valid && this.contactFormGroup.valid) {
      this.#dialogRef.close({
        ...this.dateFormGroup.value,
        ...this.contactFormGroup.value,
      })
    }
  }
}
