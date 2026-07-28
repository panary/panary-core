import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { uuidv7 } from 'uuidv7'

import type { TableEntry } from '@panary/locations/domain'

import { ApiService } from '../../core/api.service'
import { CloudManagedBannerComponent } from '../../core/cloud-managed-banner'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { formatApiError, getApiErrorCode } from '../../core/error-helper'

const LABEL = 'text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider'
const INPUT = `w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-2.5
               text-sm text-slate-900 dark:text-white outline-none focus:border-slate-900 dark:focus:border-white`

interface RoomVm {
  /**
   * Rein clientseitige, stabile Identitaet. Das Schema kennt keine Raum-ID —
   * sie wird beim Speichern wieder abgestreift. Ohne sie waeren `pendingTable`
   * und `track` an den Array-Index gekoppelt: nach dem Entfernen eines
   * Bereichs rutschen alle folgenden eine Position vor, und der eingetippte
   * Text landet im falschen Raum.
   */
  id: string
  name: string
  /**
   * Zuletzt gespeicherter Name, `null` fuer noch nie persistierte Bereiche.
   * Leert der Nutzer das Feld, wird darauf zurueckgesetzt — sonst zeigte die UI
   * einen namenlosen Bereich, waehrend die Datenbank ihn samt Tischen weiter
   * fuehrt (der Save filtert namenlose Bereiche heraus).
   */
  persistedName: string | null
  tables: TableEntry[]
}

/**
 * Nur `import type` fuer TableEntry: die Schema-Datei fuehrt beim Modul-Load
 * `Type.Object(...)` aus, ein Wert-Import (z.B. von `tableEntryLabel`) zoege
 * @feathersjs/typebox samt AJV in diesen Lazy-Chunk. Der Typ-Import wird vom
 * Compiler restlos entfernt, haelt aber die Kopplung ans Schema: driftet es,
 * bricht der Build.
 */
const readLabel = (entry: string | TableEntry): string =>
  typeof entry === 'string' ? entry : entry.label

@Component({
  selector: 'app-table-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule, CloudManagedBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 max-w-2xl space-y-4 h-full overflow-y-auto">
      <div>
        <div class="flex items-center justify-between min-h-9">
          <h1 class="text-xl font-bold tracking-tight">{{ 'LOCATION.TABLES_SETTINGS' | translate }}</h1>
        </div>
        <p class="text-slate-500 dark:text-gray-400 text-sm mt-1 leading-relaxed">{{ 'LOCATION.TABLES_DESCRIPTION' | translate }}</p>
      </div>

      @if (loading()) {
        <p class="text-slate-400 dark:text-gray-500">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (!locationId()) {
        <div class="text-center py-16">
          <p class="text-slate-400 dark:text-gray-500 text-lg">{{ 'LOCATION.NO_LOCATION' | translate }}</p>
        </div>
      } @else {
        @if (readOnly()) {
          <app-cloud-managed-banner sublineKey="CLOUD_MANAGED.SUBLINE_TABLES" />
        } @else if (migrationPending()) {
          <!--
            Bewusst kein Write beim Laden: das ist eine Auto-Save-Seite, ein
            stiller PATCH ohne Nutzeraktion waere ueberraschend — und bei
            Cloud-Verwaltung ohnehin verboten.
          -->
          <div class="border border-slate-200 dark:border-gray-800 rounded-xl p-3">
            <p class="text-xs text-slate-500 dark:text-gray-400">{{ 'LOCATION.TABLES_MIGRATION_HINT' | translate }}</p>
          </div>
        }

        <!-- Toggle -->
        <fieldset [disabled]="readOnly()"
          class="min-w-0 m-0 flex items-center justify-between border border-slate-200 dark:border-gray-800 rounded-xl p-4"
          [class.opacity-60]="readOnly()">
          <div>
            <p class="text-sm font-medium text-slate-900 dark:text-white">{{ 'LOCATION.TABLES_ENABLED' | translate }}</p>
            <p class="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{{ 'LOCATION.TABLES_ENABLED_HINT' | translate }}</p>
          </div>
          <button type="button" (click)="toggleEnabled()"
            [class]="enabled()
              ? 'relative w-9 h-5 bg-slate-900 dark:bg-white rounded-full transition'
              : 'relative w-9 h-5 bg-slate-300 dark:bg-gray-700 rounded-full transition'">
            <span [class]="enabled()
              ? 'absolute top-0.5 left-[18px] w-4 h-4 bg-white dark:bg-black rounded-full transition-all'
              : 'absolute top-0.5 left-0.5 w-4 h-4 bg-white dark:bg-black rounded-full transition-all'"></span>
          </button>
        </fieldset>

        <!-- Bereiche -->
        <fieldset [disabled]="readOnly()"
          class="min-w-0 m-0 border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-4"
          [class.opacity-60]="readOnly()">
          <div class="flex items-center justify-between">
            <span class="${LABEL}">{{ 'LOCATION.TABLES_ROOMS' | translate }}</span>
            <button type="button" (click)="addRoom()" [disabled]="saving()"
              class="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                     border border-slate-200 dark:border-gray-800 hover:border-slate-400 dark:hover:border-gray-600
                     px-3 py-1.5 rounded-lg transition disabled:opacity-50">
              + {{ 'LOCATION.TABLES_ROOM_ADD' | translate }}
            </button>
          </div>

          @if (rooms().length === 0) {
            <p class="text-slate-300 dark:text-gray-600 text-xs text-center py-6">{{ 'LOCATION.TABLES_NO_ROOMS' | translate }}</p>
          }

          @for (room of rooms(); track room.id) {
            <div class="border border-slate-100 dark:border-gray-800/60 rounded-lg p-3 space-y-3">
              <div class="flex items-center gap-2">
                <input [ngModel]="room.name" (ngModelChange)="onRoomNameInput(room.id, $event)"
                  (change)="commitRoomName(room.id)" [name]="'room-' + room.id" type="text"
                  placeholder="{{ 'LOCATION.TABLES_ROOM_NAME_PLACEHOLDER' | translate }}"
                  class="${INPUT}" />
                <button type="button" (click)="removeRoom(room.id)" [disabled]="saving()"
                  [title]="'LOCATION.TABLES_REMOVE_ROOM' | translate"
                  class="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg
                         text-slate-400 dark:text-gray-500 hover:text-red-400
                         hover:bg-red-50 dark:hover:bg-red-900/20 transition text-xs disabled:opacity-50">
                  ✕
                </button>
              </div>

              @if (!room.name.trim()) {
                <p class="text-amber-600 dark:text-amber-400 text-xs">{{ 'LOCATION.TABLES_ROOM_NAME_REQUIRED' | translate }}</p>
              }

              <div class="flex items-center gap-2">
                <input [ngModel]="pendingLabel(room.id)" (ngModelChange)="setPendingTable(room.id, $event)"
                  [name]="'table-' + room.id" type="text"
                  placeholder="{{ 'LOCATION.TABLES_ADD_PLACEHOLDER' | translate }}"
                  (keydown.enter)="addTables(room.id); $event.preventDefault()"
                  class="${INPUT} font-mono" />
                <button type="button" (click)="addTables(room.id)" [disabled]="saving()"
                  class="px-4 py-2.5 text-sm font-medium bg-slate-900 dark:bg-white text-white dark:text-black
                         rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 transition whitespace-nowrap disabled:opacity-50">
                  + {{ 'LOCATION.TABLES_ADD' | translate }}
                </button>
              </div>
              <p class="text-[11px] text-slate-400 dark:text-gray-500">{{ 'LOCATION.TABLES_ADD_HINT' | translate }}</p>

              @if (room.tables.length === 0) {
                <p class="text-slate-300 dark:text-gray-600 text-xs text-center py-3">{{ 'LOCATION.TABLES_NONE' | translate }}</p>
              } @else {
                <div class="flex flex-wrap gap-2">
                  @for (table of room.tables; track table.id) {
                    <span class="inline-flex items-center gap-1.5 text-sm font-mono pl-3.5 pr-1.5 py-2 rounded-lg"
                      [class]="isDuplicate(table.label)
                        ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 ring-1 ring-inset ring-amber-300 dark:ring-amber-700'
                        : 'bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300'">
                      {{ table.label }}
                      <button type="button" (click)="removeTable(room.id, table.id)" [disabled]="saving()"
                        class="w-7 h-7 flex items-center justify-center rounded-md
                               text-slate-400 dark:text-gray-500 hover:text-red-400
                               hover:bg-red-50 dark:hover:bg-red-900/20 transition text-xs disabled:opacity-50">
                        ✕
                      </button>
                    </span>
                  }
                </div>
                <p class="text-xs text-slate-400 dark:text-gray-500">
                  {{ 'LOCATION.TABLES_COUNT' | translate: { count: room.tables.length } }}
                </p>
              }
            </div>
          }
        </fieldset>

        @if (info()) {
          <p class="text-slate-500 dark:text-gray-400 text-sm">{{ info() }}</p>
        }

        @if (error()) {
          <p class="text-red-500 dark:text-red-400 text-sm">{{ error() }}</p>
        }

        @if (saved()) {
          <p class="text-green-600 dark:text-green-400 text-sm">{{ 'COMMON.SAVED' | translate }}</p>
        }
      }
    </div>
  `,
})
export class TableSettingsComponent implements OnInit {
  private api = inject(ApiService)
  private t = inject(TranslateService)
  private cloudManaged = inject(CloudManagedService)

  protected readOnly = this.cloudManaged.readOnly

  loading = signal(true)
  saving = signal(false)
  saved = signal(false)
  error = signal<string | null>(null)
  info = signal<string | null>(null)
  locationId = signal<string | null>(null)
  migrationPending = signal(false)

  enabled = signal(false)
  rooms = signal<RoomVm[]>([])
  pendingTable = signal<Record<string, string>>({})

  private currentSettings: Record<string, unknown> = {}

  private static readonly MAX_ROOMS = 50
  private static readonly MAX_TABLES_PER_ROOM = 200
  private static readonly MAX_LABEL_LENGTH = 60

  async ngOnInit() {
    void this.cloudManaged.refresh()
    try {
      const result = await this.api.find<any>('locations', { $limit: 1 })
      if (result.data.length > 0) {
        const loc = result.data[0]
        this.locationId.set(loc._id)
        this.currentSettings = loc.settings ?? {}
        const ts = (this.currentSettings as any).tableSettings
        if (ts) {
          this.enabled.set(ts.enabled ?? false)
          this.rooms.set(this.normalizeRooms(ts.rooms))
        }
      }
    } catch (e) {
      console.error('Fehler beim Laden der Tisch-Einstellungen:', e)
      this.error.set(this.t.instant('LOCATION.LOAD_ERROR'))
    }
    this.loading.set(false)
  }

  /**
   * Legacy-String-Tische (`tables: ['T1','T2']`) zu Objekten mit stabiler ID
   * normalisieren. Bestehende Objekte werden 1:1 durchgereicht, NICHT neu
   * gebaut — sonst gingen Felder wie `seats` verloren.
   */
  private normalizeRooms(raw: Array<{ name?: string; tables?: Array<string | TableEntry> }> = []): RoomVm[] {
    let sawLegacy = false
    const rooms = (raw ?? []).map(r => ({
      id: uuidv7(),
      name: r.name ?? '',
      persistedName: r.name ?? '',
      tables: (r.tables ?? []).map(t => {
        if (typeof t === 'string') {
          sawLegacy = true
          return { id: uuidv7(), label: t }
        }
        return t
      }),
    }))
    this.migrationPending.set(sawLegacy)
    return rooms
  }

  /**
   * Label-Vorkommen über ALLE Bereiche — der POS flacht die Räume ab.
   *
   * Bewusst ein `computed` und keine Methode: das Template fragt pro Tisch-Chip
   * nach Duplikaten. Als Methode baute es bei den erlaubten Grenzen (50 × 200)
   * die komplette Map zehntausendfach pro Change-Detection-Lauf neu auf.
   */
  private readonly labelCounts = computed(() => {
    const counts = new Map<string, number>()
    for (const room of this.rooms()) {
      for (const table of room.tables) {
        const key = readLabel(table).toLowerCase()
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    return counts
  })

  /**
   * Raumübergreifendes Duplikat. Nur als Warnung markiert, nie blockierend:
   * Bestandsdaten aus der Cloud könnten welche enthalten, und dann wäre die
   * Seite sonst unbenutzbar.
   */
  protected isDuplicate(label: string): boolean {
    return (this.labelCounts().get(label.toLowerCase()) ?? 0) > 1
  }

  protected pendingLabel(roomId: string): string {
    return this.pendingTable()[roomId] ?? ''
  }

  protected setPendingTable(roomId: string, value: string) {
    this.pendingTable.update(map => ({ ...map, [roomId]: value }))
  }

  protected onRoomNameInput(roomId: string, value: string) {
    this.rooms.update(list => list.map(r => (r.id === roomId ? { ...r, name: value } : r)))
  }

  /**
   * Speichern erst auf `(change)` (Blur/Enter), nicht bei jedem Tastendruck.
   * `room.name` hat `minLength: 1` im Schema — ein Save mit leerem Namen liefe
   * in einen 400.
   */
  protected commitRoomName(roomId: string) {
    const room = this.rooms().find(r => r.id === roomId)
    if (!room) return

    if (!room.name.trim()) {
      // Ein geleerter Name wuerde beim Speichern herausgefiltert: die UI zeigte
      // dann einen namenlosen Bereich, waehrend die Datenbank ihn samt Tischen
      // weiterfuehrt und der POS sie anzeigt. Fuer bereits persistierte
      // Bereiche deshalb auf den gespeicherten Namen zurueckfallen; neu
      // angelegte duerfen leer bleiben (Hinweis im Template).
      if (room.persistedName) {
        this.rooms.update(list =>
          list.map(r => (r.id === roomId ? { ...r, name: r.persistedName as string } : r)),
        )
      }
      return
    }
    void this.save()
  }

  /**
   * Legt einen Bereich an, OHNE zu speichern: ein frischer Bereich hat einen
   * leeren Namen und würde am `minLength: 1` des Schemas scheitern.
   */
  protected addRoom() {
    if (this.blockedByCloud()) return
    if (this.rooms().length >= TableSettingsComponent.MAX_ROOMS) {
      this.error.set(this.t.instant('LOCATION.TABLES_LIMIT', { max: TableSettingsComponent.MAX_ROOMS }))
      return
    }
    this.error.set(null)
    this.rooms.update(list => [...list, { id: uuidv7(), name: '', persistedName: null, tables: [] }])
  }

  protected async removeRoom(roomId: string) {
    if (this.blockedByCloud()) return
    const wasPersisted = !!this.rooms().find(r => r.id === roomId)?.persistedName
    this.rooms.update(list => list.filter(r => r.id !== roomId))
    this.pendingTable.update(map => {
      const { [roomId]: _removed, ...rest } = map
      return rest
    })
    // Ein nie gespeicherter Bereich braucht keinen Roundtrip.
    if (wasPersisted) await this.save()
  }

  protected async addTables(roomId: string) {
    if (this.blockedByCloud()) return
    const room = this.rooms().find(r => r.id === roomId)
    if (!room) return

    const raw = (this.pendingTable()[roomId] ?? '').trim()
    if (!raw) return

    const labels = raw
      .split(/[,;]/)
      .map(p => p.trim())
      .filter(Boolean)
      .flatMap(p => this.expandTablePart(p))
      .map(l => l.trim())
      .filter(Boolean)

    if (labels.some(l => l.length > TableSettingsComponent.MAX_LABEL_LENGTH)) {
      this.error.set(this.t.instant('LOCATION.TABLES_LABEL_TOO_LONG'))
      return
    }

    // Hart blockieren: der POS nutzt das Label als Identität der Tisch-Kachel
    // (location.service.ts flacht alle Räume ab). Zwei gleiche Labels ergeben
    // dort zwei ununterscheidbare Buttons.
    const existing = this.labelCounts()
    const seen = new Set<string>()
    const toAdd: TableEntry[] = []
    let skipped = 0
    for (const label of labels) {
      const key = label.toLowerCase()
      if (existing.has(key) || seen.has(key)) {
        skipped++
        continue
      }
      seen.add(key)
      toAdd.push({ id: uuidv7(), label })
    }

    if (toAdd.length === 0) {
      this.error.set(this.t.instant('LOCATION.TABLES_DUPLICATE', { label: labels[0] ?? '' }))
      return
    }

    if (room.tables.length + toAdd.length > TableSettingsComponent.MAX_TABLES_PER_ROOM) {
      this.error.set(
        this.t.instant('LOCATION.TABLES_LIMIT', { max: TableSettingsComponent.MAX_TABLES_PER_ROOM }),
      )
      return
    }

    this.error.set(null)
    this.info.set(this.t.instant('LOCATION.TABLES_ADDED', { added: toAdd.length, skipped }))
    this.rooms.update(list =>
      list.map(r => (r.id === roomId ? { ...r, tables: [...r.tables, ...toAdd] } : r)),
    )
    this.pendingTable.update(map => ({ ...map, [roomId]: '' }))
    await this.save()
  }

  protected async removeTable(roomId: string, tableId: string) {
    if (this.blockedByCloud()) return
    this.rooms.update(list =>
      list.map(r => (r.id === roomId ? { ...r, tables: r.tables.filter(t => t.id !== tableId) } : r)),
    )
    await this.save()
  }

  protected async toggleEnabled() {
    if (this.blockedByCloud()) return
    this.enabled.update(v => !v)
    await this.save()
  }

  /**
   * Expandiert `T1-T10` zu einer Liste. Erhält Null-Padding (`T01-T10`) und
   * begrenzt die Spanne, damit ein Tippfehler keine Massen-Anlage auslöst.
   */
  private expandTablePart(part: string): string[] {
    const m = part.match(/^(\D*)(\d+)\s*[-–]\s*(\D*)(\d+)$/)
    if (!m) return [part]
    const [, prefix1, startStr, prefix2, endStr] = m
    // Präfixe müssen übereinstimmen (oder der zweite ist leer: „T1-10").
    if (prefix2 !== '' && prefix2 !== prefix1) return [part]
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [part]
    if (end - start >= TableSettingsComponent.MAX_TABLES_PER_ROOM) return [part]
    const width = startStr.startsWith('0') ? Math.max(startStr.length, endStr.length) : 0
    const out: string[] = []
    for (let n = start; n <= end; n++) {
      out.push(prefix1 + (width ? String(n).padStart(width, '0') : String(n)))
    }
    return out
  }

  private blockedByCloud(): boolean {
    if (!this.readOnly()) return false
    this.error.set(this.t.instant('CLOUD_MANAGED.SAVE_BLOCKED'))
    return true
  }

  private async save() {
    if (this.blockedByCloud()) return
    this.saving.set(true)
    this.error.set(null)
    this.saved.set(false)
    try {
      // Bereiche ohne Namen herausfiltern: `name` hat minLength 1, ein solcher
      // Bereich wuerde den gesamten Patch mit 400 scheitern lassen. Die Cloud
      // filtert nur `name === '' && tables.length === 0` — das reicht hier
      // nicht, weil ein unbenannter Bereich MIT Tischen ebenso invalide ist.
      //
      // `id` und `persistedName` sind reine UI-Felder und werden hier
      // abgestreift — das Schema kennt an einem Raum nur `name` und `tables`.
      const cleanedRooms = this.rooms()
        .filter(r => r.name.trim().length > 0)
        .map(r => ({ name: r.name, tables: r.tables }))
      const mergedSettings = {
        ...this.currentSettings,
        tableSettings: { enabled: this.enabled(), rooms: cleanedRooms },
      }
      await this.api.patch('locations', this.locationId()!, { settings: mergedSettings })
      this.currentSettings = mergedSettings
      // Persistierten Stand nachziehen: nur so weiss `commitRoomName`, ob es
      // einen geleerten Namen zurueckrollen muss oder der Bereich neu ist.
      this.rooms.update(list =>
        list.map(r => (r.name.trim().length > 0 ? { ...r, persistedName: r.name } : r)),
      )
      this.migrationPending.set(false)
      this.saved.set(true)
      setTimeout(() => this.saved.set(false), 2000)
    } catch (e: unknown) {
      this.error.set(formatApiError(e))
      if (getApiErrorCode(e) === 'CLOUD_MANAGED') void this.cloudManaged.refresh()
    } finally {
      this.saving.set(false)
    }
  }
}
