import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, OnInit, signal } from '@angular/core'
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms'
import { MatDialogRef } from '@angular/material/dialog'
import { LocationService } from '@panary/locations/data-access'
import { ConnectionService } from '@panary/shared/data-access'
import { formatDateISO, getOpeningHoursForDate, type RegularHour, type HourException } from '@panary/locations/domain'
import { TouchCalendarComponent } from './touch-calendar.component'
import { ScrollWheelComponent } from './scroll-wheel.component'
import { TouchKeyboardComponent } from './touch-keyboard.component'
import { PreOrderStepperComponent } from './pre-order-stepper.component'
import { TranslateModule } from '@ngx-translate/core'

/**
 * Vorbestelldialog mit 3-Schritt-Stepper (horizontal, fixed height).
 *
 * Schritt 1: Kalender + Scroll-Wheel-Zeitwahl
 * Schritt 2: Vor Ort / Abholung (große Karten)
 * Schritt 3: Kundenname + Telefonnummer (Inline-Keyboard)
 *
 * Gibt { date, time, dineLocation, name, phone } zurück.
 */
@Component({
  selector: 'app-pre-order-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    TouchCalendarComponent,
    ScrollWheelComponent,
    TouchKeyboardComponent,
    PreOrderStepperComponent,
    TranslateModule,
  ],
  template: `
    <div role="dialog" aria-modal="true" aria-labelledby="pre-order-title"
         class="flex flex-col w-full h-[620px] bg-white dark:bg-gray-950 rounded-2xl shadow-xl overflow-hidden">

      <!-- HEADER (h-20) -->
      <div class="h-20 shrink-0 px-6 py-5 flex justify-between items-start">
        <div>
          <h2 id="pre-order-title" class="text-lg font-bold text-gray-900 dark:text-white">
            {{ stepLabels[currentStep()].label | translate }}
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            @if (formattedDate()) {
              Vorbestellung für {{ formattedDate() }}
              @if (formattedTime()) { · {{ formattedTime() }} Uhr }
            } @else {
              Neue Vorbestellung erstellen
            }
          </p>
        </div>
        <button (click)="close()" type="button"
          class="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 dark:text-gray-500
                 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95 transition-all">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <!-- STEPPER -->
      <div class="shrink-0 px-6 pt-2 pb-4">
        <app-pre-order-stepper [steps]="stepLabels" [currentStep]="currentStep()" />
      </div>

      <!-- CONTENT (flex-1) -->
      <div class="flex-1 overflow-hidden relative">
        <div class="max-w-2xl mx-auto w-full px-6 py-2 h-full overflow-y-auto">
          @switch (currentStep()) {

            @case (0) {
              <!-- STEP 1: Zeitpunkt -->
              <div class="grid grid-cols-2 gap-4">
                <!-- Kalender -->
                <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden p-3">
                  <app-touch-calendar
                    [selectedDate]="selectedDate()"
                    [closedDates]="closedDatesSet()"
                    (dateChange)="onDateChange($event)" />
                </div>
                <!-- Scroll-Wheel-Zeitwahl -->
                <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700
                            flex flex-col items-center justify-center p-3">
                  <span class="text-xs text-gray-400 dark:text-gray-500 mb-2">Uhrzeit wählen</span>
                  <div class="flex items-center gap-3">
                    <app-scroll-wheel
                      [values]="availableHours()"
                      [selected]="selectedHour()"
                      (valueChange)="onHourChange($event)" />
                    <span class="text-2xl font-bold text-gray-800 dark:text-white">:</span>
                    <app-scroll-wheel
                      [values]="allMinutes"
                      [selected]="selectedMinute()"
                      (valueChange)="onMinuteChange($event)" />
                  </div>
                </div>
              </div>
            }

            @case (1) {
              <!-- STEP 2: Vor Ort / Abholung -->
              <div class="flex flex-col gap-4">
                <p class="text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Wo wird die Bestellung konsumiert?
                </p>
                <!-- Im Haus -->
                <button type="button" (click)="dineFormGroup.patchValue({ dineLocation: 'dine-in' })"
                  [class]="dineFormGroup.get('dineLocation')?.value === 'dine-in'
                    ? 'h-28 rounded-xl border-2 border-gray-900 dark:border-white bg-gray-100 dark:bg-gray-800/50 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'
                    : 'h-28 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-800/30 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'">
                  <div class="h-16 w-16 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined text-[28px] text-gray-500 dark:text-gray-400">restaurant</span>
                  </div>
                  <div>
                    <span class="text-lg font-semibold text-gray-900 dark:text-white block">Im Haus</span>
                    <span class="text-sm text-gray-500 dark:text-gray-400">Gast isst vor Ort am Tisch</span>
                  </div>
                </button>
                <!-- Außer Haus -->
                <button type="button" (click)="dineFormGroup.patchValue({ dineLocation: 'take-out' })"
                  [class]="dineFormGroup.get('dineLocation')?.value === 'take-out'
                    ? 'h-28 rounded-xl border-2 border-gray-900 dark:border-white bg-gray-100 dark:bg-gray-800/50 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'
                    : 'h-28 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-800/30 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'">
                  <div class="h-16 w-16 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined text-[28px] text-gray-500 dark:text-gray-400">local_mall</span>
                  </div>
                  <div>
                    <span class="text-lg font-semibold text-gray-900 dark:text-white block">Außer Haus</span>
                    <span class="text-sm text-gray-500 dark:text-gray-400">Kunde holt die Bestellung ab</span>
                  </div>
                </button>
              </div>
            }

            @case (2) {
              <!-- STEP 3: Kontaktdaten -->
              <div class="flex flex-col gap-4">
                <!-- Felder nebeneinander -->
                <div class="grid grid-cols-2 gap-4">
                  <!-- Kundenname -->
                  <div>
                    <label for="preorder-name" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                      {{ 'PRE_ORDERS.CUSTOMER_NAME' | translate }}
                    </label>
                    <div id="preorder-name"
                      class="h-12 px-3 bg-white dark:bg-gray-800 border rounded-lg flex items-center text-base
                             cursor-pointer dark:text-white transition-colors"
                      [class.border-gray-900]="activeField() === 'name'"
                      [class.dark:border-white]="activeField() === 'name'"
                      [class.border-gray-200]="activeField() !== 'name'"
                      [class.dark:border-gray-700]="activeField() !== 'name'"
                      [attr.aria-describedby]="'name-help'"
                      (click)="setActiveField('name')">
                      <span class="material-symbols-outlined text-gray-400 mr-2 text-[18px]">person</span>
                      <span [class.text-gray-400]="!contactFormGroup.get('name')?.value">
                        {{ contactFormGroup.get('name')?.value || ('PRE_ORDER_DIALOG.ENTER_NAME' | translate) }}
                      </span>
                      @if (activeField() === 'name') {
                        <div class="w-0.5 h-5 bg-gray-800 dark:bg-white animate-pulse ml-0.5"></div>
                      }
                    </div>
                    <p id="name-help" class="text-xs text-gray-400 dark:text-gray-500 mt-1">Name für die Bestellabholung</p>
                  </div>

                  <!-- Telefonnummer -->
                  <div>
                    <label for="preorder-phone" class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
                      {{ 'PRE_ORDER_DIALOG.PHONE_NUMBER' | translate }}
                    </label>
                    <div id="preorder-phone"
                      class="h-12 px-3 bg-white dark:bg-gray-800 border rounded-lg flex items-center text-base
                             cursor-pointer dark:text-white transition-colors"
                      [class.border-gray-900]="activeField() === 'phone'"
                      [class.dark:border-white]="activeField() === 'phone'"
                      [class.border-gray-200]="activeField() !== 'phone'"
                      [class.dark:border-gray-700]="activeField() !== 'phone'"
                      [attr.aria-describedby]="'phone-help'"
                      (click)="setActiveField('phone')">
                      <span class="material-symbols-outlined text-gray-400 mr-2 text-[18px]">phone</span>
                      <span [class.text-gray-400]="!contactFormGroup.get('phone')?.value">
                        {{ contactFormGroup.get('phone')?.value || ('PRE_ORDER_DIALOG.ENTER_PHONE' | translate) }}
                      </span>
                      @if (activeField() === 'phone') {
                        <div class="w-0.5 h-5 bg-gray-800 dark:bg-white animate-pulse ml-0.5"></div>
                      }
                    </div>
                    <p id="phone-help" class="text-xs text-gray-400 dark:text-gray-500 mt-1">Für Rückfragen bei der Bestellung</p>
                  </div>
                </div>

                <!-- Inline Keyboard (unter beiden Feldern) -->
                @if (activeField() === 'name') {
                  <div class="transition-all duration-200">
                    <app-touch-keyboard layout="qwertz"
                      (keyPress)="onKeyPress($event)"
                      (backspace)="onBackspace()"
                      (confirm)="onEnter()" />
                  </div>
                }
                @if (activeField() === 'phone') {
                  <div class="transition-all duration-200">
                    <app-touch-keyboard layout="numpad"
                      (keyPress)="onKeyPress($event)"
                      (backspace)="onBackspace()"
                      (confirm)="onEnter()" />
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>

      <!-- FOOTER (h-[72px]) -->
      <div class="h-[72px] shrink-0 border-t border-gray-200 dark:border-gray-700 px-6 flex items-center justify-between">
        @if (currentStep() > 0) {
          <button type="button" (click)="prevStep()"
            class="h-11 px-5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95 transition-all">
            Zurück
          </button>
        } @else {
          <button type="button" disabled
            class="h-11 px-5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300
                   opacity-50 pointer-events-none">
            Zurück
          </button>
        }

        @if (currentStep() < 2) {
          <button type="button" (click)="nextStep()"
            [disabled]="currentStep() === 0 ? dateFormGroup.invalid : dineFormGroup.invalid"
            class="h-11 px-6 rounded-lg text-sm font-bold bg-gray-900 dark:bg-white text-white dark:text-black
                   disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-200
                   active:scale-95 transition-all">
            Weiter
          </button>
        } @else {
          <button type="button" (click)="submit()" [disabled]="contactFormGroup.invalid"
            class="h-11 px-6 rounded-lg text-sm font-bold bg-gray-900 dark:bg-white text-white dark:text-black
                   disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-200
                   active:scale-95 transition-all">
            Abschließen
          </button>
        }
      </div>
    </div>
  `,
})
export class PreOrderQuickDialogComponent implements OnInit {
  #dialogRef = inject(MatDialogRef<PreOrderQuickDialogComponent>)
  #fb = inject(FormBuilder)
  #cdr = inject(ChangeDetectorRef)
  #locationService = inject(LocationService)
  #connectionService = inject(ConnectionService)

  currentStep = signal(0)

  stepLabels = [
    { index: 0, label: 'PRE_ORDER_DIALOG.TIME_STEP' },
    { index: 1, label: 'PRE_ORDER_DIALOG.DINE_STEP' },
    { index: 2, label: 'PRE_ORDER_DIALOG.CONTACT_STEP' },
  ]

  // Öffnungszeiten
  regularHours = signal<RegularHour[]>([])
  hourExceptions = signal<HourException[]>([])
  openingHoursEnabled = signal(false)

  // Geschlossene Tage (nächste 90 Tage) für den Kalender
  closedDatesSet = computed(() => {
    if (!this.openingHoursEnabled()) return new Set<string>()
    const set = new Set<string>()
    const today = new Date()
    for (let i = 0; i < 90; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const result = getOpeningHoursForDate(d, this.regularHours(), this.hourExceptions())
      if (result.closed) set.add(formatDateISO(d))
    }
    return set
  })

  // Verfügbare Stunden basierend auf gewähltem Datum
  availableHours = computed(() => {
    const allHours = Array.from({ length: 24 }, (_, i) => i)
    if (!this.openingHoursEnabled()) return allHours
    const date = this.selectedDate()
    if (!date) return allHours
    const oh = getOpeningHoursForDate(date, this.regularHours(), this.hourExceptions())
    if (oh.closed || !oh.open || !oh.close) return allHours
    const openH = parseInt(oh.open.split(':')[0], 10)
    const closeH = parseInt(oh.close.split(':')[0], 10)
    return allHours.filter(h => h >= openH && h <= closeH)
  })

  allMinutes = Array.from({ length: 12 }, (_, i) => i * 5)

  dateFormGroup = this.#fb.group({
    date: [new Date(), Validators.required],
    time: ['', Validators.required],
  })

  dineFormGroup = this.#fb.group({
    dineLocation: ['take-out', Validators.required],
  })

  contactFormGroup = this.#fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.minLength(4)]],
  })

  activeField = signal<'name' | 'phone' | null>(null)

  async ngOnInit() {
    try {
      const location = this.#locationService.activeLocation()
      const ohs = (location as any)?.settings?.openingHoursSettings
      if (ohs?.enabled) {
        this.openingHoursEnabled.set(true)
        this.regularHours.set(ohs.regular ?? [])

        // Ausnahmen über Feathers-Client laden (nur zukünftige)
        const today = formatDateISO(new Date())
        const excResult = await this.#connectionService.openingHourExceptionsService.find({
          query: { date: { $gte: today }, $limit: 200, $sort: { date: 1 } },
        })
        const excData = Array.isArray(excResult) ? excResult : (excResult as any).data
        this.hourExceptions.set(excData)
      }
    } catch (e) {
      console.error('Fehler beim Laden der Öffnungszeiten:', e)
    }
  }
  selectedDate = signal<Date | null>(new Date())
  selectedHour = signal<number | null>(null)
  selectedMinute = signal<number | null>(null)
  selectedTime = signal('')

  formattedDate = computed(() => {
    const d = this.selectedDate()
    if (!d) return ''
    return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }).format(d)
  })

  formattedTime = computed(() => this.selectedTime())

  // --- Navigation ---

  goToStep(index: number) {
    if (index <= this.currentStep()) this.currentStep.set(index)
  }

  nextStep() {
    this.currentStep.update(s => Math.min(s + 1, 2))
  }

  prevStep() {
    this.currentStep.update(s => Math.max(s - 1, 0))
  }

  // --- Datum/Zeit-Handler ---

  onDateChange(date: Date) {
    this.selectedDate.set(date)
    this.dateFormGroup.patchValue({ date })
  }

  onHourChange(h: number) {
    this.selectedHour.set(h)
    this.emitTimeIfComplete()
  }

  onMinuteChange(m: number) {
    this.selectedMinute.set(m)
    this.emitTimeIfComplete()
  }

  private emitTimeIfComplete() {
    const h = this.selectedHour()
    const m = this.selectedMinute()
    if (h != null && m != null) {
      const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
      this.selectedTime.set(time)
      this.dateFormGroup.patchValue({ time })
    }
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
    this.#cdr.markForCheck()
  }

  onBackspace() {
    const field = this.activeField()
    if (!field) return
    const current = this.contactFormGroup.get(field)?.value || ''
    if (current.length > 0) {
      this.contactFormGroup.patchValue({ [field]: current.slice(0, -1) })
    }
    this.#cdr.markForCheck()
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
    if (this.dateFormGroup.valid && this.dineFormGroup.valid && this.contactFormGroup.valid) {
      this.#dialogRef.close({
        ...this.dateFormGroup.value,
        ...this.dineFormGroup.value,
        ...this.contactFormGroup.value,
      })
    }
  }
}
