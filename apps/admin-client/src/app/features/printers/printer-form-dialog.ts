import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { canonicalPrinterEncoding, PRINTER_ENCODINGS } from '@panary/locations/domain'
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
  /** #347 — fehlt das Feld (Bestandsdrucker), druckt der Drucker den Vollbon. */
  role?: 'kitchen' | 'receipt' | 'both'
  mqttTopic?: string
}

@Component({
  selector: 'app-printer-form-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 min-w-[400px]">
      <h2 class="text-lg font-semibold text-ink mb-6">
        {{ isEdit ? 'Drucker bearbeiten' : 'Drucker hinzufügen' }}
      </h2>

      <form (ngSubmit)="onSave()" class="space-y-4">
        <!-- Name -->
        <div class="space-y-1">
          <label for="printerName" class="text-xs font-medium text-ink-muted uppercase tracking-wider">Name *</label>
          <input
            id="printerName"
            [(ngModel)]="form.name"
            name="name"
            type="text"
            required
            class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                   text-ink focus:border-ink
                   focus:ring-1 focus:ring-ink outline-none"
          />
        </div>

        <!-- Typ -->
        <div class="space-y-1">
          <label for="printerType" class="text-xs font-medium text-ink-muted uppercase tracking-wider">Typ</label>
          <select
            id="printerType"
            [(ngModel)]="form.type"
            name="type"
            class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                   text-ink outline-none"
          >
            <option value="ip">WLAN / Netzwerk (IP)</option>
            <option value="mqtt">MQTT</option>
          </select>
        </div>

        <!-- IP-Drucker Felder -->
        @if (form.type === 'ip') {
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label for="printerIp" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
                >IP-Adresse *</label
              >
              <input
                id="printerIp"
                [(ngModel)]="form.ip"
                name="ip"
                type="text"
                required
                placeholder="192.168.1.100"
                pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
                class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                       text-ink focus:border-ink
                       focus:ring-1 focus:ring-ink outline-none"
              />
            </div>
            <div class="space-y-1">
              <label for="printerPort" class="text-xs font-medium text-ink-muted uppercase tracking-wider">Port</label>
              <input
                id="printerPort"
                [(ngModel)]="form.port"
                name="port"
                type="number"
                min="1"
                max="65535"
                class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                       text-ink focus:border-ink
                       focus:ring-1 focus:ring-ink outline-none"
              />
            </div>
          </div>
        }

        <!-- MQTT-Drucker Felder -->
        @if (form.type === 'mqtt') {
          <div class="space-y-1">
            <label for="printerMqttTopic" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
              >MQTT-Topic</label
            >
            <input
              id="printerMqttTopic"
              [(ngModel)]="form.mqttTopic"
              name="mqttTopic"
              type="text"
              placeholder="/rospos/orders/print"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink focus:border-ink
                     focus:ring-1 focus:ring-ink outline-none"
            />
          </div>
        }

        <!-- Papierbreite & Encoding -->
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <label for="printerPaperWidth" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
              >Papierbreite</label
            >
            <select
              id="printerPaperWidth"
              [(ngModel)]="form.paperWidth"
              name="paperWidth"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink outline-none"
            >
              <option value="80mm">80mm (Standard)</option>
              <option value="58mm">58mm</option>
            </select>
          </div>
          <div class="space-y-1">
            <label for="printerEncoding" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
              >Encoding</label
            >
            <select
              id="printerEncoding"
              [(ngModel)]="form.encoding"
              name="encoding"
              class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                     text-ink outline-none"
            >
              @for (e of encodings; track e.value) {
                <option [value]="e.value">{{ e.label }}</option>
              }
              @if (unknownEncoding) {
                <option [value]="unknownEncoding">{{ unknownEncoding }} — unbekannt, druckt als CP437</option>
              }
            </select>
          </div>
        </div>

        <!-- Rolle -->
        <div class="space-y-1">
          <label for="printerRole" class="text-xs font-medium text-ink-muted uppercase tracking-wider">Rolle</label>
          <select
            id="printerRole"
            [(ngModel)]="form.role"
            name="role"
            class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                   text-ink outline-none"
          >
            <option value="both">Küche & Quittung (Standard)</option>
            <option value="kitchen">Nur Küche — ohne Filialkopf und TSE-Block</option>
            <option value="receipt">Nur Quittung — vollständiger Beleg</option>
          </select>
          <p class="text-xs text-ink-faint">
            Küchenbons lassen Filialkopf und TSE-Signatur weg. Positionen, Nachlässe und Gesamtsumme sind auf beiden
            Varianten gleich.
          </p>
        </div>

        <!-- Aktiv -->
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            [(ngModel)]="form.active"
            name="active"
            type="checkbox"
            class="w-4 h-4 rounded border-line-strong
                   text-ink focus:ring-ink"
          />
          <span class="text-sm text-ink">Drucker aktiv</span>
        </label>

        <!-- Buttons -->
        <div class="flex justify-end gap-3 pt-4">
          <button
            type="button"
            (click)="onCancel()"
            class="px-4 py-2 rounded-lg text-sm font-medium text-ink-muted
                   hover:bg-line-soft transition"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            class="px-6 py-2 rounded-lg text-sm font-medium bg-ink
                   text-surface-panel hover:bg-ink/90 transition"
          >
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

  readonly encodings = PRINTER_ENCODINGS

  isEdit = !!this.data?.pid
  /**
   * Ein Bestandswert aus der Freitext-Zeit, den der Edge nicht kennt (#376). Er
   * bleibt als eigene Option waehlbar, damit Oeffnen und Speichern ihn nicht still
   * ersetzen — der Betreiber sieht, dass er als CP437 druckt, und waehlt selbst.
   */
  readonly unknownEncoding: string | null =
    this.data?.encoding && !canonicalPrinterEncoding(this.data.encoding) ? this.data.encoding : null

  form: PrinterFormData = this.data
    ? // Ein Bestandsdrucker traegt `role` nicht. Ohne das Auffuellen stuende das
      // Auswahlfeld leer und der erste Speichervorgang schriebe `undefined` —
      // auf dem Papier zwar weiterhin der Vollbon, in der Maske aber ein
      // Zustand, den der Nutzer nicht gewaehlt hat (#347).
      // Dasselbe fuer `encoding`: „cp858" aus der Freitext-Zeit trifft keine
      // Option der Auswahl und stuende sonst leer da (#376).
      // Und fuer `paperWidth`: gedruckt wird ohne Wert 80 mm (`print-job.builder`),
      // die Maske zeigte aber ein leeres Feld (#759).
      {
        ...this.data,
        role: this.data.role ?? 'both',
        paperWidth: this.data.paperWidth ?? '80mm',
        encoding: canonicalPrinterEncoding(this.data.encoding) ?? this.data.encoding,
      }
    : {
        pid: uuidv7(),
        active: true,
        type: 'ip',
        name: '',
        ip: '',
        port: 9100,
        paperWidth: '80mm',
        encoding: 'CP437',
        role: 'both',
        mqttTopic: '/rospos/orders/print',
      }

  onSave() {
    this.dialogRef.close(this.form)
  }

  onCancel() {
    this.dialogRef.close(null)
  }
}
