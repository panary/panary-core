import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { sortStaff, type StaffPerson } from './staff-picker.logic'

export interface StaffPickerPerson extends StaffPerson {
  initials: string
  color: string
  staffRole?: string
}

/**
 * Schritt 1 des POS-Logins auf geteilten Geräten: alle Mitarbeiter als alphabetisches
 * Kachelraster. PIN und Login bleiben im Login — die Komponente bekommt Personen und
 * meldet die Wahl.
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

  readonly picked = output<StaffPickerPerson>()

  protected readonly sorted = computed(() => sortStaff(this.users()))
}
