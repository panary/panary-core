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
    <div class="bg-surface-input border border-line-soft rounded-xl p-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-ink">MQTT-Broker</h2>
        <button
          (click)="testConnection()"
          [disabled]="testing()"
          class="px-4 py-2 rounded-lg text-sm font-medium transition
                 border border-line
                 text-ink-muted
                 hover:bg-surface-elevated
                 disabled:opacity-50"
        >
          @if (testing()) {
            <span class="flex items-center gap-2">
              <span class="w-3 h-3 border-2 border-ink-faint border-t-transparent rounded-full animate-spin"></span>
              Verbinde...
            </span>
          } @else {
            Verbindung testen
          }
        </button>
      </div>

      @if (testResult()) {
        <div
          class="mb-4 px-4 py-3 rounded-lg text-sm"
          [class]="
            testResult() === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
          "
        >
          {{ testResult() === 'success' ? 'Verbindung zum Broker erfolgreich!' : testError() }}
        </div>
      }

      <!--
        Nur die Felder sperren, nicht den Verbindungstest darueber: der ist ein
        reiner Client-Probe gegen den Broker und beruehrt locations nicht.
        min-w-0 und m-0 neutralisieren die UA-Defaults des Fieldsets.
      -->
      <fieldset
        [disabled]="readOnly()"
        class="min-w-0 m-0 p-0 border-0 grid grid-cols-3 gap-4"
        [class.opacity-60]="readOnly()"
      >
        <!-- Protokoll -->
        <div class="space-y-1">
          <label for="mqttProtocol" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
            >Protokoll</label
          >
          <select
            id="mqttProtocol"
            [ngModel]="settings().mqttServerProtocol"
            (ngModelChange)="onFieldChange('mqttServerProtocol', $event)"
            name="mqttServerProtocol"
            class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                   text-ink outline-none"
          >
            <option value="ws">ws (WebSocket)</option>
            <option value="wss">wss (WebSocket Secure)</option>
          </select>
        </div>

        <!-- URL -->
        <div class="space-y-1">
          <label for="mqttServerUrl" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
            >Server-URL</label
          >
          <input
            id="mqttServerUrl"
            [ngModel]="settings().mqttServerUrl"
            (ngModelChange)="onFieldChange('mqttServerUrl', $event)"
            name="mqttServerUrl"
            type="text"
            placeholder="localhost"
            class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                   text-ink focus:border-ink
                   focus:ring-1 focus:ring-ink outline-none"
          />
        </div>

        <!-- Port -->
        <div class="space-y-1">
          <label for="mqttPort" class="text-xs font-medium text-ink-muted uppercase tracking-wider">Port</label>
          <input
            id="mqttPort"
            [ngModel]="settings().mqttServerPort"
            (ngModelChange)="onFieldChange('mqttServerPort', $event)"
            name="mqttServerPort"
            type="number"
            min="1"
            max="65535"
            placeholder="9001"
            class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                   text-ink focus:border-ink
                   focus:ring-1 focus:ring-ink outline-none"
          />
        </div>
      </fieldset>
    </div>
  `,
})
export class MqttSettingsFormComponent {
  settings = input.required<MqttSettingsData>()
  /** Cloud verwaltet die Drucker-Settings (kein Notfall-Modus aktiv). */
  readOnly = input(false)
  settingsChanged = output<Partial<MqttSettingsData>>()

  testing = signal(false)
  testResult = signal<'success' | 'error' | null>(null)
  testError = signal('')

  onFieldChange(field: string, value: unknown) {
    if (this.readOnly()) return
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
