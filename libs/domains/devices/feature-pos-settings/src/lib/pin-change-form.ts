import type { FieldTree, SchemaPathTree } from '@angular/forms/signals'
import { maxLength, validate } from '@angular/forms/signals'

export interface PinChange {
  currentPin: string
  newPin: string
  confirmPin: string
}

export const EMPTY_PIN_CHANGE: PinChange = { currentPin: '', newPin: '', confirmPin: '' }

/** Regeln der PIN-Änderung in den POS-Einstellungen; die Reihenfolge der Meldungen legt `pinChangeError` fest. */
export function pinChangeSchema(p: SchemaPathTree<PinChange>, pinLength: number): void {
  maxLength(p.currentPin, pinLength)
  maxLength(p.newPin, pinLength)
  maxLength(p.confirmPin, pinLength)
  validate(p.currentPin, ({ value }) => (value().length === pinLength ? undefined : { kind: 'currentRequired' }))
  validate(p.newPin, ({ value }) => (value().length === pinLength ? undefined : { kind: 'length' }))
  validate(p.confirmPin, ({ value, valueOf }) => (value() === valueOf(p.newPin) ? undefined : { kind: 'mismatch' }))
  validate(p.newPin, ({ value, valueOf }) => (value() !== valueOf(p.currentPin) ? undefined : { kind: 'sameAsOld' }))
}

/** Übersetzungsschlüssel der ersten verletzten Regel, in der Reihenfolge der früheren Handler-Prüfungen. */
export function pinChangeError(f: FieldTree<PinChange>): string | null {
  if (f.currentPin().getError('currentRequired')) return 'SETTINGS.PIN_CURRENT_REQUIRED'
  if (f.newPin().getError('length')) return 'SETTINGS.PIN_LENGTH_EXACT'
  if (f.confirmPin().getError('mismatch')) return 'SETTINGS.PIN_MISMATCH'
  if (f.newPin().getError('sameAsOld')) return 'SETTINGS.PIN_SAME_AS_OLD'
  return null
}
