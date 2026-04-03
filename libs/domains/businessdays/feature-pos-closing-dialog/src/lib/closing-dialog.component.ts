import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule } from '@ngx-translate/core'

@Component({
  selector: 'app-closing-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, TranslateModule],
  template: `
    <h2 mat-dialog-title>{{ 'CLOSING.TITLE' | translate }}</h2>
    <mat-dialog-content>
      <p>Der Tagesabschluss wird in einer zukünftigen Version verfügbar sein.</p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl px-4 h-10 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" (click)="close()">{{ 'COMMON.CLOSE' | translate }}</button>
    </mat-dialog-actions>
  `,
})
export class ClosingDialogComponent {
  private dialogRef = inject(MatDialogRef<ClosingDialogComponent>)

  close() {
    this.dialogRef.close()
  }
}
