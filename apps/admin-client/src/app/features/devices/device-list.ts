import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { DeviceStatusService } from '../../core/device-status.service'

interface Device {
  _id: string
  deviceId: string
  name: string
  type: string
  lastSeen?: string
  active: boolean
}

@Component({
  selector: 'app-device-list',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 space-y-4 h-full overflow-y-auto">
      <div class="flex items-center justify-between min-h-9">
        <h1 class="text-xl font-bold tracking-tight">{{ 'DEVICES.TITLE' | translate }}</h1>
        @if (deviceStatus.online() !== null && deviceStatus.total() !== null) {
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full
                       bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300">
            {{ deviceStatus.online() }} / {{ deviceStatus.total() }} {{ 'DEVICES.CONNECTED' | translate }}
          </span>
        }
      </div>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500 text-sm">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (devices().length === 0) {
        <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">{{ 'DEVICES.NO_DEVICES' | translate }}</p>
      } @else {
        <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                         text-xs uppercase tracking-wider">
                <th class="px-3 py-2.5">{{ 'COMMON.NAME' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.TYPE' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.DEVICE_ID' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.LAST_SEEN' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'DEVICES.CONNECTION' | translate }}</th>
                <th class="px-3 py-2.5">{{ 'COMMON.STATUS_ACTIVE' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (device of devices(); track device._id) {
                <tr class="border-b border-slate-200/50 dark:border-gray-800/50 hover:bg-slate-50 dark:hover:bg-gray-800/30 transition">
                  <td class="px-3 py-2.5 font-medium truncate max-w-48">{{ device.name }}</td>
                  <td class="px-3 py-2.5">
                    <span class="text-xs px-2 py-0.5 rounded-full border border-slate-300 dark:border-gray-700
                                 text-slate-600 dark:text-gray-300">
                      {{ device.type }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 font-mono text-xs">
                    {{ device.deviceId.slice(0, 8) }}…
                  </td>
                  <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 text-xs">
                    {{ device.lastSeen ? formatDate(device.lastSeen) : '—' }}
                  </td>
                  <td class="px-3 py-2.5">
                    @if (isConnected(device.deviceId)) {
                      <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-green-50 text-green-700 ring-green-600/20
                                   dark:bg-green-900/30 dark:text-green-300 dark:ring-green-500/30">
                        <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        {{ 'DEVICES.ONLINE' | translate }}
                      </span>
                    } @else {
                      <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                                   ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-500/20
                                   dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-500/30">
                        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                        {{ 'DEVICES.OFFLINE' | translate }}
                      </span>
                    }
                  </td>
                  <td class="px-3 py-2.5">
                    @if (device.active) {
                      <span class="inline-block w-2 h-2 rounded-full bg-green-400" [title]="'COMMON.STATUS_ACTIVE' | translate"></span>
                    } @else {
                      <span class="inline-block w-2 h-2 rounded-full bg-slate-300 dark:bg-gray-600"></span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class DeviceListComponent implements OnInit {
  private api = inject(ApiService)
  protected deviceStatus = inject(DeviceStatusService)

  protected devices = signal<Device[]>([])
  protected loading = signal(true)

  private dateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  protected isConnected(deviceId: string): boolean {
    return this.deviceStatus.connectedDeviceIds().has(deviceId)
  }

  protected formatDate(iso: string): string {
    try {
      return this.dateFormatter.format(new Date(iso))
    } catch {
      return iso
    }
  }

  async ngOnInit() {
    await Promise.all([this.loadDevices(), this.deviceStatus.refresh()])
    this.loading.set(false)
  }

  private async loadDevices() {
    try {
      const result = await this.api.find<Device>('devices', { $limit: 100, $sort: { name: 1 } })
      this.devices.set(result.data)
    } catch {
      // Recht fehlt / Service nicht erreichbar — leere Liste, Empty-State greift.
    }
  }
}
