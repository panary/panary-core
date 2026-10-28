// Ableitung des Abrechnungskreises (`order.settlementScope`, DSFinV-K
// `ABRECHNUNGSKREIS`).
//
// Der Abrechnungskreis ist die Klammer, ueber die ein Pruefer zusammengehoerende
// Vorgaenge nachvollzieht: alle Bestellungen eines Tisches, die daraus
// entstehenden (ggf. gesplitteten) Belege, Umbuchungen und Stornos tragen
// denselben Wert (DSFinV-K Tz. 2.7.1 und 3.1.2.2). Oesterreich verlangt mit dem
// RKSV-Verrechnungskreis dasselbe Konzept.
//
// Bewusst eine reine Funktion im Domain-Paket und nicht im Hook: Derselbe Wert
// muss am Edge (Stempel beim `create`), im POS (Anzeige/Gruppierung) und in der
// Cloud identisch gelesen werden. Zwei Implementierungen derselben Ableitung
// waeren genau die Drift, die niemandem auffaellt.
//
// 🚫 Die Edge-Migration darf diese Datei NICHT importieren — `migrations/` ist
// ein Asset-Ordner, der einzeln mit `--bundle=false` transpiliert wird; ein
// Domain-Import fiele dort still aus. Die Migration schreibt das Praefix als
// Literal aus und wird per Test dagegen gelockt.

import { OrderStatus } from './order.schema'

/**
 * Reserviertes Praefix fuer synthetisch abgeleitete Abrechnungskreise.
 *
 * Es beantwortet die Frage, die eine spaetere Auswertung stellen wird: Ist
 * dieser Abrechnungskreis am Tisch *gewachsen* oder mangels Tisch *gesetzt*
 * worden? Ohne diese Unterscheidung liest sich ein Thekenbetrieb wie ein
 * Gastro-Betrieb, in dem jeder Gast an einem eigenen Tisch sass.
 *
 * ⚠️ Bekannte Grenze: Ein Tisch, den der Betreiber woertlich `auto:…` nennt,
 * wird dadurch faelschlich als synthetisch gelesen. Das wird bewusst NICHT
 * abgefangen — ein Sonderfall, der solche Tische auf den synthetischen Pfad
 * schickte, zerrisse still die Tisch-Gruppierung, und das waere der teurere
 * Fehler. Die Herkunft ist eine Auswertungsangabe, die Gruppierung ist die
 * fiskalische Klammer.
 */
export const SYNTHETIC_SETTLEMENT_SCOPE_PREFIX = 'auto:'

/**
 * Maximale Laenge eines Abrechnungskreises — die Feldlaenge des
 * DSFinV-K-Feldes `ABRECHNUNGSKREIS` (Zeichen, 50). Identisch mit der Grenze
 * von `order.table`, der Tischwert passt also immer unveraendert hinein.
 */
export const SETTLEMENT_SCOPE_MAX_LENGTH = 50

/** Eingabe der Ableitung — genau die Felder, die beim `create` schon feststehen. */
export type SettlementScopeInput = {
  /** Tischwert der Bestellung, falls gesetzt. Hat Vorrang vor allem anderen. */
  table?: string | null
  /** Standort der Bestellung. Am Edge konstant, in der Cloud unterscheidend. */
  locationId?: string | null
  /** Geschaeftstag der Bestellung (`restrictOrderToBusinessDay` stempelt ihn). */
  businessDayId?: string | null
  /** Vorgangsnummer des Tages (`assignDailySequenceNumber` stempelt sie). */
  dailySequenceNumber?: number | null
  /** Order-ID — letzter Anker, wenn Geschaeftstag und Vorgangsnummer fehlen. */
  orderId?: string | null
  /**
   * Bestellungen desselben Tisches am selben Geschaeftstag, aus denen der
   * Besuchszaehler entsteht (ADR 0063 Nr. 4). Fehlt die Liste, gilt der Tisch
   * als bisher unbesucht — der Edge korrigiert das (ADR 0063 Nr. 2).
   */
  tableOrders?: ReadonlyArray<SettlementScopeOrderState> | null
}

/** Die zwei Felder einer Bestellung, aus denen Besuch und Zustand eines Kreises folgen. */
export type SettlementScopeOrderState = {
  settlementScope?: string | null
  status?: string | null
}

/** Trenner zwischen Tisch-Label und Besuchszaehler: `4#2` ist der zweite Besuch an Tisch 4. */
export const SETTLEMENT_SCOPE_VISIT_SEPARATOR = '#'

/**
 * Nicht-terminale Status: Solange eine Bestellung eines Kreises einen davon
 * traegt, ist der Kreis offen (ADR 0063 Nr. 2). `completed`, `aborted` und
 * `unclaimed` schliessen ihn.
 */
export const OPEN_ORDER_STATUSES: ReadonlyArray<string> = [
  OrderStatus.ACTIVE,
  OrderStatus.PRODUCTION,
  OrderStatus.PRODUCED,
]

/** Traegt die Bestellung einen nicht-terminalen Status? */
export function isOpenOrderStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && OPEN_ORDER_STATUSES.includes(status)
}

/**
 * Ist der Kreis `scope` offen — hat er mindestens eine nicht-terminale Bestellung?
 *
 * Bewusst aus den Bestellungen abgeleitet und nie gespeichert: Ein Statusfeld am
 * Kreis waere eine zweite Quelle derselben Aussage, und an genau der Stelle waeren
 * zwei Kassen verschiedener Meinung (ADR 0063, „Doppelquelle bleibt verboten").
 * Ein Kreis ohne jede Bestellung ist nicht offen.
 */
export function isSettlementScopeOpen(
  scope: string | null | undefined,
  orders: ReadonlyArray<SettlementScopeOrderState>,
): boolean {
  if (typeof scope !== 'string' || !scope) return false
  return orders.some(order => order.settlementScope === scope && isOpenOrderStatus(order.status))
}

/**
 * Zerlegt `<Label>#<n>` in Label und Besuch, sonst `null`.
 *
 * Gierig bis zum LETZTEN `#`: Ein Tisch `Bar#2` ergibt `Bar#2#1` und wird wieder
 * zu Label `Bar#2`, Besuch 1. Ein Kreis eines alten Clients (nur das Label) und
 * ein synthetischer Kreis sind kein Besuch.
 */
export function parseVisitSettlementScope(
  scope: string | null | undefined,
): { label: string; visit: number } | null {
  if (typeof scope !== 'string' || isSyntheticSettlementScope(scope)) return null
  const match = /^(.+)#(\d+)$/.exec(scope)
  if (!match) return null
  const visit = Number(match[2])
  return Number.isSafeInteger(visit) && visit > 0 ? { label: match[1], visit } : null
}

/**
 * Der Kreis eines Tisches mit Besuchszaehler, `<Label>#<n>` (ADR 0063 Nr. 4).
 *
 * Ist ein Besuch des Tisches noch offen, gehoert die Bestellung dazu (der
 * hoechste, falls es mehrere gibt). Sonst beginnt der naechste Besuch: hoechstes
 * bekanntes `n` plus eins. Ein Kreis aus nur dem Label (alter Client) zaehlt als
 * Besuch 0 und wird nicht fortgesetzt — er bleibt so grob, wie er entstanden ist.
 *
 * `null`, wenn kein Tisch vorliegt oder `<Label>#<n>` nicht in 50 Zeichen passt.
 * Gekuerzt wird nie: Zwei Tische mit gleichem Anfang verschmoelzen sonst still
 * zu einem Kreis (ADR 0047 Nr. 3). Der Aufrufer faellt auf den synthetischen
 * Kreis zurueck.
 */
export function visitSettlementScope(
  table: string | null | undefined,
  tableOrders: ReadonlyArray<SettlementScopeOrderState> = [],
): string | null {
  if (typeof table !== 'string') return null
  const label = table.trim()
  if (!label) return null

  let highestVisit = 0
  let highestOpenVisit = 0
  for (const order of tableOrders) {
    const parsed = parseVisitSettlementScope(order.settlementScope)
    if (!parsed || parsed.label !== label) continue
    highestVisit = Math.max(highestVisit, parsed.visit)
    if (isOpenOrderStatus(order.status)) highestOpenVisit = Math.max(highestOpenVisit, parsed.visit)
  }

  const visit = highestOpenVisit || highestVisit + 1
  const scope = `${label}${SETTLEMENT_SCOPE_VISIT_SEPARATOR}${visit}`
  return scope.length <= SETTLEMENT_SCOPE_MAX_LENGTH ? scope : null
}

/** Ist dieser Abrechnungskreis synthetisch erzeugt worden (kein Tisch)? */
export function isSyntheticSettlementScope(scope: string | null | undefined): boolean {
  return typeof scope === 'string' && scope.startsWith(SYNTHETIC_SETTLEMENT_SCOPE_PREFIX)
}

/**
 * Der Tischwert als Abrechnungskreis, oder `null`, wenn kein brauchbarer
 * Tischwert vorliegt.
 *
 * ⚠️ Das ist die Form vor dem Besuchszaehler (ADR 0047 Nr. 3), heute „Besuch 0"
 * eines alten Clients. Neue Kreise baut `visitSettlementScope()` (ADR 0063 Nr. 4).
 *
 * Der Wert wird **unveraendert** uebernommen (nur getrimmt) — kein Praefix.
 * Nur so gilt die Eigenschaft, an der das ganze Feld haengt: zwei Bestellungen
 * desselben Tisches tragen denselben Abrechnungskreis. Ein Praefix wuerde die
 * 50-Zeichen-Grenze des DSFinV-K-Feldes sprengen, sobald ein Tischname sie
 * ausreizt, und muesste dann kuerzen — womit zwei verschiedene Tische still zu
 * einem Abrechnungskreis verschmelzen koennten.
 */
export function settlementScopeFromTable(table: string | null | undefined): string | null {
  if (typeof table !== 'string') return null
  const trimmed = table.trim()
  if (!trimmed) return null
  return trimmed.slice(0, SETTLEMENT_SCOPE_MAX_LENGTH)
}

/**
 * Synthetischer Abrechnungskreis fuer Bestellungen ohne Tisch (Thekenbetrieb).
 *
 * Fachlich ist das der richtige Zuschnitt: Ohne Tisch gibt es nichts zu
 * gruppieren, jede Bestellung ist ihr eigener Abrechnungskreis. Der Wert ist
 * deterministisch aus Standort, Geschaeftstag und Vorgangsnummer gebaut — also
 * aus genau dem Tripel, das eine Bestellung innerhalb einer Kasse eindeutig
 * macht (GoBD Rz. 94).
 *
 * Von den UUIDs geht das **Ende** ein, nicht der Anfang: uuidv7 beginnt mit dem
 * Millisekunden-Zeitstempel, zwei in derselben Millisekunde angelegte Standorte
 * teilten sich also ihre ersten Zeichen. Das Ende ist der Zufallsanteil.
 */
export function syntheticSettlementScope(input: SettlementScopeInput): string {
  const parts = [
    tail(input.locationId) ?? 'noloc',
    tail(input.businessDayId) ?? 'nobd',
    typeof input.dailySequenceNumber === 'number' && Number.isFinite(input.dailySequenceNumber)
      ? String(input.dailySequenceNumber)
      : (tail(input.orderId) ?? 'noseq'),
  ]
  return `${SYNTHETIC_SETTLEMENT_SCOPE_PREFIX}${parts.join('-')}`.slice(0, SETTLEMENT_SCOPE_MAX_LENGTH)
}

/**
 * Der Abrechnungskreis einer Bestellung: Tisch mit Besuch, sonst synthetisch.
 *
 * Synthetisch wird es auch mit Tisch, wenn `<Label>#<n>` die 50 Zeichen
 * sprengt. Der Aufrufer erkennt das an `table` gesetzt und
 * `isSyntheticSettlementScope(...)` wahr und loggt
 * `order.settlement_scope_fallback`.
 *
 * Wirft nie. Ein Fehler in dieser Ableitung wuerde sonst zum Fiskal-Gate — das
 * Feld ist Pflicht, also waere ohne Wert keine Bestellung mehr aufgebbar. Ein
 * unscharfer Abrechnungskreis ist ein Auswertungsproblem, eine blockierte
 * Kasse ein Betriebsausfall (ADR 0047).
 */
export function deriveSettlementScope(input: SettlementScopeInput): string {
  return visitSettlementScope(input.table, input.tableOrders ?? []) ?? syntheticSettlementScope(input)
}

/** Die letzten 8 Zeichen einer ID — der unterscheidende Teil einer uuidv7. */
function tail(id: string | null | undefined): string | null {
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  if (!trimmed) return null
  return trimmed.slice(-8)
}
