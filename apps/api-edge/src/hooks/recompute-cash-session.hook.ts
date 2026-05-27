import { sumDenominationCounts, type DenominationCounts } from '@panary/businessdays/domain'

import type { HookContext } from '../declarations'

const isFromSync = (context: HookContext): boolean =>
  Boolean((context.params as { fromSync?: boolean }).fromSync)

/**
 * Before-Hook (create + patch) am EDGE: berechnet den lokal sicher ableitbaren
 * Kassen-Wert — den gezählten Ist-Bestand aus den Stückelungen:
 *
 *   countedClosingFloatCents = Σ (Stückzahl × Nennwert)
 *
 * Bewusst NUR dieser Wert. Der Soll-Bar-Umsatz (`cashSalesCents`) und die daraus
 * abgeleitete `expectedClosingFloatCents`/`varianceCents` bleiben CLOUD-
 * autoritativ: die Cloud aggregiert ihn aus den (gesyncten) Bestellungen
 * (`performedBy == openedBy`) und füllt die Felder beim Sync-Apply über ihren
 * eigenen recompute-Hook. Eine SQLite-seitige Order-Aggregation am Edge wäre
 * fehleranfällig (verschachteltes payment.transactions-JSON) und ist unnötig,
 * weil der finale Tagesabschluss ohnehin in der Cloud läuft.
 *
 * Sync-Apply (`fromSync`) wird übersprungen — dort bringt die Cloud bereits die
 * autoritativen Werte mit, die nicht überschrieben werden dürfen.
 */
export const recomputeCashSessionTotals = async (context: HookContext): Promise<HookContext> => {
  const data = context.data as Record<string, unknown> | undefined
  if (!data || Array.isArray(data)) return context
  if (isFromSync(context)) return context

  let baseCounts: DenominationCounts | null = null
  if (context.method === 'patch' && context.id != null) {
    try {
      const base = (await context.service.get(context.id, { provider: undefined })) as {
        denominationCounts?: DenominationCounts | null
      }
      baseCounts = base.denominationCounts ?? null
    } catch {
      baseCounts = null
    }
  }

  const denominationCounts =
    (data['denominationCounts'] as DenominationCounts | undefined) ?? baseCounts ?? null
  data['countedClosingFloatCents'] = sumDenominationCounts(denominationCounts)

  return context
}
