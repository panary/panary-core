import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { FormField, type FieldTree } from '@angular/forms/signals'

export interface PrintSettingsData {
  printServerEnabled: boolean
  maxNameCharacters: number | null
  separationCharacter: string
  separationCharacterCount: number | null
  showDialogAfterOrder: boolean
  backofficePrinter?: string
}

@Component({
  selector: 'app-print-settings-form',
  standalone: true,
  imports: [FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-surface-input border border-line-soft rounded-xl p-6">
      <h2 class="text-lg font-semibold text-ink mb-6">Druckeinstellungen</h2>

      <!--
        fieldset[disabled] sperrt alle Controls nativ und nimmt sie aus der
        Tab-Reihenfolge. min-w-0, m-0, p-0 und border-0 neutralisieren die
        UA-Defaults, damit das Layout unveraendert bleibt.
      -->
      <fieldset [disabled]="readOnly()" class="min-w-0 m-0 p-0 border-0 space-y-4" [class.opacity-60]="readOnly()">
        <!-- Print-Server aktivieren -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            [formField]="settingsForm().printServerEnabled"
            type="checkbox"
            class="w-4 h-4 rounded border-line-strong
                   text-ink focus:ring-ink"
          />
          <span class="text-sm text-ink">Print-Server beim Start automatisch aktivieren</span>
        </label>

        <div class="grid grid-cols-3 gap-4">
          <!-- Max Zeichen Artikelname -->
          <div class="space-y-1">
            <label for="maxNameCharacters" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
              Max. Zeichen Artikelname
            </label>
            <input
              id="maxNameCharacters"
              [formField]="settingsForm().maxNameCharacters"
              type="number"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none"
            />
          </div>

          <!-- Trennzeichen -->
          <div class="space-y-1">
            <label for="separationCharacter" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
              Trennzeichen
            </label>
            <select
              id="separationCharacter"
              [formField]="settingsForm().separationCharacter"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink outline-none"
            >
              <option value="_">_ (Unterstrich)</option>
              <option value="-">- (Bindestrich)</option>
              <option value=".">. (Punkt)</option>
              <option value="*">* (Stern)</option>
              <option value="=">= (Gleichzeichen)</option>
            </select>
          </div>

          <!-- Trennzeichen-Anzahl -->
          <div class="space-y-1">
            <label for="separationCharacterCount" class="text-xs font-medium text-ink-muted uppercase tracking-wider">
              Trennlinien-Länge
            </label>
            <input
              id="separationCharacterCount"
              [formField]="settingsForm().separationCharacterCount"
              type="number"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none"
            />
          </div>
        </div>

        <!-- Druckdialog nach Bestellung -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            [formField]="settingsForm().showDialogAfterOrder"
            type="checkbox"
            class="w-4 h-4 rounded border-line-strong
                   text-ink focus:ring-ink"
          />
          <span class="text-sm text-ink">Druckdialog nach Bestellung anzeigen</span>
        </label>
      </fieldset>
    </div>
  `,
})
export class PrintSettingsFormComponent {
  /** Modell und Schema besitzt die Druckerverwaltung; hier wird nur gebunden. */
  settingsForm = input.required<FieldTree<PrintSettingsData>>()
  /** Cloud verwaltet die Drucker-Settings (kein Notfall-Modus aktiv). */
  readOnly = input(false)
}
