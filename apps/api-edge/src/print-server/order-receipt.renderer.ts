// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import {
  computeOrderTax,
  effectiveLineItems,
  fromCents,
  lineItemGrossCents,
  multiplyCents,
  toCents,
  type OrderLineItem,
} from '@panary/orders/domain'
import { buildTseReceiptBlock } from '@panary/tse/domain'
import type { EscposOptions } from './escpos.adapter'
import { formatPrintDate, formatPrintDateTime, formatPrintTime, printTimeZoneForLocation } from './print-date-format'

const COLUMNS_MAP: Record<string, number> = { '58mm': 32, '80mm': 48 }

/**
 * Welche Bon-Variante gedruckt wird (#347).
 *
 * `kitchen` laesst **nur** Filialkopf und TSE-Block weg — Positionen, Nachlaesse
 * und Gesamtsumme sind in beiden Varianten byte-gleich. Die Kueche soll sehen,
 * was der Gast zahlt; der Unterschied ist der Belegcharakter, nicht der Inhalt.
 *
 * Bewusst zwei Varianten und kein zweiter Renderer: Eine zweite Vorlage waere
 * eine Layout-Dopplung, die beim naechsten Positions-Umbau zur Haelfte
 * nachgezogen wird.
 */
export type ReceiptVariant = 'kitchen' | 'full'

/**
 * Bon-Variante fuer eine Druckerrolle — die **einzige** Stelle, an der der
 * Bestands-Default sitzt.
 *
 * 🚨 Ein Drucker ohne `role` ist `both`, nie `kitchen`. Bestandsinstallationen
 * haben das Feld nicht; wuerde es hier als `kitchen` durchfallen, verloeren sie
 * beim Update still Filialkopf und TSE-Block vom Kundenbeleg — ohne Fehler, ohne
 * Log, sichtbar erst auf Papier. Deshalb ist `kitchen` der einzige Wert, der die
 * Kuechenvariante ausloest, und jeder andere (inkl. `undefined`, Tippfehler und
 * kuenftiger Rollen) faellt auf den Vollbon zurueck.
 */
export function receiptVariantForRole(role: string | undefined | null): ReceiptVariant {
  return role === 'kitchen' ? 'kitchen' : 'full'
}

export interface OrderReceiptOptions extends EscposOptions {
  /** Default `full` — siehe `receiptVariantForRole`. */
  variant?: ReceiptVariant
}

/**
 * Rendert einen Bestellbon direkt mit der Encoder-API.
 * Volle Kontrolle: table() mit Callbacks, font-Wechsel in Zellen, box(), etc.
 */
export function renderOrderReceipt(
  order: any,
  location: any,
  options: OrderReceiptOptions = {},
  deviceName?: string,
): Uint8Array {
  const { paperWidth = '80mm', variant = 'full' } = options
  const cols = COLUMNS_MAP[paperWidth] || 48

  // Spaltenbreiten
  const priceW = 12
  const nameW = cols - priceW
  const subNameW = cols - priceW - 4 // 4 Zeichen Einrückung

  const settings = location?.settings || {}
  // Alle Zeitangaben auf dem Bon laufen ueber die Zeitzone der Filiale — der
  // Prozess steht im Container auf UTC (#274).
  const timeZone = printTimeZoneForLocation(location)
  const drinkPrice = settings?.genericProductSettings?.generalDrinkPrice ?? 0
  const sideDishPrice = settings?.genericProductSettings?.generalSideDishPrice ?? 0

  const enc = new ReceiptPrinterEncoder({ columns: cols, language: 'esc-pos' })
  enc.initialize()

  // ─────────────────────────────────────────
  // FILIALKOPF (nur Vollbon)
  // ─────────────────────────────────────────
  // Zurück seit #347: Name und Anschrift des leistenden Unternehmers sind auf
  // einem Kundenbeleg Pflichtangabe (§146a AO, ADR 0007). Zwischen #342 und #347
  // fehlten sie auf JEDEM Ausdruck, weil eine Vorlage beide Zwecke bediente —
  // erst #346 (Render je Zieldrucker) und die Druckerrolle machen die
  // Fallunterscheidung möglich. Auf dem Küchenbon bleibt der Kopf weg: dort ist
  // die eigene Adresse sinnlos und kostet nur Papier.
  //
  // Nicht der alte Block von vor #342 — der stellte die Polsterung vor die
  // Font-Umschaltung und druckte die Straßenzeile 51 Dots zu weit rechts.
  appendLocationHeader(enc, location, variant)

  // ─────────────────────────────────────────
  // BESTELLNUMMER + BESTELLART (Badge)
  // ─────────────────────────────────────────
  enc.align('center').line('Bestellnummer')
  enc.align('center').bold(true).size(4, 4).line(`${order.dailySequenceNumber}`).size(1, 1).bold(false)

  // Bestellart als Badge (invertiert: weiß auf schwarz)
  const dineLabel = order.dineLocation === 'dine-in' ? 'INNEN' : 'AUSSEN'
  enc.align('center').size(2, 2).invert(true).text(dineLabel).invert(false).size(1, 1)
  enc.newline()

  // Abholzeit direkt unter dem Badge — das ist die Angabe, die die Küche braucht,
  // und deshalb die groesste Zeile nach der Bestellnummer. Quelle ist
  // `estimatedDuration` (Minuten) auf `recordingDate`; `targetCompletionAt` steht
  // zwar im Schema, wird aber nirgends geschrieben (#342). Dieselbe Rechnung wie
  // `order.service.ts:302`.
  const pickup = pickupLabel(order, timeZone)
  enc.align('center').bold(true).size(pickupWidth(pickup, cols), 3).line(pickup).size(1, 1).bold(false)

  enc.align('left')
  enc.newline()

  // Tisch / Pager
  if (order.table) {
    enc.align('center').bold(true).size(2, 2).line(`Tisch: ${order.table}`).size(1, 1).bold(false).align('left')
  }
  if (order.pager) {
    enc.align('center').bold(true).size(2, 2).line(`Pager: ${order.pager}`).size(1, 1).bold(false).align('left')
  }

  // ─────────────────────────────────────────
  // META-INFOS
  // ─────────────────────────────────────────
  const creationDate = new Date(order.recordingDate)

  enc.newline()
  enc.rule({ style: 'single' })

  enc.font('B')
  if (deviceName) enc.line(`Kasse: ${deviceName}`)
  enc.line(`Datum: ${formatPrintDate(creationDate, timeZone)}`)
  // „Bestellzeit" statt „Uhrzeit": Seit #342 trägt der Bon ZWEI Zeitangaben —
  // die Abholzeit gross unter dem Badge und hier den Registrierungszeitpunkt als
  // Beleg-Metadatum. Ein unspezifisches „Uhrzeit" waere zwischen beiden nicht
  // unterscheidbar.
  enc.line(`Bestellzeit: ${formatPrintTime(creationDate, timeZone)} Uhr`)
  enc.font('A')

  // Personalessen / Firmenkunde / Storno — hervorgehoben
  const hasExtra = order.staffPaymentInfo || order.customerPaymentInfo || order.cancellation
  if (hasExtra) {
    enc.newline()
    if (order.staffPaymentInfo) {
      enc
        .bold(true)
        .text('Personalessen: ')
        .bold(false)
        .invert(true)
        .text(order.staffPaymentInfo.userName)
        .invert(false)
        .newline()
    }
    if (order.customerPaymentInfo) {
      enc
        .bold(true)
        .text('Firmenkunde: ')
        .bold(false)
        .invert(true)
        .text(order.customerPaymentInfo.customerName)
        .invert(false)
        .newline()
    }
    if (order.cancellation) {
      enc.newline()
      enc.invert(true).bold(true).text(' STORNIERT ').bold(false).invert(false).newline()
      enc.font('B')
      if (order.cancellation.reason) enc.line(`Grund: ${order.cancellation.reason}`)
      if (order.cancellation.canceledAt) {
        const cancelDate = new Date(order.cancellation.canceledAt)
        enc.line(`Storniert am: ${formatPrintDateTime(cancelDate, timeZone)}`)
      }
      enc.font('A')
    }
  }

  enc.newline()

  // ─────────────────────────────────────────
  // KOMBINATIONEN
  // ─────────────────────────────────────────
  const combinations = getCombinations(order)
  for (let idx = 0; idx < combinations.length; idx++) {
    const combo = combinations[idx]
    enc.newline(2)
    enc
      .bold(true)
      .height(2)
      .line(`Kombination ${idx + 1}`)
      .height(1)
      .bold(false)
    enc.rule({ style: 'single' })

    for (const article of combo) {
      appendArticle(enc, article, nameW, priceW, subNameW, drinkPrice, sideDishPrice)
    }

    const comboPrice = calcComboPrice(combo)
    enc.table(
      [
        { width: nameW, align: 'left' },
        { width: priceW, align: 'right' },
      ],
      [
        ['', '--------'],
        ['', (e: any) => e.bold(true).text(fmtEur(comboPrice)).bold(false)],
      ],
    )
  }

  // ─────────────────────────────────────────
  // EINZELARTIKEL
  // ─────────────────────────────────────────
  const unbundled = getUnbundledLineItems(order)
  unbundled.sort((a: any, b: any) => (a.topic || '').toLowerCase().localeCompare((b.topic || '').toLowerCase()))

  let lastTopic: string | null = null
  for (const article of unbundled) {
    if (lastTopic !== article.topic) {
      lastTopic = article.topic
      enc.newline(2)
      enc
        .bold(true)
        .height(2)
        .line((lastTopic || '').toUpperCase())
        .height(1)
        .bold(false)
      enc.rule({ style: 'single' })
    }
    appendArticle(enc, article, nameW, priceW, subNameW, drinkPrice, sideDishPrice)
  }

  // ─────────────────────────────────────────
  // NACHLÄSSE + GESAMTSUMME
  // ─────────────────────────────────────────
  // Reihenfolge ist bewusst: `calcTotalWithDiscount` läuft VOR den Nachlasszeilen,
  // weil `computeOrderTax` `computedAmountCents` je appliedDiscount als Seiteneffekt
  // schreibt. So drucken Nachlasszeile und „Gesamt" garantiert aus demselben Lauf —
  // auch bei einer Order, deren persistierte Beträge noch fehlen.
  const totalPrice = calcTotalWithDiscount(order)
  appendDiscountLines(enc, order, nameW, priceW)

  enc.newline()
  enc.rule({ style: 'single' })
  enc.table(
    [
      { width: Math.floor(cols * 0.55), align: 'left' },
      { width: Math.floor(cols * 0.45), align: 'right' },
    ],
    [
      [
        (e: any) => e.bold(true).size(2, 2).text('Gesamt').size(1, 1).bold(false),
        (e: any) => e.bold(true).size(2, 2).text(fmtEur(totalPrice)).size(1, 1).bold(false),
      ],
    ],
  )
  enc.rule({ style: 'single' })

  // ─────────────────────────────────────────
  // TSE-SIGNATUR (KassenSichV Belegausgabepflicht)
  // ─────────────────────────────────────────
  // Nur auf dem Vollbon: Die Signatur gehört zum Beleg, den der Gast bekommt.
  // In der Küche ist sie eine halbe Bonlänge QR-Code ohne Adressat.
  if (variant === 'full') appendTseBlock(enc, order)

  // ─────────────────────────────────────────
  // FUSSBEREICH
  // ─────────────────────────────────────────
  enc.newline(6)
  enc.cut()

  return enc.encode()
}

// Filialkopf des Vollbons: Name, Anschrift, Telefon — zentriert, klein gesetzt.
// No-Op ausser dem fuehrenden Umbruch, wenn die Variante `kitchen` ist.
//
// Der fuehrende `newline()` ist Pflicht, nicht Kosmetik, und steht deshalb VOR
// der Variantenpruefung: Ohne ihn stellt der Composer die Zentrier-Polsterung der
// ersten Zeile VOR das `ESC @` aus `initialize()` — die Leerzeichen liefen dann
// noch im Zustand des vorangegangenen Druckauftrags. Der Kuechenbon beginnt
// dadurch unveraendert mit genau einer Leerzeile vor „Bestellnummer".
function appendLocationHeader(enc: any, location: any, variant: ReceiptVariant): void {
  enc.newline()
  if (variant !== 'full') return

  const name = typeof location?.name === 'string' ? location.name.trim() : ''
  const zeilen = headerDetailLines(location)
  // Eine Filiale ganz ohne Stammdaten bekommt keinen leeren Kopf, sondern gar
  // keinen — und damit denselben Vorlauf wie der Kuechenbon.
  if (!name && zeilen.length === 0) return

  if (name) enc.align('center').bold(true).line(name).bold(false)

  // 🚨 Der Font-Wechsel muss mit dem Umbruch der VORZEILE abgeschlossen sein —
  // sonst sitzt die zentrierte Zeile nicht mittig. Gemessen an
  // @point-of-sale/receipt-printer-encoder@3.0.3 (#342): Der Composer reiht eine
  // zentrierte Zeile als `[space(n), ...style, ...inhalt]`, die Polsterung steht
  // also VOR der Font-Umschaltung derselben Zeile. `n` rechnet er in den Spalten
  // des NEUEN Fonts (Font B: 48 → 64), gedruckt werden die Leerzeichen aber noch
  // in der Zelle des alten (12 statt 9 Dots) — die Zeile rutscht um ein Drittel
  // der Polsterung nach rechts. Genau daran krankte der alte Kopf vor #342: seine
  // Strassenzeile stand 51 Dots zu weit rechts, die beiden darunter fluchteten,
  // weil Font B dort schon aktiv war. `font()` wirft mitten in einer Zeile, der
  // Wechsel braucht also einen eigenen Umbruch; die Leerzeile ist der Preis.
  // Dieselbe Sequenz wie im fiskalischen Beleg (`receipt-escpos.renderer.ts`).
  if (zeilen.length > 0) {
    enc.align('center').font('B').newline()
    for (const zeile of zeilen) enc.line(zeile)
    enc.font('A')
  }

  enc.align('left')
  enc.newline()
}

// Anschrift und Telefon als druckfertige Zeilen. Leere Bestandteile fallen weg,
// statt eine Zeile aus Leerzeichen oder ein nacktes „Tel." zu erzeugen.
function headerDetailLines(location: any): string[] {
  const zeilen: string[] = []
  const addr = location?.address
  const str = typeof addr?.street === 'string' ? addr.street.trim() : ''
  if (str) zeilen.push(str)

  const ort = [addr?.postalCode, addr?.city]
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' ')
  if (ort) zeilen.push(ort)

  const tel = typeof location?.phone === 'string' ? location.phone.trim() : ''
  if (tel) zeilen.push(`Tel. ${tel}`)

  return zeilen
}

// Nachlasszeilen zwischen Positionen und „Gesamt" — sie sind eine Minderung genau
// dieses Blocks: die Positionen tragen unrabattierte Summen (`lineItemGrossCents`),
// „Gesamt" ist rabattiert (`computeOrderTax`). Ohne die Zeile bliebe die Differenz
// auf dem Bon unerklärt (#235 — derselbe Befund wie #228 auf dem Beleg).
//
// Betrag aus `computedAmountCents`, dem von der Engine tatsächlich abgezogenen
// Wert — nicht aus `valuePercent`/`valueCents`: Die Definition überzeichnet den
// Abzug, sobald die Engine klemmt (z. B. Deckelung auf die Positionssumme), und
// der Bon rechnete sich dann nicht mehr gegen sein eigenes „Gesamt" auf.
function appendDiscountLines(enc: any, order: any, nameW: number, priceW: number): void {
  for (const d of order?.appliedDiscounts ?? []) {
    const cents = Math.max(0, Math.round(d?.computedAmountCents ?? 0))
    // Wirkungslose Einträge unterdrücken — eine Zeile über 0,00 EUR erklärt keine Differenz.
    if (cents === 0) continue
    const name = d?.name?.trim() || 'Nachlass'
    enc.table(
      [
        { width: nameW, align: 'left' },
        { width: priceW, align: 'right' },
      ],
      [[`Nachlass: ${name}`, fmtEur(-fromCents(cents))]],
    )
  }
}

// Rendert den TSE-Signaturblock aus `order.tse` (signiert → Signatur + QR;
// Ausfall → §146a-Hinweis). No-Op ohne TSE-Info.
function appendTseBlock(enc: any, order: any): void {
  const tse = order?.tse
  if (!tse || typeof tse !== 'object') return
  const block = buildTseReceiptBlock(tse)
  if (!block) return

  enc.newline()
  enc.font('B').align('left')
  enc.bold(true).line(block.title).bold(false)
  for (const row of block.rows) {
    enc.line(`${row.label}: ${row.value}`)
  }
  if (block.qrPayload) {
    enc.align('center').qrcode(block.qrPayload, { model: 2, size: 5, errorlevel: 'm' }).align('left')
  }
  if (block.note) {
    enc.bold(true).line(block.note).bold(false)
  }
  enc.font('A')
}

// Abholzeit fuer die grosse Zeile unter dem Bestellart-Badge (#342).
//
// Quelle ist `estimatedDuration` — Minuten, gesetzt aus der Kachelauswahl des
// Bestelldialogs. `Order.targetCompletionAt` steht zwar im Schema und in der
// Migration, wird aber nirgends im Produktivcode geschrieben oder gelesen; wer
// die Abholzeit dort sucht, liest ein totes Feld.
//
// `estimatedDuration === 0` bedeutet „sofort" — abgestimmt, statt ein weiteres
// Feld einzufuehren. Auf BESTANDSDATEN ist das nicht unterscheidbar von „nie
// gefragt": dort kann `SOFORT` stehen, wo nie eine Zeit gewaehlt wurde.
//
// Formatierung ausschliesslich ueber `formatPrintTime` — `toLocale*` ohne Zone
// druckt im Container UTC (ADR 0035, Vorfall #274).
function pickupLabel(order: any, timeZone: string): string {
  const minutes = Number(order?.estimatedDuration)
  if (!Number.isFinite(minutes) || minutes <= 0) return 'SOFORT'

  const recorded = new Date(order.recordingDate)
  if (Number.isNaN(recorded.getTime())) return 'SOFORT'

  return `Abholung ${formatPrintTime(new Date(recorded.getTime() + minutes * 60_000), timeZone)}`
}

// Groesste Zeichenbreite, bei der die Zeile noch in EINE Zeile passt.
//
// Gemessen: `Abholung 12:15` sind 14 Zeichen. Auf 80 mm (48 Spalten) traegt
// dreifache Breite 16 Spalten — passt. Auf 58 mm (32 Spalten) waeren es 10, die
// Zeile braeche in „Abholung" / „12:15" um. Die Hoehe bleibt davon unberuehrt:
// Sie ist es, die den Bon aus zwei Metern lesbar macht, und sie kostet keine
// Spalten. `SOFORT` passt in beiden Breiten dreifach.
function pickupWidth(label: string, cols: number): number {
  return label.length * 3 <= cols ? 3 : 2
}

// ─── Artikel-Rendering mit voller Encoder-Kontrolle ───

function appendArticle(
  enc: any,
  article: any,
  nameW: number,
  priceW: number,
  subNameW: number,
  drinkPrice: number,
  sideDishPrice: number,
): void {
  const prefix = namePrefix(article)
  const name = `${article.amount}x ${prefix}${article.name}`

  // Hauptartikel — Produkt fett, Preis fett, in einer Tabellenzeile
  const price = calcArticlePrice(article)

  enc.table(
    [
      { width: nameW, align: 'left' },
      { width: priceW, align: 'right' },
    ],
    [[(e: any) => e.bold(true).text(name).bold(false), (e: any) => e.bold(true).text(fmtEur(price)).bold(false)]],
  )

  // FIXED_PROPORTIONAL: Komponenten sind im Festpreis enthalten → keine Aufschläge
  // ausweisen (sonst wirkt der Bon teurer als der fakturierte Festpreis).
  const isFixed = article.bundlePricingMode === 'FIXED_PROPORTIONAL'

  // Menü-Beilage & Getränk — Font B, eingerückt
  if (article.isMenu) {
    if (article.menuSideDish) {
      appendMenuComponentLine(enc, article, article.menuSideDish, sideDishPrice, isFixed, subNameW, priceW)
    }
    if (article.menuDrink) {
      appendMenuComponentLine(enc, article, article.menuDrink, drinkPrice, isFixed, subNameW, priceW)
    }
  }

  // Modifiers — Font B, eingerückt. Bei FIXED sind Menü-Bestandteile inklusive →
  // kein Einzelpreis (der Festpreis steht oben).
  appendModifierLines(enc, article, isFixed, subNameW, priceW)
}

// Menü-Beilage/-Getränk als SUB-Zeile. Der Aufpreis (Positionspreis − General-
// Preis) zählt PRO Menü — dieselbe Skalierung wie die Preis-Engine
// (`lineGrossCents`: component.amount × line.amount, Entscheidung 2026-07-04).
// Ausgewiesen wird der mengen-skalierte Gesamtaufpreis (wie Hauptzeile und
// Modifier-Zeilen) — ein einmaliger Aufpreis passt bei Menge > 1 nicht zur
// Zeilensumme.
function appendMenuComponentLine(
  enc: any,
  article: any,
  component: any,
  generalPrice: number,
  isFixed: boolean,
  subNameW: number,
  priceW: number,
): void {
  const perUnitCents = isFixed ? 0 : Math.max(0, toCents(component.price ?? 0) - toCents(generalPrice))
  const units = (component.amount ?? 1) * (article.amount ?? 1)
  const extraCents = multiplyCents(perUnitCents, units)
  enc.font('B')
  enc.table(
    [
      { width: subNameW, marginLeft: 4, align: 'left' },
      { width: priceW, align: 'right' },
    ],
    [[`+ ${component.name}`, extraCents > 0 ? fmtEur(fromCents(extraCents)) : '']],
  )
  enc.font('A')
}

function appendModifierLines(enc: any, article: any, isFixed: boolean, subNameW: number, priceW: number): void {
  if (article.modifiers?.length > 0) {
    enc.font('B')
    for (const mod of article.modifiers) {
      let amount = mod.amount
      let modName = mod.name
      if (mod.amount === -1) {
        amount = 1
        modName = `OHNE ${modName}`
      }
      // Betrag ausweisen, wenn der Modifier den Zeilenpreis bewegt — auch bei
      // ABZUG (entfernbare Zutat mit negativem `priceAdjustment`). Bedingung
      // spiegelt `modifierGrossCents` aus der Preis-Engine: `amount < 0` ist der
      // preisneutrale OHNE-Marker und bleibt ohne Betrag, sonst rechnete sich
      // der Bon nicht gegen die Summe auf.
      const modPrice = !isFixed && mod.amount > 0 && mod.price !== 0 ? fmtEur(mod.price * mod.amount) : ''
      enc.table(
        [
          { width: subNameW, marginLeft: 4, align: 'left' },
          { width: priceW, align: 'right' },
        ],
        [[`${amount}x ${modName}`, modPrice]],
      )
    }
    enc.font('A')
  }
}

// ─── Hilfsfunktionen ───

function namePrefix(article: any): string {
  const a = article.acronym ?? ''
  const i = article.index != null ? article.index.toString() : ''
  return a && i ? `(${a} ${i}) ` : ''
}

function fmtEur(price: number): string {
  return `${price.toFixed(2).replace('.', ',')} EUR`
}

function round(v: number): number {
  return parseFloat(v.toFixed(2))
}

// Zeilen-/Kombipreise über die geteilte Cents-Quelle `lineItemGrossCents`
// (@panary/orders/domain) — dieselben Brutto-Atome wie computeOrderTax
// (taxSnapshot/payment) und die POS-Anzeige (Entscheidung 2026-07-04). Die
// frühere Float-Nachbildung (General-Preise statt Positionspreise, Menü-
// Aufpreise nicht mengen-skaliert) entfällt. Bon-Artikel kommen als Roh-JSON,
// daher Pflichtfelder defensiv auffüllen.
function toLineItem(article: any): OrderLineItem {
  return { ...article, amount: article.amount ?? 1, modifiers: article.modifiers ?? [] } as OrderLineItem
}

function calcArticlePrice(article: any): number {
  return fromCents(lineItemGrossCents(toLineItem(article)))
}

function calcComboPrice(combo: any[]): number {
  let totalCents = 0
  for (const a of combo) totalCents += lineItemGrossCents(toLineItem(a))
  return fromCents(totalCents)
}

// Kanonische Gesamtsumme über `computeOrderTax` (@panary/orders/domain) — dieselbe
// Engine, die taxSnapshot + payment.totalAmount erzeugt. Damit stimmt der Bon-Betrag
// garantiert mit dem fakturierten Betrag überein und behandelt FIXED-Menüs, das
// Komponenten-Modell sowie `appliedDiscounts` korrekt. (Das früher hier genannte
// `order.discount` ist seit ADR 0030 abgeschafft — es gibt nur noch eine Rabattquelle.)
function calcTotalWithDiscount(order: any): number {
  return round(computeOrderTax(order).brutto)
}

// 🚨 Beide Leser gehen ueber `effectiveLineItems` und NICHT ueber
// `order.lineItems`: Nach einem Split (panary/panary-core#349) stehen die
// abgegebenen Mengen weiter im Array — die Quellzeile bleibt per A5
// unveraendert —, gehoeren aber nicht mehr auf diesen Bon. Ohne die Ableitung
// druckte die Quelle 5 Stueck und `computeOrderTax` berechnete 2: Positionen
// und Summe stuenden auf demselben Beleg im Widerspruch, ohne Fehlermeldung.
function getCombinations(order: any): any[][] {
  const bundles = new Map<number, any[]>()
  for (const item of effectiveLineItems(order)) {
    if (item.bundleNumber !== undefined && item.bundleNumber !== null) {
      if (!bundles.has(item.bundleNumber)) bundles.set(item.bundleNumber, [])
      bundles.get(item.bundleNumber)!.push(item)
    }
  }
  return Array.from(bundles.values())
}

function getUnbundledLineItems(order: any): any[] {
  return effectiveLineItems(order).filter((item: any) => item.bundleNumber === undefined || item.bundleNumber === null)
}
