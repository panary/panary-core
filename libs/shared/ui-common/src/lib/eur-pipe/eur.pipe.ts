import { Pipe, PipeTransform } from '@angular/core'
import { formatEur } from '@panary/shared/util-helpers'

/** Betrag in Euro als de-DE-Text („16,50 €") — ersetzt `currency: 'EUR'` (das folgt sonst `LOCALE_ID`, also en-US). */
@Pipe({ name: 'eur', pure: true })
export class EurPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatEur(value)
  }
}
