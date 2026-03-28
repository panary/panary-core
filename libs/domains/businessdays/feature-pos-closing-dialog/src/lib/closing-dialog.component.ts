import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog'

@Component({
  selector: 'app-closing-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule],
  template: `
    <h2 mat-dialog-title>Tagesabschluss</h2>
    <mat-dialog-content>
      <p>Der Tagesabschluss wird in einer zukünftigen Version verfügbar sein.</p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button class="bg-white border border-slate-200 text-slate-700 rounded-xl px-4 h-10 hover:bg-[#f5f4f2] transition-colors" (click)="close()">Schließen</button>
    </mat-dialog-actions>
  `,
})
export class ClosingDialogComponent {
  private dialogRef = inject(MatDialogRef<ClosingDialogComponent>)

  close() {
    this.dialogRef.close()
  }
}
