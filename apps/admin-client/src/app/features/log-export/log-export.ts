import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

import { ApiService } from '../../core/api.service'
import { formatApiError } from '../../core/error-helper'

interface LogExportResult {
  filename: string
  contentType: string
  sha256: string
  lineCount: number
  fileCount: number
  generatedAt: string
  contentBase64: string
}

@Component({
  selector: 'app-log-export',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-6">
      <header>
        <h1 class="text-xl font-bold tracking-tight">{{ 'LOGS.TITLE' | translate }}</h1>
        <p class="text-slate-500 dark:text-gray-400 text-sm mt-1">{{ 'LOGS.DESCRIPTION' | translate }}</p>
      </header>

      <section
        class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4 max-w-2xl">
        <p class="text-sm text-slate-600 dark:text-gray-300">{{ 'LOGS.HINT' | translate }}</p>

        <button
          type="button"
          (click)="exportLogs()"
          [disabled]="exporting()"
          class="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-sm font-medium
                 hover:bg-slate-800 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-colors">
          {{ (exporting() ? 'LOGS.EXPORTING' : 'LOGS.EXPORT_BUTTON') | translate }}
        </button>

        @if (lastResult(); as r) {
          <p class="text-sm text-emerald-600 dark:text-emerald-400">
            {{ 'LOGS.SUCCESS' | translate }} — {{ r.lineCount }} {{ 'LOGS.LINES' | translate }},
            {{ r.fileCount }} {{ 'LOGS.FILES' | translate }}
          </p>
        }
        @if (error(); as e) {
          <p class="text-sm text-red-600 dark:text-red-400">{{ 'LOGS.ERROR' | translate }}: {{ e }}</p>
        }
      </section>
    </div>
  `,
})
export class LogExportComponent {
  private api = inject(ApiService)

  protected readonly exporting = signal(false)
  protected readonly error = signal<string | null>(null)
  protected readonly lastResult = signal<LogExportResult | null>(null)

  protected async exportLogs(): Promise<void> {
    this.exporting.set(true)
    this.error.set(null)
    try {
      const res = await this.api.find<LogExportResult>('log-export')
      const bundle = res.data[0]
      if (!bundle) {
        this.error.set('—')
        return
      }
      this.triggerDownload(bundle)
      this.lastResult.set(bundle)
    } catch (err) {
      this.error.set(formatApiError(err))
    } finally {
      this.exporting.set(false)
    }
  }

  private triggerDownload(bundle: LogExportResult): void {
    const binary = atob(bundle.contentBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: bundle.contentType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = bundle.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}
