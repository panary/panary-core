import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'

@Component({
  selector: 'app-closing-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Tagesabschluss</h2>
    <mat-dialog-content>
      <p>Der Tagesabschluss wird in einer zukünftigen Version verfügbar sein.</p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button (click)="close()">Schließen</button>
    </mat-dialog-actions>
  `,
})
export class ClosingDialogComponent {
  private dialogRef = inject(MatDialogRef<ClosingDialogComponent>)

  close() {
    this.dialogRef.close()
  }
}
