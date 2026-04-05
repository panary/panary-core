import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import mqtt from 'mqtt'

export interface MqttSettingsData {
  mqttServerProtocol: string
  mqttServerUrl: string
  mqttServerPort: number
}

@Component({
  selector: 'app-mqtt-settings-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl p-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-white">MQTT-Broker</h2>
        <button (click)="testConnection()" [disabled]="testing()"
          class="px-4 py-2 rounded-lg text-sm font-medium transition
                 border border-slate-200 dark:border-gray-700
                 text-slate-600 dark:text-gray-400
                 hover:bg-slate-50 dark:hover:bg-gray-800
                 disabled:opacity-50">
          @if (testing()) {
            <span class="flex items-center gap-2">
              <span class="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>
              Verbinde...
            </span>
          } @else {
            Verbindung testen
          }
        </button>
      </div>

      @if (testResult()) {
        <div class="mb-4 px-4 py-3 rounded-lg text-sm"
          [class]="testResult() === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
            : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'">
          {{ testResult() === 'success' ? 'Verbindung zum Broker erfolgreich!' : testError() }}
        </div>
      }

      <div class="grid grid-cols-3 gap-4">
        <!-- Protokoll -->
        <div class="space-y-1">
          <label for="mqttProtocol" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Protokoll</label>
          <select id="mqttProtocol" [ngModel]="settings().mqttServerProtocol" (ngModelChange)="onFieldChange('mqttServerProtocol', $event)"
            name="mqttServerProtocol"
            class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                   text-slate-900 dark:text-white outline-none">
            <option value="ws">ws (WebSocket)</option>
            <option value="wss">wss (WebSocket Secure)</option>
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
    </div>
  `,
})
export class MqttSettingsFormComponent {
  settings = input.required<MqttSettingsData>()
  settingsChanged = output<Partial<MqttSettingsData>>()

  testing = signal(false)
  testResult = signal<'success' | 'error' | null>(null)
  testError = signal('')

  onFieldChange(field: string, value: unknown) {
    this.settingsChanged.emit({ [field]: value })
  }

  testConnection() {
    const s = this.settings()
    if (!s.mqttServerUrl || !s.mqttServerPort) {
      this.testResult.set('error')
      this.testError.set('Server-URL und Port muessen ausgefuellt sein.')
      return
    }

    this.testing.set(true)
    this.testResult.set(null)

    const url = `${s.mqttServerProtocol}://${s.mqttServerUrl}:${s.mqttServerPort}/mqtt`
    const client = mqtt.connect(url, {
      clean: true,
      connectTimeout: 5000,
      clientId: `panary-admin-${Date.now()}`,
    })

    const timeout = setTimeout(() => {
      client.end(true)
      this.testing.set(false)
      this.testResult.set('error')
      this.testError.set('Verbindung zum Broker fehlgeschlagen (Timeout).')
    }, 5000)

    client.on('connect', () => {
      clearTimeout(timeout)
      client.end()
      this.testing.set(false)
      this.testResult.set('success')
    })

    client.on('error', (err: Error) => {
      clearTimeout(timeout)
      client.end(true)
      this.testing.set(false)
      this.testResult.set('error')
      this.testError.set(`Verbindung fehlgeschlagen: ${err.message}`)
    })
  }
}
