import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { lastValueFrom } from 'rxjs'
import { API_BASE_URL } from '../core/api-base-url'
import { ApiService } from '../core/api.service'
import { type CloudConnection, type CloudStatus, deriveCloudStatus } from '../core/cloud-status'
import { DeviceStatusService } from '../core/device-status.service'
import { SyncProblemCountService } from '../core/sync-problem-count.service'

export type StatusTone = 'ok' | 'warn' | 'error' | 'neutral'

const CLOUD_LABEL: Record<CloudStatus, string> = {
  standalone: 'DASHBOARD.STATUS_STANDALONE',
  connected: 'DASHBOARD.STATUS_CONNECTED',
  pairing: 'DASHBOARD.STATUS_PAIRING',
  disconnected: 'DASHBOARD.STATUS_DISCONNECTED',
  stale: 'DASHBOARD.STATUS_STALE',
  error: 'DASHBOARD.STATUS_ERROR',
}

const TONE_DOT: Record<StatusTone, string> = {
  ok: 'bg-action',
  warn: 'bg-warn-ink',
  error: 'bg-danger',
  neutral: 'bg-shell-muted',
}

export function cloudTone(status: CloudStatus): StatusTone {
  if (status === 'connected') return 'ok'
  if (status === 'error') return 'error'
  if (status === 'pairing' || status === 'stale') return 'warn'
  return 'neutral'
}

export const syncTone = (openProblems: number): StatusTone => (openProblems > 0 ? 'error' : 'ok')

export function deviceTone(online: number, total: number): StatusTone {
  if (total === 0) return 'neutral'
  return online > 0 ? 'ok' : 'warn'
}

// Gleicher Takt wie die Seitenleisten-Zähler: Ein „stale" wird ohne Reload sichtbar.
const CLOUD_POLL_MS = 60_000

/**
 * Edge-Statuszeile der Admin-Shell (core#836, Konzept 2.8): Cloud-Kopplung, offene Sync-Probleme,
 * verbundene Geräte und Edge-Version. Sync- und Geräte-Zähler kommen aus den App-weiten Services,
 * die das Layout ohnehin im Minutentakt auffrischt; Cloud-Status und Version holt die Zeile selbst.
 */
@Component({
  selector: 'app-edge-status-bar',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="flex items-center gap-5 text-[13px] text-shell-muted" [attr.aria-label]="'NAV.STATUS_BAR' | translate">
      <li class="flex items-center gap-1.5">
        <span class="size-[7px] rounded-full" [class]="dot(cloudTone())" aria-hidden="true"></span>
        <span class="font-semibold text-shell-ink">{{ 'NAV.STATUS_CLOUD' | translate }}</span>
        · {{ cloudLabel() | translate }}
      </li>
      <li class="flex items-center gap-1.5">
        <span class="size-[7px] rounded-full" [class]="dot(syncTone())" aria-hidden="true"></span>
        <span class="font-semibold text-shell-ink">{{ 'NAV.STATUS_SYNC' | translate }}</span>
        ·
        @if (syncProblems.count() > 0) {
          {{ 'NAV.STATUS_SYNC_PROBLEMS' | translate: { count: syncProblems.count() } }}
        } @else {
          {{ 'NAV.STATUS_SYNC_OK' | translate }}
        }
      </li>
      @if (deviceStatus.online() !== null && deviceStatus.total() !== null) {
        <li class="flex items-center gap-1.5">
          <span class="size-[7px] rounded-full" [class]="dot(deviceTone())" aria-hidden="true"></span>
          <span class="font-semibold text-shell-ink">{{ 'NAV.DEVICES' | translate }}</span>
          ·
          {{ 'NAV.DEVICE_BADGE' | translate: { online: deviceStatus.online(), total: deviceStatus.total() } }}
        </li>
      }
      @if (version()) {
        <li class="font-mono tabular-nums">v{{ version() }}</li>
      }
    </ul>
  `,
})
export class EdgeStatusBarComponent {
  private readonly api = inject(ApiService)
  private readonly http = inject(HttpClient)
  protected readonly syncProblems = inject(SyncProblemCountService)
  protected readonly deviceStatus = inject(DeviceStatusService)

  private readonly cloudStatus = signal<CloudStatus>('standalone')
  protected readonly version = signal<string | null>(null)

  protected readonly cloudLabel = computed(() => CLOUD_LABEL[this.cloudStatus()])
  protected readonly cloudTone = computed(() => cloudTone(this.cloudStatus()))
  protected readonly syncTone = computed(() => syncTone(this.syncProblems.count()))
  protected readonly deviceTone = computed(() =>
    deviceTone(this.deviceStatus.online() ?? 0, this.deviceStatus.total() ?? 0),
  )

  constructor() {
    void this.loadVersion()
    void this.refreshCloudStatus()
    const timer = setInterval(() => void this.refreshCloudStatus(), CLOUD_POLL_MS)
    inject(DestroyRef).onDestroy(() => clearInterval(timer))
  }

  protected dot(tone: StatusTone): string {
    return TONE_DOT[tone]
  }

  private async loadVersion(): Promise<void> {
    const health = await lastValueFrom(this.http.get<{ version?: string }>(`${API_BASE_URL}/health`)).catch(() => null)
    this.version.set(health?.version ?? null)
  }

  private async refreshCloudStatus(): Promise<void> {
    const res = await this.api.find<CloudConnection>('cloud-connection', { $limit: 1 }).catch(() => null)
    this.cloudStatus.set(deriveCloudStatus(res?.data[0], Date.now()))
  }
}
