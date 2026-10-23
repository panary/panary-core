import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import { FormsModule } from '@angular/forms'

export interface PrintSettingsData {
  printServerEnabled?: boolean
  maxNameCharacters: number
  separationCharacter: string
  separationCharacterCount: number
  showDialogAfterOrder: boolean
  backofficePrinter?: string
}

@Component({
  selector: 'app-print-settings-form',
  standalone: true,
  imports: [FormsModule],
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
            [ngModel]="settings().printServerEnabled ?? true"
            (ngModelChange)="onFieldChange('printServerEnabled', $event)"
            name="printServerEnabled"
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
              [ngModel]="settings().maxNameCharacters"
              (ngModelChange)="onFieldChange('maxNameCharacters', $event)"
              name="maxNameCharacters"
              type="number"
              min="10"
              max="80"
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
              [ngModel]="settings().separationCharacter"
              (ngModelChange)="onFieldChange('separationCharacter', $event)"
              name="separationCharacter"
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
              [ngModel]="settings().separationCharacterCount"
              (ngModelChange)="onFieldChange('separationCharacterCount', $event)"
              name="separationCharacterCount"
              type="number"
              min="10"
              max="80"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none"
            />
          </div>
        </div>

        <!-- Druckdialog nach Bestellung -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            [ngModel]="settings().showDialogAfterOrder"
            (ngModelChange)="onFieldChange('showDialogAfterOrder', $event)"
            name="showDialogAfterOrder"
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
  settings = input.required<PrintSettingsData>()
  /** Cloud verwaltet die Drucker-Settings (kein Notfall-Modus aktiv). */
  readOnly = input(false)
  settingsChanged = output<Partial<PrintSettingsData>>()

  onFieldChange(field: string, value: unknown) {
    if (this.readOnly()) return
    this.settingsChanged.emit({ [field]: value })
  }
}
