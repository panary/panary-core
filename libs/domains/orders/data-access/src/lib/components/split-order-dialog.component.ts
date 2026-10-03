import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { NgClass } from '@angular/common'
import { TranslateModule } from '@ngx-translate/core'
import {
  assertOrderIsSplittable,
  effectiveLineItems,
  fromCents,
  isPartiallySplittable,
  lineItemGrossCents,
  Order,
  OrderLineItem,
  OrderSplitError,
  OrderSplitSelectionItem,
  planOrderSplit,
  sumCents,
} from '@panary/orders/domain'
import { OrderService, OrderSplitOfflineError } from '../services/order.service'

/** Dialog-Daten: die zu teilende Bestellung (Stand beim Öffnen). */
export interface SplitOrderDialogData {
  order: Order
}

/** Ergebnis beim erfolgreichen Split — `null`/`undefined` heißt abgebrochen. */
export interface SplitOrderDialogResult {
  sourceOrderId: string
  targetOrderId: string
  targetSequenceNumber?: number
}

/**
 * Eine wählbare Einheit des Dialogs.
 *
 * - `line`: eine einzelne Position. Teilmengen nur, wenn `partial` — Zeilen mit
 *   Extras/Menü-Bestandteilen wandern nur ganz (`isPartiallySplittable`).
 * - `bundle`: eine Kombination (gemeinsame `bundleNumber`). Wandert nur als
 *   Ganzes, sonst bliebe ein halbes Menü auf dem Bon (Entscheidung Michael,
 *   panary/panary-core#350).
 */
interface SplitUnit {
  key: string
  kind: 'line' | 'bundle'
  lines: OrderLineItem[]
  /** Höchstmenge; bei `bundle` und nicht teilbaren Zeilen nur 0 oder `max`. */
  max: number
  partial: boolean
  grossFormatted: string
}

type SplitPreview =
  | { state: 'empty' }
  | { state: 'ok'; sourceFormatted: string; targetFormatted: string }
  | { state: 'error'; messageKey: string }

const EUR_FORMAT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const formatCents = (cents: number): string => EUR_FORMAT.format(fromCents(cents))

/** Fehlercode `order-split/amount-exceeds-remainder` → `SPLIT_ORDER.ERROR.AMOUNT_EXCEEDS_REMAINDER`. */
function errorKey(code: unknown): string {
  if (typeof code !== 'string' || !code.startsWith('order-split/')) return 'SPLIT_ORDER.ERROR.GENERIC'
  return `SPLIT_ORDER.ERROR.${code.slice('order-split/'.length).replace(/-/g, '_').toUpperCase()}`
}

/**
 * Bon-Split am POS (panary/panary-core#350): Positionen einer offenen Bestellung
 * auswählen, Vorschau der beiden Summen sehen, bestätigen.
 *
 * 🚨 Die Vorschau rechnet NICHT selbst: Sie ruft `planOrderSplit` — dieselbe reine
 * Funktion, die der Edge beim Split ausführt. Die Summen stimmen damit per
 * Konstruktion cent-genau mit den entstehenden Bestellungen überein, inklusive
 * Rabatt-Aufteilung und Modifier-Regel (ein Extra skaliert nicht mit der Menge).
 * Dieselbe Funktion liefert auch die Ablehnungen (nichts bliebe übrig, Teilmenge
 * nicht erlaubt) schon VOR dem Bestätigen.
 *
 * Die Bestellung wird live aus dem `OrderService` gelesen, nicht aus dem
 * Öffnungs-Snapshot: Schließt jemand sie, während der Dialog offen ist, sperrt
 * der Dialog sofort, statt erst am Server zu scheitern.
 */
@Component({
  selector: 'lib-split-order-dialog',
  imports: [NgClass, TranslateModule],
  template: `
    <div class="flex flex-col w-[min(40rem,94vw)] max-h-[90dvh] p-6 gap-4">
      <div class="flex-none">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ 'SPLIT_ORDER.TITLE' | translate }}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          #{{ order().dailySequenceNumber }}
          @if (order().settlementScope) {
            · {{ order().settlementScope }}
          }
        </p>
      </div>

      @if (blockedKey(); as key) {
        <div
          class="flex-none rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm"
          role="alert"
        >
          {{ key | translate }}
        </div>
      } @else {
        <p class="flex-none text-sm text-gray-600 dark:text-gray-300">{{ 'SPLIT_ORDER.HINT' | translate }}</p>

        <ul class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1" data-testid="split-units">
          @for (unit of units(); track unit.key) {
            @let qty = quantityOf(unit.key);
            <li
              class="flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
              [ngClass]="
                qty > 0
                  ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950'
                  : 'border-gray-200 dark:border-gray-700'
              "
              [attr.data-unit]="unit.key"
            >
              <div class="flex-1 min-w-0">
                @if (unit.kind === 'bundle') {
                  <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {{ 'SPLIT_ORDER.COMBINATION' | translate }}
                  </p>
                }
                @for (line of unit.lines; track line._id) {
                  <p class="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {{ line.amount }} × {{ line.name }}
                  </p>
                  @for (mod of line.modifiers ?? []; track mod._id) {
                    <p class="text-xs text-gray-500 dark:text-gray-400 truncate">+ {{ mod.name }}</p>
                  }
                }
                @if (!unit.partial && unit.max > 1 && unit.kind === 'line') {
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ 'SPLIT_ORDER.WHOLE_ONLY' | translate }}
                  </p>
                }
              </div>
              <span class="text-sm tabular-nums text-gray-700 dark:text-gray-200">{{ unit.grossFormatted }}</span>

              @if (unit.partial && unit.max > 1) {
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="pnry-touch w-11 h-11 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-center disabled:opacity-40"
                    [disabled]="qty === 0 || submitting()"
                    (click)="setQuantity(unit, qty - 1)"
                    [attr.aria-label]="'SPLIT_ORDER.LESS' | translate"
                  >
                    <span class="material-symbols-outlined text-[1.25rem]">remove</span>
                  </button>
                  <span class="w-12 text-center text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                    {{ qty }} / {{ unit.max }}
                  </span>
                  <button
                    type="button"
                    class="pnry-touch w-11 h-11 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-center disabled:opacity-40"
                    [disabled]="qty >= unit.max || submitting()"
                    (click)="setQuantity(unit, qty + 1)"
                    [attr.aria-label]="'SPLIT_ORDER.MORE' | translate"
                  >
                    <span class="material-symbols-outlined text-[1.25rem]">add</span>
                  </button>
                </div>
              } @else {
                <button
                  type="button"
                  class="pnry-touch w-11 h-11 rounded-lg border flex items-center justify-center disabled:opacity-40"
                  [ngClass]="
                    qty > 0
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
                  "
                  [disabled]="submitting()"
                  (click)="setQuantity(unit, qty > 0 ? 0 : unit.max)"
                  [attr.aria-pressed]="qty > 0"
                  [attr.aria-label]="'SPLIT_ORDER.TOGGLE' | translate"
                >
                  <span class="material-symbols-outlined text-[1.25rem]">{{ qty > 0 ? 'check' : 'add' }}</span>
                </button>
              }
            </li>
          }
        </ul>

        <div
          class="flex-none grid grid-cols-2 gap-3 rounded-xl bg-gray-50 dark:bg-gray-900 px-4 py-3"
          data-testid="split-preview"
        >
          @let p = preview();
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'SPLIT_ORDER.REMAINS' | translate }}</p>
            <p class="text-lg font-bold tabular-nums text-gray-900 dark:text-white" data-testid="split-source-total">
              {{ p.state === 'ok' ? p.sourceFormatted : '–' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'SPLIT_ORDER.NEW_ORDER' | translate }}</p>
            <p class="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300" data-testid="split-target-total">
              {{ p.state === 'ok' ? p.targetFormatted : '–' }}
            </p>
          </div>
        </div>

        @if (messageKey(); as key) {
          <p class="flex-none text-sm text-red-600 dark:text-red-400" role="alert" data-testid="split-message">
            {{ key | translate }}
          </p>
        }
      }

      <div class="flex-none flex justify-end gap-2 pt-1">
        <button
          type="button"
          (click)="close()"
          [disabled]="submitting()"
          class="text-sm font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 px-4 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-40"
        >
          {{ 'COMMON.CANCEL' | translate }}
        </button>
        @if (!blockedKey()) {
          <button
            type="button"
            (click)="confirm()"
            [disabled]="!canConfirm()"
            class="pnry-touch text-sm font-bold px-5 py-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-40"
            data-testid="split-confirm"
          >
            {{ (submitting() ? 'SPLIT_ORDER.SUBMITTING' : 'SPLIT_ORDER.CONFIRM') | translate }}
          </button>
        }
      </div>
    </div>
  `,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SplitOrderDialogComponent {
  #data = inject<SplitOrderDialogData>(MAT_DIALOG_DATA)
  #dialogRef = inject(MatDialogRef<SplitOrderDialogComponent, SplitOrderDialogResult>)
  #orderService = inject(OrderService)

  /** Live-Stand der Bestellung; fällt auf den Öffnungs-Snapshot zurück, solange die Liste ihn nicht kennt. */
  readonly order = computed<Order>(
    () => this.#orderService.orders().find(o => o._id === this.#data.order._id) ?? this.#data.order,
  )

  /** Menge je Einheit (`SplitUnit.key`). Fehlender Eintrag = 0. */
  readonly #quantities = signal<Record<string, number>>({})
  readonly submitting = signal(false)
  /** Ablehnung vom Server bzw. Offline — bleibt stehen, bis die Auswahl sich ändert. */
  readonly #serverErrorKey = signal<string | null>(null)
  /** Hat der Nutzer bei leerer Auswahl bestätigt? Dann wird die Leere gemeldet statt still nichts zu tun. */
  readonly #triedEmpty = signal(false)

  /** Bestellung grundsätzlich nicht teilbar (abgeschlossen, storniert, bezahlt) → Meldung statt Auswahl. */
  readonly blockedKey = computed<string | null>(() => {
    try {
      assertOrderIsSplittable(this.order())
      return null
    } catch (e) {
      return errorKey(e instanceof OrderSplitError ? e.code : undefined)
    }
  })

  /**
   * Wählbare Einheiten aus den EFFEKTIVEN Positionen: Nach einem früheren Split
   * stehen abgegebene Mengen weiter in `lineItems`; was die Quelle noch trägt,
   * sagt allein `effectiveLineItems`.
   */
  readonly units = computed<SplitUnit[]>(() => {
    const lines = effectiveLineItems(this.order())
    const out: SplitUnit[] = []
    const bundles = new Map<number, OrderLineItem[]>()
    for (const line of lines) {
      if (line.bundleNumber !== undefined && line.bundleNumber !== null) {
        const list = bundles.get(line.bundleNumber) ?? []
        list.push(line)
        bundles.set(line.bundleNumber, list)
        continue
      }
      out.push({
        key: `line:${line._id}`,
        kind: 'line',
        lines: [line],
        max: line.amount,
        partial: isPartiallySplittable(line),
        grossFormatted: formatCents(lineItemGrossCents(line)),
      })
    }
    for (const [bundleNumber, bundleLines] of bundles) {
      out.push({
        key: `bundle:${bundleNumber}`,
        kind: 'bundle',
        lines: bundleLines,
        max: 1,
        partial: false,
        grossFormatted: formatCents(sumCents(bundleLines.map(lineItemGrossCents))),
      })
    }
    return out
  })

  /** Auswahl im Format der Edge-Operation. Kombinationen: jede Zeile vollständig (Menge weggelassen). */
  readonly selection = computed<OrderSplitSelectionItem[]>(() => {
    const qty = this.#quantities()
    const out: OrderSplitSelectionItem[] = []
    for (const unit of this.units()) {
      const q = Math.min(qty[unit.key] ?? 0, unit.max)
      if (q <= 0) continue
      if (unit.kind === 'bundle') {
        for (const line of unit.lines) out.push({ lineItemRowId: line._id })
      } else {
        out.push({ lineItemRowId: unit.lines[0]._id, amount: q })
      }
    }
    return out
  })

  readonly preview = computed<SplitPreview>(() => {
    const selection = this.selection()
    if (selection.length === 0) return { state: 'empty' }
    let n = 0
    try {
      const plan = planOrderSplit(this.order(), selection, {
        targetOrderId: 'vorschau',
        splitAt: new Date(0).toISOString(),
        newId: () => `vorschau-${n++}`,
      })
      return {
        state: 'ok',
        sourceFormatted: EUR_FORMAT.format(plan.sourceTaxSnapshot.brutto),
        targetFormatted: EUR_FORMAT.format(plan.targetTaxSnapshot.brutto),
      }
    } catch (e) {
      return { state: 'error', messageKey: errorKey(e instanceof OrderSplitError ? e.code : undefined) }
    }
  })

  readonly messageKey = computed<string | null>(() => {
    const server = this.#serverErrorKey()
    if (server) return server
    const p = this.preview()
    if (p.state === 'error') return p.messageKey
    if (p.state === 'empty' && this.#triedEmpty()) return 'SPLIT_ORDER.ERROR.EMPTY_SELECTION'
    return null
  })

  /**
   * Bestätigen ist bei leerer Auswahl NICHT gesperrt, sondern meldet die Leere —
   * ein grauer Knopf ohne Erklärung ist der stille Abbruch, den der Plan
   * ausschließt. Gesperrt ist er nur, wenn die Vorschau schon weiß, dass der
   * Server ablehnen wird (Meldung steht dann darunter), und während des Aufrufs.
   */
  readonly canConfirm = computed(() => !this.submitting() && this.preview().state !== 'error')

  quantityOf(key: string): number {
    return this.#quantities()[key] ?? 0
  }

  setQuantity(unit: SplitUnit, value: number): void {
    const next = Math.max(0, Math.min(unit.max, value))
    this.#quantities.update(q => ({ ...q, [unit.key]: next }))
    this.#serverErrorKey.set(null)
    this.#triedEmpty.set(false)
  }

  async confirm(): Promise<void> {
    if (!this.canConfirm()) return
    const selection = this.selection()
    if (selection.length === 0) {
      this.#triedEmpty.set(true)
      return
    }
    const order = this.order()
    this.submitting.set(true)
    this.#serverErrorKey.set(null)
    try {
      const result = await this.#orderService.split(order._id, selection)
      this.#dialogRef.close({
        sourceOrderId: result.sourceOrder?._id ?? order._id,
        targetOrderId: result.targetOrder._id,
        targetSequenceNumber: result.targetOrder.dailySequenceNumber,
      })
    } catch (e) {
      // Beide Pfade setzen die Meldung (Muster core#273) — der Dialog bleibt offen.
      if (e instanceof OrderSplitOfflineError) {
        this.#serverErrorKey.set('SPLIT_ORDER.ERROR.OFFLINE')
      } else {
        const err = e as { data?: { code?: unknown }; code?: unknown } | undefined
        this.#serverErrorKey.set(errorKey(err?.data?.code))
      }
    } finally {
      this.submitting.set(false)
    }
  }

  close(): void {
    this.#dialogRef.close()
  }
}
