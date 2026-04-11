import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { uuidv7 } from 'uuidv7'

export interface PrinterFormData {
  pid: string
  active: boolean
  type: 'ip' | 'mqtt'
  name: string
  ip?: string
  port?: number
  paperWidth?: '58mm' | '80mm'
  encoding?: string
  primaryTopics?: string[]
  mqttTopic?: string
}

@Component({
  selector: 'app-printer-form-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 min-w-[400px]">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-6">
        {{ isEdit ? 'Drucker bearbeiten' : 'Drucker hinzufügen' }}
      </h2>

      <form (ngSubmit)="onSave()" class="space-y-4">
        <!-- Name -->
        <div class="space-y-1">
          <label for="printerName" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Name *</label>
          <input id="printerName" [(ngModel)]="form.name" name="name" type="text" required
            class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                   text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                   focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
        </div>

        <!-- Typ -->
        <div class="space-y-1">
          <label for="printerType" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Typ</label>
          <select id="printerType" [(ngModel)]="form.type" name="type"
            class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                   text-slate-900 dark:text-white outline-none">
            <option value="ip">WLAN / Netzwerk (IP)</option>
            <option value="mqtt">MQTT</option>
          </select>
        </div>

        <!-- IP-Drucker Felder -->
        @if (form.type === 'ip') {
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label for="printerIp" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">IP-Adresse *</label>
              <input id="printerIp" [(ngModel)]="form.ip" name="ip" type="text" required placeholder="192.168.1.100"
                pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                       focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
            </div>
            <div class="space-y-1">
              <label for="printerPort" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Port</label>
              <input id="printerPort" [(ngModel)]="form.port" name="port" type="number" min="1" max="65535"
                class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                       text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                       focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
            </div>
          </div>
        }

        <!-- MQTT-Drucker Felder -->
        @if (form.type === 'mqtt') {
          <div class="space-y-1">
            <label for="printerMqttTopic" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">MQTT-Topic</label>
            <input id="printerMqttTopic" [(ngModel)]="form.mqttTopic" name="mqttTopic" type="text" placeholder="/rospos/orders/print"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>
        }

        <!-- Papierbreite & Encoding -->
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label for="printerPaperWidth" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Papierbreite</label>
            <select id="printerPaperWidth" [(ngModel)]="form.paperWidth" name="paperWidth"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white outline-none">
              <option value="80mm">80mm (Standard)</option>
              <option value="58mm">58mm</option>
            </select>
          </div>
          <div class="space-y-1">
            <label for="printerEncoding" class="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Encoding</label>
            <input id="printerEncoding" [(ngModel)]="form.encoding" name="encoding" type="text" placeholder="CP437"
              class="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg p-3
                     text-slate-900 dark:text-white focus:border-slate-900 dark:focus:border-white
                     focus:ring-1 focus:ring-slate-900 dark:focus:ring-white outline-none" />
          </div>
        </div>

        <!-- Aktiv -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input [(ngModel)]="form.active" name="active" type="checkbox"
            class="w-4 h-4 rounded border-slate-300 dark:border-gray-600
                   text-slate-900 dark:text-white focus:ring-slate-900 dark:focus:ring-white" />
          <span class="text-sm text-slate-700 dark:text-gray-300">Drucker aktiv</span>
        </label>

        <!-- Buttons -->
        <div class="flex justify-end gap-3 pt-4">
          <button type="button" (click)="onCancel()"
            class="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-gray-400
                   hover:bg-slate-100 dark:hover:bg-gray-800 transition">
            Abbrechen
          </button>
          <button type="submit"
            class="px-6 py-2 rounded-lg text-sm font-medium bg-slate-900 dark:bg-white
                   text-white dark:text-black hover:bg-slate-800 dark:hover:bg-gray-200 transition">
            Speichern
          </button>
        </div>
      </form>
    </div>
  `,
})
export class PrinterFormDialogComponent {
  private dialogRef = inject(MatDialogRef<PrinterFormDialogComponent>)
  private data: PrinterFormData | null = inject(MAT_DIALOG_DATA, { optional: true })

  isEdit = !!this.data?.pid
  form: PrinterFormData = this.data
    ? { ...this.data }
    : {
        pid: uuidv7(),
        active: true,
        type: 'ip',
        name: '',
        ip: '',
        port: 9100,
        paperWidth: '80mm',
        encoding: 'CP437',
        mqttTopic: '/rospos/orders/print',
      }

  onSave() {
    this.dialogRef.close(this.form)
  }

  onCancel() {
    this.dialogRef.close(null)
  }
}
