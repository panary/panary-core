import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, output, viewChildren, ElementRef } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { AssistantShellComponent } from '../../core/assistant-shell'
import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

interface StepAnswer { value: unknown; display: string }
interface ProductGroup { _id: string; name: string; acronym: string; color: string }
interface ExistingProduct { _id: string; acronym: string; categoryIds: string[] }

@Component({
  selector: 'app-product-wizard',
  standalone: true,
  imports: [FormsModule, AssistantShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-assistant-shell title="Produkt" (closed)="cancelled.emit()">
      <div class="space-y-3">

        <!-- 0: Begruessung -->
        @if (isAnswered('greeting')) {
          <div class="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               role="button" tabindex="0"
               (click)="editStep(0)" (keydown.enter)="editStep(0)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400 flex-1">Begrüßung</span>
          </div>
        } @else if (currentStep() === 0) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out] flex flex-col items-center text-center py-8">
            <h1 class="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Willkommen</h1>
            <p class="text-base text-slate-500 dark:text-gray-400 mt-2">Neues Produkt erstellen</p>
            <p class="text-sm font-light text-slate-400 dark:text-gray-500 mt-4 max-w-sm leading-relaxed">
              Dieser Assistent führt dich durch die Einrichtung. Du wählst den Produkttyp,
              legst einen Namen und Preis fest und ordnest es einer Kategorie zu.
              Jede Angabe lässt sich nachträglich ändern.
            </p>
            <button type="button" (click)="answer('greeting', 0, true, 'Begrüßung')"
              class="mt-8 bg-slate-900 dark:bg-white text-white dark:text-black font-medium
                     px-6 py-2.5 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition">
              Einrichtung starten
            </button>
          </div>
        }

        <!-- 1: Produkttyp -->
        @if (isAnswered('type')) {
          <div class="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               role="button" tabindex="0"
               (click)="editStep(1)" (keydown.enter)="editStep(1)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span [class]="typeBadge(form().productType)"
              class="px-2 py-0.5 rounded-full text-xs font-medium">
              {{ typeLabel(form().productType) }}
            </span>
            <span class="text-sm text-slate-600 dark:text-gray-400 flex-1">{{ answers().get('type')?.display }}</span>
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
              <div class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                <p class="mb-2">Unser System kennt <strong>drei Produkttypen</strong>:</p>
                <ul class="space-y-1.5 text-xs text-slate-500 dark:text-gray-400">
                  <li class="flex items-center gap-1.5"><img src="assets/icons/icon-product.svg" alt="" class="w-4 h-4 inline-block" /><strong class="text-slate-700 dark:text-gray-300">Produkt</strong> — Regulärer Artikel (Pizza, Cola, Salat)</li>
                  <li class="flex items-center gap-1.5"><img src="assets/icons/icon-modifier.svg" alt="" class="w-4 h-4 inline-block" /><strong class="text-slate-700 dark:text-gray-300">Modifier</strong> — Zusatz/Extra (Extra Käse, Soße)</li>
                  <li class="flex items-center gap-1.5"><img src="assets/icons/icon-bundle.svg" alt="" class="w-4 h-4 inline-block" /><strong class="text-slate-700 dark:text-gray-300">Menü</strong> — Bundle aus mehreren Produkten</li>
                </ul>
                <p class="mt-2 font-medium text-slate-900 dark:text-white">Welchen Typ möchtest du anlegen?</p>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-2">
              @for (t of productTypes; track t.value) {
                <button type="button" (click)="selectType(t.value)"
                  class="border border-slate-200 dark:border-gray-700 rounded-xl p-3 text-center
                         hover:border-slate-900 dark:hover:border-white hover:bg-slate-50 dark:hover:bg-gray-800
                         transition-all duration-200">
                  <img [src]="t.icon" [alt]="t.label" class="w-6 h-6 mx-auto mb-1 text-slate-700 dark:text-gray-300" />
                  <span class="text-xs font-medium text-slate-900 dark:text-white">{{ t.label }}</span>
                </button>
              }
            </div>
          </div>
        }

        <!-- 2: Name -->
        @if (isAnswered('name')) {
          <div class="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               role="button" tabindex="0"
               (click)="editStep(2)" (keydown.enter)="editStep(2)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-700 dark:text-gray-300 flex-1 font-medium">{{ form().name }}</span>
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
                <strong>Wie soll dein {{ typeLabel(form().productType) }} heißen?</strong><br />
                Der Name erscheint in der Produktliste und auf Bons.
              </p>
            </div>
            <div class="flex items-center gap-2">
              <input type="text" [(ngModel)]="nameInput" (keydown.enter)="submitName()"
                [placeholder]="'z.B. ' + namePlaceholder()"
                class="flex-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg
                       px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:border-slate-900
                       dark:focus:border-white focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
              <button type="button" (click)="submitName()" [disabled]="!nameInput.trim()" [class]="cls.btnArrow">
                →
              </button>
            </div>
          </div>
        }

        <!-- 3: Preis -->
        @if (isAnswered('price')) {
          <div class="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               role="button" tabindex="0"
               (click)="editStep(3)" (keydown.enter)="editStep(3)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400">Preis:</span>
            <span class="text-sm font-mono font-bold text-slate-900 dark:text-white">{{ form().price.toFixed(2) }} €</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition ml-auto"
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
                <strong>Was kostet dein {{ typeLabel(form().productType) }}?</strong><br />
                Gib den Bruttopreis inkl. MwSt. ein.
              </p>
            </div>
            <div class="flex items-center gap-2">
              <input type="number" [(ngModel)]="priceInput" step="0.01" min="0" placeholder="0.00"
                (keydown.enter)="submitPrice()"
                class="flex-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg
                       px-3 py-2.5 text-lg font-mono text-slate-900 dark:text-white outline-none
                       focus:border-slate-900 dark:focus:border-white" />
              <span class="text-sm font-medium text-slate-500 dark:text-gray-400">€</span>
              <button type="button" (click)="submitPrice()" [class]="cls.btnArrow">→</button>
            </div>
          </div>
        }

        <!-- 4: MwSt. -->
        @if (isAnswered('tax')) {
          <div class="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               role="button" tabindex="0"
               (click)="editStep(4)" (keydown.enter)="editStep(4)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400 flex-1">MwSt.: {{ form().taxInside }}% / {{ form().taxOutside }}%</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        } @else if (currentStep() === 4) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                In Deutschland gelten aktuell <strong>19% MwSt.</strong> (Inhaus) und
                <strong>7%</strong> (Außer Haus).<br />
                <strong>Möchtest du die Standardsätze übernehmen?</strong>
              </p>
            </div>
            <div class="space-y-3">
              <div class="flex gap-2">
                <button type="button" (click)="acceptDefaultTax()" [class]="cls.btnPrimary">
                  Ja, 19% / 7% übernehmen
                </button>
                <button type="button" (click)="showCustomTax.set(!showCustomTax())" [class]="cls.btnSecondary">
                  Eigene Sätze
                </button>
              </div>
              @if (showCustomTax()) {
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label for="productWizardVatIn" class="text-xs text-slate-400 dark:text-gray-500 mb-1 block">Inhaus (%)</label>
                    <input id="productWizardVatIn" type="number" [(ngModel)]="customTaxIn" step="0.1" min="0" [class]="cls.inputSm" />
                  </div>
                  <div>
                    <label for="productWizardVatOut" class="text-xs text-slate-400 dark:text-gray-500 mb-1 block">Außer Haus (%)</label>
                    <input id="productWizardVatOut" type="number" [(ngModel)]="customTaxOut" step="0.1" min="0" [class]="cls.inputSm" />
                  </div>
                </div>
                <button type="button" (click)="submitCustomTax()" [class]="cls.btnPrimary">Übernehmen</button>
              }
            </div>
          </div>
        }

        <!-- 5: Kategorie -->
        @if (isAnswered('category')) {
          <div class="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               role="button" tabindex="0"
               (click)="editStep(5)" (keydown.enter)="editStep(5)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400 flex-1">{{ answers().get('category')?.display }}</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        } @else if (currentStep() === 5) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                <strong>Möchtest du das Produkt einer Produktgruppe zuordnen?</strong><br />
                <span class="text-slate-500 dark:text-gray-400">Du kannst mehrere auswählen oder diesen Schritt überspringen.</span>
              </p>
            </div>
            <div class="space-y-2">
              @if (productGroups().length === 0) {
                <p class="text-xs text-slate-400 dark:text-gray-500">Noch keine Produktgruppen vorhanden.</p>
              } @else {
                <div class="flex flex-wrap gap-2">
                  @for (g of productGroups(); track g._id) {
                    <button type="button" (click)="toggleCategory(g._id)"
                      [class]="selectedCategories().includes(g._id)
                        ? 'border-slate-900 dark:border-white ring-1 ring-slate-900 dark:ring-white bg-slate-50 dark:bg-gray-800'
                        : 'border-slate-200 dark:border-gray-700 hover:border-slate-400 dark:hover:border-gray-600'"
                      class="inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm transition">
                      <span class="w-3 h-3 rounded-full" [style.background-color]="g.color"></span>
                      <span class="text-slate-700 dark:text-gray-300">{{ g.name }}</span>
                    </button>
                  }
                </div>
              }
              <button type="button" (click)="submitCategories()" [class]="cls.btnPrimary + ' mt-2'">
                {{ selectedCategories().length > 0 ? 'Weiter →' : 'Überspringen →' }}
              </button>
            </div>
          </div>
        }

        <!-- 6: Kuerzel (nach Kategorie, basierend auf Produktanzahl in Gruppe) -->
        @if (isAnswered('acronym')) {
          <div class="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-gray-800/50
                      hover:bg-slate-100 dark:hover:bg-gray-800 transition cursor-pointer"
               role="button" tabindex="0"
               (click)="editStep(6)" (keydown.enter)="editStep(6)">
            <svg class="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="text-sm text-slate-600 dark:text-gray-400">Kürzel:</span>
            <span class="text-sm font-mono font-medium text-slate-900 dark:text-white">{{ form().acronym }}</span>
            <svg class="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition ml-auto"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        } @else if (currentStep() === 6) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                {{ acronymExplanation() }}
                Als Kürzel schlage ich <strong class="font-mono">{{ suggestedAcronym() }}</strong> vor.
                <strong>Passt das?</strong>
              </p>
            </div>
            <div class="space-y-3">
              <div class="flex gap-2">
                <button type="button" (click)="acceptAcronym()" [class]="cls.btnPrimary">
                  Ja, übernehmen
                </button>
                <button type="button" (click)="showCustomAcronym.set(true)" [class]="cls.btnSecondary">
                  Eigenes Kürzel
                </button>
              </div>
              @if (showCustomAcronym()) {
                <div class="flex items-center gap-2">
                  <input type="text" [(ngModel)]="customAcronymInput" maxlength="10"
                    (keydown.enter)="submitCustomAcronym()"
                    placeholder="z.B. 1, K32, P12"
                    class="flex-1 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg
                           px-3 py-2.5 text-sm font-mono text-slate-900 dark:text-white outline-none
                           focus:border-slate-900 dark:focus:border-white" />
                  <button type="button" (click)="submitCustomAcronym()" [disabled]="!customAcronymInput.trim()"
                    [class]="cls.btnArrow">→</button>
                </div>
              }
            </div>
          </div>
        }

        <!-- 7: Zusammenfassung -->
        @if (currentStep() === summaryStep()) {
          <div #stepEl class="animate-[fade-in-up_0.3s_ease-out]">
            <div class="mb-4">
              <p class="text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                <strong>Perfekt!</strong> Hier ist die Zusammenfassung:
              </p>
            </div>
            <div class="bg-slate-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
              <p class="text-base font-bold text-slate-900 dark:text-white">{{ form().name }}</p>
              <div class="flex items-center gap-3 text-xs text-slate-500 dark:text-gray-400">
                <span class="font-mono">{{ form().acronym }}</span>
                <span [class]="typeBadge(form().productType)"
                  class="px-2 py-0.5 rounded-full text-xs font-medium">{{ typeLabel(form().productType) }}</span>
              </div>
              <div class="grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-gray-400 pt-1">
                <span>Preis: <strong class="text-slate-900 dark:text-white font-mono">{{ form().price.toFixed(2) }} €</strong></span>
                <span>Inhaus: <strong class="text-slate-900 dark:text-white">{{ form().taxInside }}%</strong></span>
                <span>Außer Haus: <strong class="text-slate-900 dark:text-white">{{ form().taxOutside }}%</strong></span>
              </div>
              @if (selectedGroupNames().length > 0) {
                <div class="flex flex-wrap gap-1.5 pt-1">
                  @for (name of selectedGroupNames(); track name) {
                    <span class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700
                                 rounded px-2 py-0.5 text-xs text-slate-600 dark:text-gray-400">{{ name }}</span>
                  }
                </div>
              }
            </div>

            @if (error()) {
              <div class="mt-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30
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
                Produkt erstellen ✓
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
export class ProductWizardComponent implements OnInit {
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
  priceInput = 0
  showCustomAcronym = signal(false)
  customAcronymInput = ''
  showCustomTax = signal(false)
  customTaxIn = 19
  customTaxOut = 7
  selectedCategories = signal<string[]>([])
  primaryCategoryId = signal<string | null>(null)

  // Referenzdaten
  productGroups = signal<ProductGroup[]>([])
  existingProducts = signal<ExistingProduct[]>([])

  // Formulardaten
  form = signal({
    name: '',
    acronym: '',
    productType: 'PRODUCT' as 'PRODUCT' | 'MODIFIER' | 'BUNDLE',
    price: 0,
    taxInside: 19,
    taxOutside: 7,
    bundlePricingMode: 'ROLLUP' as 'ROLLUP' | 'FIXED_PROPORTIONAL',
    categoryIds: [] as string[],
    status: 'ACTIVE' as const,
  })

  readonly productTypes = [
    { value: 'PRODUCT' as const, label: 'Produkt', icon: 'assets/icons/icon-product.svg' },
    { value: 'MODIFIER' as const, label: 'Modifier', icon: 'assets/icons/icon-modifier.svg' },
    { value: 'BUNDLE' as const, label: 'Menü', icon: 'assets/icons/icon-bundle.svg' },
  ]

  readonly cls = {
    btnPrimary: 'bg-slate-900 dark:bg-white text-white dark:text-black font-medium px-4 py-2 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition',
    btnSecondary: 'border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 font-medium px-4 py-2 rounded-xl text-sm hover:bg-slate-50 dark:hover:bg-gray-800 transition',
    btnArrow: 'bg-slate-900 dark:bg-white text-white dark:text-black font-medium px-3 py-2.5 rounded-lg text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition disabled:opacity-30 disabled:cursor-not-allowed',
    inputSm: 'w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-slate-900 dark:focus:border-white',
  }

  // Neue Reihenfolge: greeting → type → name → price → tax → category → acronym
  private readonly stepKeys = ['greeting', 'type', 'name', 'price', 'tax', 'category', 'acronym']

  summaryStep = computed(() => this.stepKeys.length)

  /** Berechnet das vorgeschlagene Kürzel basierend auf der Anzahl bestehender Produkte in der primären Kategorie */
  suggestedAcronym = computed(() => {
    const catId = this.primaryCategoryId()
    if (!catId) {
      // Keine Kategorie gewählt → Fallback auf Gesamtanzahl + 1
      return String(this.existingProducts().length + 1)
    }
    const productsInGroup = this.existingProducts().filter(p => p.categoryIds?.includes(catId))
    return String(productsInGroup.length + 1)
  })

  /** Erklärt, warum das Kürzel so gewählt wurde */
  acronymExplanation = computed(() => {
    const catId = this.primaryCategoryId()
    if (!catId) {
      const total = this.existingProducts().length
      if (total === 0) return 'Es sind noch keine Produkte vorhanden — dieses wird das erste. '
      return `Es gibt insgesamt ${total} Produkte im System. `
    }
    const group = this.productGroups().find(g => g._id === catId)
    const groupName = group?.name ?? 'dieser Gruppe'
    const count = this.existingProducts().filter(p => p.categoryIds?.includes(catId)).length
    if (count === 0) return `In der Gruppe „${groupName}" gibt es noch keine Produkte — dieses wird das erste. `
    return `In der Gruppe „${groupName}" gibt es bereits ${count} Produkte. `
  })

  selectedGroupNames = computed(() => {
    const ids = this.selectedCategories()
    return this.productGroups().filter(g => ids.includes(g._id)).map(g => g.name)
  })

  async ngOnInit() {
    try {
      const [groups, products] = await Promise.all([
        this.api.find<any>('product-groups', { $limit: 200, $sort: { index: 1 } }),
        this.api.find<any>('products', { $limit: 500 }),
      ])
      this.productGroups.set(groups.data)
      this.existingProducts.set(products.data.map((p: any) => ({
        _id: p._id,
        acronym: p.acronym,
        categoryIds: p.categoryIds || [],
      })))
    } catch { /* Ignorieren */ }
  }

  isAnswered(key: string): boolean {
    return this.answers().has(key)
  }

  answer(key: string, stepIndex: number, value: unknown, display: string) {
    this.answers.update(m => {
      const copy = new Map(m)
      copy.set(key, { value, display })
      return copy
    })
    this.currentStep.set(stepIndex + 1)
    this.scrollToLatest()
  }

  editStep(stepIndex: number) {
    const keysToRemove = this.stepKeys.slice(stepIndex)
    this.answers.update(m => {
      const copy = new Map(m)
      for (const k of keysToRemove) copy.delete(k)
      return copy
    })
    this.currentStep.set(stepIndex)
    if (stepIndex === 2) this.nameInput = this.form().name
    if (stepIndex === 3) this.priceInput = this.form().price
    if (stepIndex === 4) this.showCustomTax.set(false)
    if (stepIndex <= 5) { this.primaryCategoryId.set(null); this.selectedCategories.set([]) }
    if (stepIndex === 6) this.showCustomAcronym.set(false)
  }

  // --- Typ ---
  selectType(type: 'PRODUCT' | 'MODIFIER' | 'BUNDLE') {
    this.form.update(f => ({ ...f, productType: type }))
    this.answer('type', 1, type, this.typeLabel(type))
  }

  // --- Name ---
  submitName() {
    const name = this.nameInput.trim()
    if (!name) return
    this.form.update(f => ({ ...f, name }))
    this.answer('name', 2, name, name)
  }

  // --- Preis ---
  submitPrice() {
    this.form.update(f => ({ ...f, price: this.priceInput }))
    this.answer('price', 3, this.priceInput, `${this.priceInput.toFixed(2)} €`)
  }

  // --- MwSt. ---
  acceptDefaultTax() {
    this.form.update(f => ({ ...f, taxInside: 19, taxOutside: 7 }))
    this.answer('tax', 4, { inside: 19, outside: 7 }, '19% / 7%')
  }

  submitCustomTax() {
    this.form.update(f => ({ ...f, taxInside: this.customTaxIn, taxOutside: this.customTaxOut }))
    this.answer('tax', 4, { inside: this.customTaxIn, outside: this.customTaxOut },
      `${this.customTaxIn}% / ${this.customTaxOut}%`)
  }

  // --- Kategorie ---
  toggleCategory(id: string) {
    const current = this.selectedCategories()
    if (current.includes(id)) {
      this.selectedCategories.set(current.filter(i => i !== id))
      // Primäre Kategorie anpassen
      if (this.primaryCategoryId() === id) {
        const remaining = current.filter(i => i !== id)
        this.primaryCategoryId.set(remaining.length > 0 ? remaining[0] : null)
      }
    } else {
      this.selectedCategories.set([...current, id])
      // Erste angeklickte Kategorie merken
      if (!this.primaryCategoryId()) {
        this.primaryCategoryId.set(id)
      }
    }
  }

  submitCategories() {
    const ids = this.selectedCategories()
    this.form.update(f => ({ ...f, categoryIds: ids }))
    const names = this.selectedGroupNames()
    const display = names.length > 0 ? `Kategorien: ${names.join(', ')}` : 'Keine Kategorie'
    this.answer('category', 5, ids, display)
  }

  // --- Kuerzel ---
  acceptAcronym() {
    const acr = this.suggestedAcronym()
    this.form.update(f => ({ ...f, acronym: acr }))
    this.answer('acronym', 6, acr, acr)
  }

  submitCustomAcronym() {
    const acr = this.customAcronymInput.trim()
    if (!acr) return
    this.form.update(f => ({ ...f, acronym: acr }))
    this.answer('acronym', 6, acr, acr)
  }

  // --- Save ---
  async onSave() {
    this.saving.set(true)
    this.error.set(null)
    try {
      const f = this.form()
      const payload: Record<string, unknown> = {
        name: f.name.trim(),
        acronym: f.acronym.trim(),
        productType: f.productType,
        price: f.price,
        taxInside: f.taxInside,
        taxOutside: f.taxOutside,
        status: f.status,
        categoryIds: f.categoryIds,
      }
      if (f.productType === 'BUNDLE') {
        payload['bundlePricingMode'] = f.bundlePricingMode
      }
      await this.api.create('products', payload)
      this.saved.emit()
    } catch (err: unknown) {
      this.error.set(formatApiError(err))
    } finally {
      this.saving.set(false)
    }
  }

  // --- Helpers ---
  typeLabel(type: string): string {
    return this.productTypes.find(t => t.value === type)?.label ?? type
  }

  typeBadge(type: string): string {
    switch (type) {
      case 'PRODUCT': return 'bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400'
      case 'MODIFIER': return 'bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400'
      case 'BUNDLE': return 'bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400'
      default: return 'bg-slate-500/10 border border-slate-500/20 text-slate-600 dark:text-slate-400'
    }
  }

  namePlaceholder(): string {
    switch (this.form().productType) {
      case 'PRODUCT': return 'Pizza Margherita, Cola 0,33l'
      case 'MODIFIER': return 'Extra Käse, Scharfe Soße'
      case 'BUNDLE': return 'Mittagsmenü, Family Box'
      default: return 'Produktname'
    }
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
