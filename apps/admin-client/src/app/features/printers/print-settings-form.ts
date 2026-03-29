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
    <div class="bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl p-6">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-6">Druckeinstellungen</h2>

      <div class="space-y-4">
        <!-- Print-Server aktivieren -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input [ngModel]="settings().printServerEnabled ?? true" (ngModelChange)="onFieldChange('printServerEnabled', $event)"
            name="printServerEnabled" type="checkbox"
            class="w-4 h-4 rounded border-slate-300 dark:border-gray-600
                   text-slate-900 dark:text-white focus:ring-slate-900 dark:focus:ring-white" />
          <span class="text-sm text-slate-700 dark:text-gray-300">Print-Server beim Start automatisch aktivieren</span>
        </label>

        <div class="grid grid-cols-3 gap-4">
          <!-- Max Zeichen Artikelname -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              Max. Zeichen Artikelname
            </label>
            <input [ngModel]="settings().maxNameCharacters" (ngModelChange)="onFieldChange('maxNameCharacters', $event)"
              name="maxNameCharacters" type="number" min="10" max="80"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>

          <!-- Trennzeichen -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              Trennzeichen
            </label>
            <select [ngModel]="settings().separationCharacter" (ngModelChange)="onFieldChange('separationCharacter', $event)"
              name="separationCharacter"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white outline-none">
              <option value="_">_ (Unterstrich)</option>
              <option value="-">- (Bindestrich)</option>
              <option value=".">. (Punkt)</option>
              <option value="*">* (Stern)</option>
              <option value="=">=  (Gleichzeichen)</option>
            </select>
          </div>

          <!-- Trennzeichen-Anzahl -->
          <div class="space-y-1">
            <label class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              Trennlinien-Länge
            </label>
            <input [ngModel]="settings().separationCharacterCount" (ngModelChange)="onFieldChange('separationCharacterCount', $event)"
              name="separationCharacterCount" type="number" min="10" max="80"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>
        </div>

        <!-- Druckdialog nach Bestellung -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input [ngModel]="settings().showDialogAfterOrder" (ngModelChange)="onFieldChange('showDialogAfterOrder', $event)"
            name="showDialogAfterOrder" type="checkbox"
            class="w-4 h-4 rounded border-slate-300 dark:border-gray-600
                   text-slate-900 dark:text-white focus:ring-slate-900 dark:focus:ring-white" />
          <span class="text-sm text-slate-700 dark:text-gray-300">Druckdialog nach Bestellung anzeigen</span>
        </label>
      </div>
    </div>
  `,
})
export class PrintSettingsFormComponent {
  settings = input.required<PrintSettingsData>()
  settingsChanged = output<Partial<PrintSettingsData>>()

  onFieldChange(field: string, value: unknown) {
    this.settingsChanged.emit({ [field]: value })
  }
}
