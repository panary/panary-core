import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { applyWhenValue, form, FormField, FormRoot, max, min, pattern, required } from '@angular/forms/signals'
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

/** Das Formularmodell kennt jedes Feld, sonst gaebe es fuer optionale Felder keinen Feldbaum zum Binden. */
type PrinterFormModel = Omit<PrinterFormData, 'ip' | 'port' | 'paperWidth' | 'encoding' | 'role' | 'mqttTopic'> & {
  ip: string
  /** Ein leeres Zahlenfeld liefert `null`; beim Schliessen faellt es weg (Schema: optional, 1–65535). */
  port: number | null
  paperWidth: '58mm' | '80mm'
  encoding: string
  role: 'kitchen' | 'receipt' | 'both'
  mqttTopic: string
}

const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

@Component({
  selector: 'app-printer-form-dialog',
  standalone: true,
  imports: [FormField, FormRoot, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 min-w-[400px]">
      <h2 class="text-lg font-semibold text-ink mb-6">
        {{ isEdit ? 'Drucker bearbeiten' : 'Drucker hinzufügen' }}
      </h2>

      <form [formRoot]="printerForm" (submit)="onSave()" class="space-y-4">
        <!-- Name -->
        <div class="space-y-1">
          <label for="printerName" class="text-xs font-medium text-ink-muted uppercase tracking-wider">Name *</label>
          <input
            id="printerName"
            [formField]="printerForm.name"
            type="text"
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
            [formField]="printerForm.type"
            class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                   text-ink outline-none"
          >
            <option value="ip">WLAN / Netzwerk (IP)</option>
            <option value="mqtt">MQTT</option>
          </select>
        </div>

        <!-- IP-Drucker Felder -->
        @if (printer().type === 'ip') {
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label for="printerIp" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
                >IP-Adresse *</label
              >
              <input
                id="printerIp"
                [formField]="printerForm.ip"
                type="text"
                placeholder="192.168.1.100"
                class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                       text-ink focus:border-ink
                       focus:ring-1 focus:ring-ink outline-none"
              />
            </div>
            <div class="space-y-1">
              <label for="printerPort" class="text-xs font-medium text-ink-muted uppercase tracking-wider">Port</label>
              <input
                id="printerPort"
                [formField]="printerForm.port"
                type="number"
                class="w-full bg-surface-input border border-line-soft rounded-lg p-3
                       text-ink focus:border-ink
                       focus:ring-1 focus:ring-ink outline-none"
              />
            </div>
          </div>
        }

        <!-- MQTT-Drucker Felder -->
        @if (printer().type === 'mqtt') {
          <div class="space-y-1">
            <label for="printerMqttTopic" class="text-xs font-medium text-ink-muted uppercase tracking-wider"
              >MQTT-Topic</label
            >
            <input
              id="printerMqttTopic"
              [formField]="printerForm.mqttTopic"
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
              [formField]="printerForm.paperWidth"
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
              [formField]="printerForm.encoding"
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
            [formField]="printerForm.role"
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
            [formField]="printerForm.active"
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
            [disabled]="printerForm().invalid()"
            class="px-6 py-2 rounded-lg text-sm font-medium bg-ink
                   text-surface-panel hover:bg-ink/90 transition disabled:opacity-50"
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

  readonly printer = signal<PrinterFormModel>(
    this.data
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
          ip: this.data.ip ?? '',
          port: this.data.port ?? null,
          role: this.data.role ?? 'both',
          paperWidth: this.data.paperWidth ?? '80mm',
          encoding: canonicalPrinterEncoding(this.data.encoding) ?? this.data.encoding ?? 'CP437',
          mqttTopic: this.data.mqttTopic ?? '',
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
        },
  )

  readonly printerForm = form(this.printer, p => {
    required(p.name)
    // IP und Port zaehlen nur fuer Netzwerkdrucker; ein MQTT-Drucker darf sie leer lassen.
    applyWhenValue(
      p,
      v => v.type === 'ip',
      ip => {
        required(ip.ip)
        pattern(ip.ip, IPV4_PATTERN)
        min(ip.port, 1)
        max(ip.port, 65535)
      },
    )
  })

  onSave() {
    if (this.printerForm().invalid()) return
    // Leere optionale Felder fallen weg, wie sie ein Bestandsdrucker ohne sie mitbrachte.
    const { port, ip, mqttTopic, ...rest } = this.printer()
    const result: PrinterFormData = {
      ...rest,
      ...(ip ? { ip } : {}),
      ...(port != null ? { port } : {}),
      ...(mqttTopic ? { mqttTopic } : {}),
    }
    this.dialogRef.close(result)
  }

  onCancel() {
    this.dialogRef.close(null)
  }
}
