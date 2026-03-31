import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import { FormsModule } from '@angular/forms'

export interface MqttSettingsData {
  mqttServerProtocol: string
  mqttServerUrl: string
  mqttServerPort: number
  mqttAutoConnect?: boolean
}

@Component({
  selector: 'app-mqtt-settings-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl p-6">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-6">MQTT-Broker</h2>

      <div class="space-y-4">
        <div class="grid grid-cols-3 gap-4">
          <!-- Protokoll -->
          <div class="space-y-1">
            <label for="mqttProtocol" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Protokoll</label>
            <select id="mqttProtocol" [ngModel]="settings().mqttServerProtocol" (ngModelChange)="onFieldChange('mqttServerProtocol', $event)"
              name="mqttServerProtocol"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white outline-none">
              <option value="mqtt">mqtt</option>
              <option value="mqtts">mqtts</option>
              <option value="ws">ws</option>
            </select>
          </div>

          <!-- URL -->
          <div class="space-y-1">
            <label for="mqttServerUrl" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Server-URL</label>
            <input id="mqttServerUrl" [ngModel]="settings().mqttServerUrl" (ngModelChange)="onFieldChange('mqttServerUrl', $event)"
              name="mqttServerUrl" type="text" placeholder="localhost"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>

          <!-- Port -->
          <div class="space-y-1">
            <label for="mqttPort" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Port</label>
            <input id="mqttPort" [ngModel]="settings().mqttServerPort" (ngModelChange)="onFieldChange('mqttServerPort', $event)"
              name="mqttServerPort" type="number" min="1" max="65535" placeholder="1883"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>
        </div>

        <!-- Auto-Connect -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input [ngModel]="settings().mqttAutoConnect ?? false" (ngModelChange)="onFieldChange('mqttAutoConnect', $event)"
            name="mqttAutoConnect" type="checkbox"
            class="w-4 h-4 rounded border-slate-300 dark:border-gray-600
                   text-slate-900 dark:text-white focus:ring-slate-900 dark:focus:ring-white" />
          <span class="text-sm text-slate-700 dark:text-gray-300">Automatisch verbinden</span>
        </label>
      </div>
    </div>
  `,
})
export class MqttSettingsFormComponent {
  settings = input.required<MqttSettingsData>()
  settingsChanged = output<Partial<MqttSettingsData>>()

  onFieldChange(field: string, value: unknown) {
    this.settingsChanged.emit({ [field]: value })
  }
}
