/**
 * Abschlusskette nach „Bestellen" → Im Haus/Außer Haus (core#1069): Pager, Tisch, Fertigungszeit im selben Raster.
 * Eine Erstnutzerin bemerkte den Wechsel von der Pager- zur Tischwahl nicht — beide Raster zeigen nur Zahlen. Der
 * Schrittkopf über dem Raster nennt deshalb die ganze Folge samt schon gewählter Werte.
 */
export type ClosingStep = 'pager' | 'table' | 'time'

export interface ClosingStepView {
  key: ClosingStep
  label: string
  state: 'done' | 'current' | 'next'
  /** Gewählter Wert eines erledigten Schritts („Pager 7"); `null` heißt übersprungen. */
  value: string | null
}

const LABELS: Record<ClosingStep, string> = { pager: 'Pager', table: 'Tisch', time: 'Zeit' }

/**
 * Die Folge, wie die Kasse sie durchläuft: Die Tischwahl erreicht man nur über einen gewählten Pager
 * (`setPagerSubbuttons`), die Fertigungszeit fragt nur Außer Haus (#343).
 */
export function closingSteps(options: { showPagers: boolean; showTables: boolean; takeOut: boolean }): ClosingStep[] {
  const steps: ClosingStep[] = []
  if (options.showPagers) {
    steps.push('pager')
    if (options.showTables) steps.push('table')
  }
  if (options.takeOut) steps.push('time')
  return steps
}

export function closingStepViews(
  steps: readonly ClosingStep[],
  current: ClosingStep | null,
  chosen: { pager?: number | null; table?: string | null },
): ClosingStepView[] {
  const at = current ? steps.indexOf(current) : -1
  if (at < 0) return []
  return steps.map((key, index) => ({
    key,
    label: LABELS[key],
    state: index < at ? 'done' : index === at ? 'current' : 'next',
    value: index < at ? chosenValue(key, chosen) : null,
  }))
}

function chosenValue(key: ClosingStep, chosen: { pager?: number | null; table?: string | null }): string | null {
  if (key === 'pager' && chosen.pager != null) return `${LABELS.pager} ${chosen.pager}`
  if (key === 'table' && chosen.table) return `${LABELS.table} ${chosen.table}`
  return null
}
