import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { TranslateModule } from '@ngx-translate/core'

@Component({
  selector: 'app-status',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './status.html',
  styleUrl: './status.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Status {
  ipAddress = signal<string>(window.location.hostname)
}
