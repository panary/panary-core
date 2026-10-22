import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import {
  countByLetterGroup,
  filterStaff,
  LETTER_GROUPS,
  letterGroupLabel,
  resolveRecentStaff,
  sortStaff,
  type StaffPerson,
} from './staff-picker.logic'

export interface StaffPickerPerson extends StaffPerson {
  initials: string
  color: string
  staffRole?: string
}

/**
 * Schritt 1 des POS-Logins auf geteilten Geräten (panary/panary-core#835): Mitarbeiterwahl
 * für 30+ Personen. „Zuletzt hier" steht oben, darunter Suche und Buchstabengruppen; jede
 * Person ist in höchstens zwei Taps erreichbar (Gruppe → Kachel oder Suchtext → Kachel).
 *
 * Die Komponente hält nur Filterzustand. PIN, Login und die Ablage der letzten Anmeldungen
 * bleiben im Login — sie bekommt Personen und IDs und meldet die Wahl.
 */
@Component({
  selector: 'lib-staff-picker',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './staff-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffPickerComponent {
  readonly users = input.required<readonly StaffPickerPerson[]>()
  readonly recentIds = input<readonly string[]>([])

  readonly picked = output<StaffPickerPerson>()

  protected readonly query = signal('')
  protected readonly groupIndex = signal<number | null>(null)

  protected readonly sorted = computed(() => sortStaff(this.users()))
  protected readonly recent = computed(() => resolveRecentStaff(this.users(), this.recentIds()))
  protected readonly visible = computed(() => filterStaff(this.sorted(), this.query(), this.groupIndex()))
  protected readonly groups = computed(() => {
    const counts = countByLetterGroup(this.users())
    return LETTER_GROUPS.map((group, index) => ({ index, label: letterGroupLabel(group), empty: counts[index] === 0 }))
  })
  /** „Zuletzt hier" nur im unbefilterten Zustand — beim Suchen und Filtern würde es doppelt erscheinen. */
  protected readonly showRecent = computed(
    () => this.recent().length > 0 && !this.query().trim() && this.groupIndex() === null,
  )

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value)
    this.groupIndex.set(null)
  }

  protected selectGroup(index: number | null): void {
    this.query.set('')
    this.groupIndex.set(this.groupIndex() === index ? null : index)
  }
}
