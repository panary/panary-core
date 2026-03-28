import { ChangeDetectionStrategy, Component, inject, signal, OnInit, output, ElementRef, viewChildren } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { AssistantShellComponent } from '../../core/assistant-shell'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

interface StepAnswer {
  value: unknown
  display: string
}

@Component({
  selector: 'app-group-wizard',
  standalone: true,
  imports: [FormsModule, AssistantShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-assistant-shell title="Produktgruppe" (cancel)="cancelled.emit()">
      <div class="space-y-3">

        <!-- Schritt 0: Begruessung -->
        @if (answers().has('greeting')) {
          <div class="answered-step group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               (click)="editStep(0)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400 flex-1">Begrüßung</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        } @else if (currentStep() === 0) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out] flex flex-col items-center text-center py-8">
            <h1 class="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Willkommen</h1>
            <p class="text-base text-slate-500 dark:text-gray-400 mt-2">Neue Produktgruppe erstellen</p>
            <p class="text-sm font-light text-slate-400 dark:text-gray-500 mt-4 max-w-sm leading-relaxed">
              Dieser Assistent führt dich durch die Einrichtung. Produktgruppen organisieren deine
              Produkte — z.B. Pizza, Getränke oder Desserts. Du kannst jede Angabe nachträglich ändern.
            </p>
            <button type="button" (click)="answerStep(0, true, 'Begrüßung')"
              class="mt-8 bg-slate-900 dark:bg-white text-white dark:text-black font-medium
                     px-6 py-2.5 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition">
              Einrichtung starten
            </button>
          </div>
        }

        <!-- Schritt 1: Name -->
        @if (answers().has('name')) {
          <div class="answered-step group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               (click)="editStep(1)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="w-3.5 h-3.5 rounded-full shrink-0" [style.background-color]="formData().color"></span>
            <span class="text-sm text-slate-700 dark:text-gray-300 flex-1 font-medium">{{ answers().get('name')?.display }}</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        } @else if (currentStep() === 1) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                <strong>Wie soll die Produktgruppe heißen?</strong><br />
                Der Name wird in der Produktliste und am POS angezeigt.
              </p>
            </div>
            <div class=" flex items-center gap-2">
              @if (formData().color) {
                <span class="w-5 h-5 rounded-full shrink-0 transition-colors duration-300"
                      [style.background-color]="formData().color"></span>
              }
              <input type="text" [(ngModel)]="nameInput" (ngModelChange)="onNameInput($event)"
                placeholder="z.B. Pizza, Getränke, Desserts..."
                class="flex-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg
                       px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:border-slate-900
                       dark:focus:border-white focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
              <button type="button" (click)="submitName()" [disabled]="!nameInput.trim()"
                class="bg-slate-900 dark:bg-white text-white dark:text-black font-medium px-3 py-2.5
                       rounded-lg text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition
                       disabled:opacity-30 disabled:cursor-not-allowed">
                →
              </button>
            </div>
          </div>
        }

        <!-- Schritt 2: Farbe bestaetigen -->
        @if (answers().has('color')) {
          <div class="answered-step group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               (click)="editStep(2)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400 flex-1">Farbe: </span>
            <span class="w-4 h-4 rounded-full" [style.background-color]="formData().color"></span>
            <span class="text-xs font-mono text-slate-400 dark:text-gray-500">{{ formData().color }}</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        } @else if (currentStep() === 2) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                Ich habe die Farbe
                <span class="inline-block w-4 h-4 rounded-full align-middle mx-1"
                      [style.background-color]="formData().color"></span>
                für <strong>{{ formData().name }}</strong> ausgewählt.
                <strong>Passt das?</strong>
              </p>
            </div>
            <div class=" space-y-3">
              <div class="flex gap-2">
                <button type="button" (click)="answerStep(2, formData().color, 'Farbe übernommen'); showColorPicker.set(false)"
                  class="bg-slate-900 dark:bg-white text-white dark:text-black font-medium
                         px-4 py-2 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition">
                  Ja, passt 👍
                </button>
                <button type="button" (click)="showColorPicker.set(!showColorPicker())"
                  class="border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300
                         font-medium px-4 py-2 rounded-xl text-sm hover:bg-slate-50 dark:hover:bg-gray-800 transition">
                  Andere Farbe wählen
                </button>
              </div>
              @if (showColorPicker()) {
                <div class="flex flex-wrap gap-2 p-3 bg-slate-50 dark:bg-gray-800/50 rounded-xl">
                  @for (c of colorPalette; track c) {
                    <button type="button" (click)="pickColor(c)"
                      [class]="formData().color === c
                        ? 'w-7 h-7 rounded-full ring-2 ring-slate-900 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-gray-900 scale-110'
                        : isColorUsed(c)
                          ? 'w-7 h-7 rounded-full opacity-40 hover:opacity-70'
                          : 'w-7 h-7 rounded-full hover:scale-110'"
                      [style.background-color]="c"
                      class="transition-all duration-150">
                    </button>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- Schritt 3: MwSt. -->
        @if (answers().has('tax')) {
          <div class="answered-step group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               (click)="editStep(3)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400 flex-1">MwSt.: {{ formData().taxInside }}% / {{ formData().taxOutside }}%</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        } @else if (currentStep() === 3) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                In Deutschland gelten aktuell <strong>19% MwSt.</strong> für den Verzehr im Restaurant
                und <strong>7%</strong> für Mitnahme/Lieferung.<br />
                <strong>Möchtest du die Standardsätze übernehmen?</strong>
              </p>
            </div>
            <div class=" space-y-3">
              <div class="flex gap-2">
                <button type="button" (click)="acceptDefaultTax()"
                  class="bg-slate-900 dark:bg-white text-white dark:text-black font-medium
                         px-4 py-2 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition">
                  Ja, 19% / 7% übernehmen
                </button>
                <button type="button" (click)="showCustomTax.set(!showCustomTax())"
                  class="border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300
                         font-medium px-4 py-2 rounded-xl text-sm hover:bg-slate-50 dark:hover:bg-gray-800 transition">
                  Eigene Sätze
                </button>
              </div>
              @if (showCustomTax()) {
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="text-xs text-slate-400 dark:text-gray-500 mb-1 block">Inhaus (%)</label>
                    <input type="number" [(ngModel)]="customTaxInside" step="0.1" min="0"
                      class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                             rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none
                             focus:border-slate-900 dark:focus:border-white" />
                  </div>
                  <div>
                    <label class="text-xs text-slate-400 dark:text-gray-500 mb-1 block">Außer Haus (%)</label>
                    <input type="number" [(ngModel)]="customTaxOutside" step="0.1" min="0"
                      class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800
                             rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none
                             focus:border-slate-900 dark:focus:border-white" />
                  </div>
                </div>
                <button type="button" (click)="submitCustomTax()"
                  class="bg-slate-900 dark:bg-white text-white dark:text-black font-medium
                         px-4 py-2 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition">
                  Übernehmen
                </button>
              }
            </div>
          </div>
        }

        <!-- Schritt 4: Zusammenfassung -->
        @if (currentStep() === 4) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                <strong>Alles klar!</strong> Hier ist die Zusammenfassung deiner neuen Produktgruppe:
              </p>
            </div>
            <div class=" bg-slate-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-3">
              <div class="flex items-center gap-3">
                <span class="w-6 h-6 rounded-full" [style.background-color]="formData().color"></span>
                <div>
                  <p class="text-base font-bold text-slate-900 dark:text-white">{{ formData().name }}</p>
                  @if (formData().acronym) {
                    <p class="text-xs font-mono text-slate-500 dark:text-gray-400">{{ formData().acronym }}</p>
                  }
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-gray-400">
                <span>MwSt. Inhaus: <strong class="text-slate-900 dark:text-white">{{ formData().taxInside }}%</strong></span>
                <span>MwSt. Außer Haus: <strong class="text-slate-900 dark:text-white">{{ formData().taxOutside }}%</strong></span>
              </div>
            </div>

            @if (error()) {
              <div class=" mt-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30
                          rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
                {{ error() }}
              </div>
            }

            <button type="button" (click)="onSave()" [disabled]="saving()"
              class="mt-4 bg-slate-900 dark:bg-white text-white dark:text-black font-bold
                     px-6 py-3 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200
                     transition disabled:opacity-50 min-w-[180px] flex items-center justify-center gap-2">
              @if (saving()) {
                <span class="w-4 h-4 border-2 border-white/30 dark:border-black/30
                             border-t-white dark:border-t-black rounded-full animate-spin"></span>
                Erstelle...
              } @else {
                Produktgruppe erstellen ✓
              }
            </button>
          </div>
        }

      </div>
    </app-assistant-shell>
  `,
  styles: `
    @keyframes fade-in-up {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `,
})
export class GroupWizardComponent implements OnInit {
  private api = inject(ApiService)

  saved = output<void>()
  cancelled = output<void>()

  stepElements = viewChildren<ElementRef>('stepEl')

  currentStep = signal(0)
  saving = signal(false)
  error = signal<string | null>(null)
  answers = signal<Map<string, StepAnswer>>(new Map())

  // Eingabe-State
  nameInput = ''
  showColorPicker = signal(false)
  showCustomTax = signal(false)
  customTaxInside = 19
  customTaxOutside = 7

  // Formulardaten
  formData = signal({
    name: '',
    acronym: '',
    color: '#6366f1',
    index: 0,
    taxInside: 19,
    taxOutside: 7,
    excluded: false,
    status: 'ACTIVE' as const,
  })

  usedColors = signal<Set<string>>(new Set())

  readonly colorPalette = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
    '#f43f5e', '#78716c', '#64748b', '#dc2626',
    '#b91c1c', '#059669', '#0284c7', '#7c3aed',
  ]

  private readonly stepKeys = ['greeting', 'name', 'color', 'tax']

  async ngOnInit() {
    await this.loadUsedColors()
    const firstFree = this.colorPalette.find(c => !this.usedColors().has(c.toLowerCase()))
    if (firstFree) this.formData.update(f => ({ ...f, color: firstFree }))
  }

  answerStep(stepIndex: number, value: unknown, display: string) {
    const key = this.stepKeys[stepIndex]
    this.answers.update(m => {
      const copy = new Map(m)
      copy.set(key, { value, display })
      return copy
    })
    this.currentStep.set(stepIndex + 1)
    this.scrollToLatest()
  }

  editStep(stepIndex: number) {
    // Alle Antworten ab diesem Schritt loeschen
    const keysToRemove = this.stepKeys.slice(stepIndex)
    this.answers.update(m => {
      const copy = new Map(m)
      for (const k of keysToRemove) copy.delete(k)
      return copy
    })
    this.currentStep.set(stepIndex)
    // Eingabe-State wiederherstellen
    if (stepIndex === 1) this.nameInput = this.formData().name
    if (stepIndex === 2) this.showColorPicker.set(false)
    if (stepIndex === 3) this.showCustomTax.set(false)
  }

  // --- Name ---
  onNameInput(name: string) {
    this.formData.update(f => ({
      ...f,
      name,
      acronym: name.trim().substring(0, 3).toUpperCase(),
    }))
    this.autoAssignColor(name)
  }

  submitName() {
    const name = this.nameInput.trim()
    if (!name) return
    this.formData.update(f => ({ ...f, name, acronym: name.substring(0, 3).toUpperCase() }))
    this.answerStep(1, name, name)
  }

  // --- Farbe ---
  pickColor(color: string) {
    this.formData.update(f => ({ ...f, color }))
    this.answerStep(2, color, color)
    this.showColorPicker.set(false)
  }

  isColorUsed(color: string): boolean {
    if (!color) return false
    return this.usedColors().has(color.toLowerCase()) && this.formData().color?.toLowerCase() !== color.toLowerCase()
  }

  // --- MwSt. ---
  acceptDefaultTax() {
    this.formData.update(f => ({ ...f, taxInside: 19, taxOutside: 7 }))
    this.answerStep(3, { inside: 19, outside: 7 }, '19% / 7%')
  }

  submitCustomTax() {
    this.formData.update(f => ({ ...f, taxInside: this.customTaxInside, taxOutside: this.customTaxOutside }))
    this.answerStep(3, { inside: this.customTaxInside, outside: this.customTaxOutside },
      `${this.customTaxInside}% / ${this.customTaxOutside}%`)
  }

  // --- Save ---
  async onSave() {
    this.saving.set(true)
    this.error.set(null)
    try {
      const f = this.formData()
      await this.api.create('product-groups', {
        name: f.name.trim(),
        acronym: f.acronym.trim(),
        color: f.color,
        index: f.index,
        taxInside: f.taxInside,
        taxOutside: f.taxOutside,
        excluded: f.excluded,
        status: f.status,
      })
      this.saved.emit()
    } catch (err: unknown) {
      this.error.set(formatApiError(err))
    } finally {
      this.saving.set(false)
    }
  }

  // --- Hilfsfunktionen ---
  private autoAssignColor(name: string): void {
    if (!name) return
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
    }
    const startIdx = Math.abs(hash) % this.colorPalette.length
    for (let offset = 0; offset < this.colorPalette.length; offset++) {
      const candidate = this.colorPalette[(startIdx + offset) % this.colorPalette.length]
      if (!this.isColorUsed(candidate)) {
        this.formData.update(f => ({ ...f, color: candidate }))
        return
      }
    }
    this.formData.update(f => ({ ...f, color: this.colorPalette[startIdx] }))
  }

  private async loadUsedColors() {
    try {
      const result = await this.api.find<any>('product-groups', { $limit: 100 })
      const colors = new Set(result.data.map((g: any) => g.color?.toLowerCase()).filter(Boolean))
      this.usedColors.set(colors)
    } catch { /* Ignorieren */ }
  }

  private scrollToLatest() {
    setTimeout(() => {
      const els = this.stepElements()
      if (els.length > 0) {
        els[els.length - 1].nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 50)
  }
}
