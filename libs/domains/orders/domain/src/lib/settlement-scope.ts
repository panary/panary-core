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
}

/** Ist dieser Abrechnungskreis synthetisch erzeugt worden (kein Tisch)? */
export function isSyntheticSettlementScope(scope: string | null | undefined): boolean {
  return typeof scope === 'string' && scope.startsWith(SYNTHETIC_SETTLEMENT_SCOPE_PREFIX)
}

/**
 * Der Tischwert als Abrechnungskreis, oder `null`, wenn kein brauchbarer
 * Tischwert vorliegt.
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
 * Der Abrechnungskreis einer Bestellung: Tisch, sonst synthetisch.
 *
 * Wirft nie. Ein Fehler in dieser Ableitung wuerde sonst zum Fiskal-Gate — das
 * Feld ist Pflicht, also waere ohne Wert keine Bestellung mehr aufgebbar. Ein
 * unscharfer Abrechnungskreis ist ein Auswertungsproblem, eine blockierte
 * Kasse ein Betriebsausfall (ADR 0047).
 */
export function deriveSettlementScope(input: SettlementScopeInput): string {
  return settlementScopeFromTable(input.table) ?? syntheticSettlementScope(input)
}

/** Die letzten 8 Zeichen einer ID — der unterscheidende Teil einer uuidv7. */
function tail(id: string | null | undefined): string | null {
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  if (!trimmed) return null
  return trimmed.slice(-8)
}
