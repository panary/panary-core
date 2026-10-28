import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core'
import { form, minLength, required } from '@angular/forms/signals'
import { MatDialogRef } from '@angular/material/dialog'
import { LocationService } from '@panary/locations/data-access'
import { ConnectionService } from '@panary/shared/data-access'
import { formatDateISO, getOpeningHoursForDate, type RegularHour, type HourException } from '@panary/locations/domain'
import { TouchCalendarComponent } from './touch-calendar.component'
import { ScrollWheelComponent } from './scroll-wheel.component'
import { TouchKeyboardComponent } from './touch-keyboard.component'
import { PreOrderStepperComponent } from './pre-order-stepper.component'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent } from '@panary/shared/ui-common'

/**
 * Ergebnis des Dialogs. `date` ist beim Schließen nie `null`, weil der Dialog nur mit gültigem Formular schließt.
 */
export interface PreOrderQuickResult {
  date: Date | null
  time: string
  dineLocation: 'dine-in' | 'take-out'
  name: string
  phone: string
}

/**
 * Baut aus dem Dialog-Ergebnis den Payload für `pre-orders.create`. `dineLocation` gehört dazu: Der Edge übernimmt
 * es beim Umwandeln in die Bestellung. Fehlte es, stand eine Vorbestellung „Im Haus“ als Abholung in der Liste
 * (panary/panary-core#1177).
 */
export function buildQuickPreOrderPayload<TLineItem>(
  result: PreOrderQuickResult & { date: Date },
  lineItems: readonly TLineItem[],
) {
  const scheduledFor = new Date(result.date)
  const [hours, minutes] = result.time.split(':').map(Number)
  scheduledFor.setHours(hours, minutes, 0, 0)
  return {
    customerContact: {
      name: result.name,
      phone: result.phone || '',
    },
    scheduledFor: scheduledFor.toISOString(),
    dineLocation: result.dineLocation,
    lineItems: [...lineItems],
    status: 'pending' as const,
  }
}

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
    IconComponent,
    TouchCalendarComponent,
    ScrollWheelComponent,
    TouchKeyboardComponent,
    PreOrderStepperComponent,
    TranslateModule,
  ],
  template: `
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pre-order-title"
      class="flex flex-col w-full h-[38.75rem] bg-surface-input rounded-2xl overflow-hidden"
    >
      <!-- HEADER (h-20) -->
      <div class="h-20 shrink-0 px-6 py-5 flex justify-between items-start">
        <div>
          <h2 id="pre-order-title" class="text-lg font-bold text-ink">
            {{ stepLabels[currentStep()].label | translate }}
          </h2>
          <p class="text-sm text-ink-muted mt-0.5">
            @if (formattedDate()) {
              Vorbestellung für {{ formattedDate() }}
              @if (formattedTime()) {
                · {{ formattedTime() }} Uhr
              }
            } @else {
              Neue Vorbestellung erstellen
            }
          </p>
        </div>
        <button
          (click)="close()"
          type="button"
          class="w-10 h-10 rounded-lg flex items-center justify-center text-ink-faint
                 hover:bg-line-soft active:scale-95 transition-all"
        >
          <lib-icon name="x" class="text-[1.25rem]" />
        </button>
      </div>

      <!-- STEPPER -->
      <div class="shrink-0 px-6 pt-2 pb-4">
        <app-pre-order-stepper [steps]="stepLabels" [currentStep]="currentStep()" />
      </div>

      <!-- CONTENT (flex-1) -->
      <div class="flex-1 overflow-hidden relative">
        <div class="max-w-3xl mx-auto w-full px-6 py-2 h-full overflow-y-auto">
          @switch (currentStep()) {
            @case (0) {
              <!-- STEP 1: Zeitpunkt -->
              <div class="grid grid-cols-2 gap-4">
                <!-- Kalender -->
                <div class="bg-surface-elevated rounded-xl border border-line overflow-hidden p-3">
                  <app-touch-calendar
                    [selectedDate]="selectedDate()"
                    [closedDates]="closedDatesSet()"
                    (dateChange)="onDateChange($event)"
                  />
                </div>
                <!-- Scroll-Wheel-Zeitwahl -->
                <div
                  class="bg-surface-elevated rounded-xl border border-line
                            flex flex-col items-center justify-center p-3"
                >
                  <span class="text-xs text-ink-faint mb-2">Uhrzeit wählen</span>
                  <div class="flex items-center gap-3">
                    <app-scroll-wheel
                      [values]="availableHours()"
                      [selected]="selectedHour()"
                      (valueChange)="onHourChange($event)"
                    />
                    <span class="text-2xl font-bold text-ink">:</span>
                    <app-scroll-wheel
                      [values]="allMinutes"
                      [selected]="selectedMinute()"
                      (valueChange)="onMinuteChange($event)"
                    />
                  </div>
                </div>
              </div>
            }

            @case (1) {
              <!-- STEP 2: Vor Ort / Abholung -->
              <div class="flex flex-col gap-4">
                <p class="text-base font-medium text-ink mb-2">Wo wird die Bestellung konsumiert?</p>
                <!-- Im Haus -->
                <button
                  type="button"
                  (click)="setDineLocation('dine-in')"
                  [class]="
                    preOrderForm.dineLocation().value() === 'dine-in'
                      ? 'h-28 rounded-xl border-2 border-ink bg-surface-bg dark:bg-surface-elevated/50 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'
                      : 'h-28 rounded-xl border-2 border-line bg-surface-input hover:bg-surface-elevated dark:hover:bg-surface-elevated/30 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'
                  "
                >
                  <div class="h-16 w-16 rounded-lg bg-line-soft flex items-center justify-center shrink-0">
                    <lib-icon name="fork-knife" class="text-[1.75rem] text-ink-muted" />
                  </div>
                  <div>
                    <span class="text-lg font-semibold text-ink block">Im Haus</span>
                    <span class="text-sm text-ink-muted">Gast isst vor Ort am Tisch</span>
                  </div>
                </button>
                <!-- Außer Haus -->
                <button
                  type="button"
                  (click)="setDineLocation('take-out')"
                  [class]="
                    preOrderForm.dineLocation().value() === 'take-out'
                      ? 'h-28 rounded-xl border-2 border-ink bg-surface-bg dark:bg-surface-elevated/50 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'
                      : 'h-28 rounded-xl border-2 border-line bg-surface-input hover:bg-surface-elevated dark:hover:bg-surface-elevated/30 p-5 flex items-center gap-5 cursor-pointer active:scale-[0.98] transition-all text-left w-full'
                  "
                >
                  <div class="h-16 w-16 rounded-lg bg-line-soft flex items-center justify-center shrink-0">
                    <lib-icon name="shopping-bag" class="text-[1.75rem] text-ink-muted" />
                  </div>
                  <div>
                    <span class="text-lg font-semibold text-ink block">Außer Haus</span>
                    <span class="text-sm text-ink-muted">Kunde holt die Bestellung ab</span>
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
                    <label for="preorder-name" class="text-sm font-medium text-ink mb-1.5 block">
                      {{ 'PRE_ORDERS.CUSTOMER_NAME' | translate }}
                    </label>
                    <div
                      id="preorder-name"
                      class="h-12 px-3 bg-surface-elevated border rounded-lg flex items-center text-base
                             cursor-pointer dark:text-white transition-colors"
                      [class.border-ink]="activeField() === 'name'"
                      [class.border-line]="activeField() !== 'name'"
                      [attr.aria-describedby]="'name-help'"
                      (click)="setActiveField('name')"
                    >
                      <lib-icon name="user" class="text-ink-faint mr-2 text-[1.125rem]" />
                      <span [class.text-ink-faint]="!preOrderForm.name().value()">
                        {{ preOrderForm.name().value() || ('PRE_ORDER_DIALOG.ENTER_NAME' | translate) }}
                      </span>
                      @if (activeField() === 'name') {
                        <div class="w-0.5 h-5 bg-ink animate-pulse ml-0.5"></div>
                      }
                    </div>
                    <p id="name-help" class="text-xs text-ink-faint mt-1">Name für die Bestellabholung</p>
                  </div>

                  <!-- Telefonnummer -->
                  <div>
                    <label for="preorder-phone" class="text-sm font-medium text-ink mb-1.5 block">
                      {{ 'PRE_ORDER_DIALOG.PHONE_NUMBER' | translate }}
                    </label>
                    <div
                      id="preorder-phone"
                      class="h-12 px-3 bg-surface-elevated border rounded-lg flex items-center text-base
                             cursor-pointer dark:text-white transition-colors"
                      [class.border-ink]="activeField() === 'phone'"
                      [class.border-line]="activeField() !== 'phone'"
                      [attr.aria-describedby]="'phone-help'"
                      (click)="setActiveField('phone')"
                    >
                      <lib-icon name="phone" class="text-ink-faint mr-2 text-[1.125rem]" />
                      <span [class.text-ink-faint]="!preOrderForm.phone().value()">
                        {{ preOrderForm.phone().value() || ('PRE_ORDER_DIALOG.ENTER_PHONE' | translate) }}
                      </span>
                      @if (activeField() === 'phone') {
                        <div class="w-0.5 h-5 bg-ink animate-pulse ml-0.5"></div>
                      }
                    </div>
                    <p id="phone-help" class="text-xs text-ink-faint mt-1">Für Rückfragen bei der Bestellung</p>
                  </div>
                </div>

                <!-- Inline Keyboard (unter beiden Feldern) -->
                @if (activeField() === 'name') {
                  <div class="transition-all duration-200">
                    <app-touch-keyboard
                      layout="qwertz"
                      (keyPress)="onKeyPress($event)"
                      (backspace)="onBackspace()"
                      (confirm)="onEnter()"
                    />
                  </div>
                }
                @if (activeField() === 'phone') {
                  <div class="transition-all duration-200">
                    <app-touch-keyboard
                      layout="numpad"
                      (keyPress)="onKeyPress($event)"
                      (backspace)="onBackspace()"
                      (confirm)="onEnter()"
                    />
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>

      <!-- FOOTER (h-[4.5rem]) -->
      <div class="h-[4.5rem] shrink-0 border-t border-line px-6 flex items-center justify-between">
        @if (currentStep() > 0) {
          <button
            type="button"
            (click)="prevStep()"
            class="h-11 px-5 rounded-lg text-sm font-medium text-ink-muted dark:text-ink
                   hover:bg-line-soft active:scale-95 transition-all"
          >
            Zurück
          </button>
        } @else {
          <button
            type="button"
            disabled
            class="h-11 px-5 rounded-lg text-sm font-medium text-ink-muted dark:text-ink
                   opacity-50 pointer-events-none"
          >
            Zurück
          </button>
        }

        @if (currentStep() < 2) {
          <button
            type="button"
            (click)="nextStep()"
            [disabled]="!stepValid()"
            class="h-11 px-6 rounded-lg text-sm font-bold bg-ink text-surface-panel
                   disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink/90
                   active:scale-95 transition-all"
          >
            Weiter
          </button>
        } @else {
          <button
            type="button"
            (click)="submit()"
            [disabled]="preOrderForm().invalid()"
            class="h-11 px-6 rounded-lg text-sm font-bold bg-ink text-surface-panel
                   disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink/90
                   active:scale-95 transition-all"
          >
            Abschließen
          </button>
        }
      </div>
    </div>
  `,
})
export class PreOrderQuickDialogComponent implements OnInit {
  #dialogRef = inject(MatDialogRef<PreOrderQuickDialogComponent>)
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

  // Ein Modell für alle drei Schritte; das Ergebnis des Dialogs ist genau dieser Wert.
  readonly preOrder = signal<PreOrderQuickResult>({
    date: new Date(),
    time: '',
    dineLocation: 'take-out',
    name: '',
    phone: '',
  })

  readonly preOrderForm = form(this.preOrder, p => {
    required(p.date)
    required(p.time)
    required(p.dineLocation)
    required(p.name)
    minLength(p.name, 2)
    required(p.phone)
    minLength(p.phone, 4)
  })

  // „Weiter“ prüft nur die Felder des aktuellen Schritts, der letzte Schritt das ganze Formular.
  readonly stepValid = computed(() => {
    const f = this.preOrderForm
    switch (this.currentStep()) {
      case 0:
        return f.date().valid() && f.time().valid()
      case 1:
        return f.dineLocation().valid()
      default:
        return f().valid()
    }
  })

  activeField = signal<'name' | 'phone' | null>(null)

  async ngOnInit() {
    try {
      const location = this.#locationService.activeLocation()
      const ohs = (location as any)?.settings?.openingHoursSettings
      if (ohs?.enabled) {
        this.openingHoursEnabled.set(true)
        this.regularHours.set(ohs.regular ?? [])

        // Ausnahmen über Feathers-Client laden (nur zukünftige) — und nur die der
        // aktiven Filiale: Ausnahmen werden pro Filiale materialisiert, und
        // `getOpeningHoursForDate` nimmt die ERSTE Zeile mit passendem Datum. Auf den
        // Server-Scope ist dabei kein Verlass — `multiTenancy` setzt für
        // TENANT_OWNER/TENANT_MANAGER keinen Location-Filter
        // (`.claude/rules/security.md` §4), ein so angemeldeter POS-Nutzer bekäme also
        // die Zeilen aller Filialen und der Kalender sperrte fremde Feiertage.
        //
        // Am Edge liegen heute nur eigene Zeilen (der Cloud-Pull scopet
        // `opening-hour-exceptions` auf die Filiale der Edge), nach einem Re-Pairing
        // auf eine andere Filiale bleibt der Altbestand aber liegen — der Sync löscht
        // ihn nicht (panary/panary-core#286).
        const today = formatDateISO(new Date())
        const locationId = (location as any)?._id
        const excResult = await this.#connectionService.openingHourExceptionsService.find({
          query: { date: { $gte: today }, locationId, $limit: 200, $sort: { date: 1 } },
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
    this.preOrderForm.date().value.set(date)
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
      this.preOrderForm.time().value.set(time)
    }
  }

  setDineLocation(dineLocation: PreOrderQuickResult['dineLocation']) {
    this.preOrderForm.dineLocation().value.set(dineLocation)
  }

  // --- Tastatur-Handler ---

  setActiveField(field: 'name' | 'phone') {
    this.activeField.set(field)
  }

  onKeyPress(key: string) {
    const field = this.activeField()
    if (!field) return
    this.preOrderForm[field]().value.update(current => current + key)
  }

  onBackspace() {
    const field = this.activeField()
    if (!field) return
    this.preOrderForm[field]().value.update(current => current.slice(0, -1))
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
    if (this.preOrderForm().valid()) {
      this.#dialogRef.close({ ...this.preOrder() })
    }
  }
}
