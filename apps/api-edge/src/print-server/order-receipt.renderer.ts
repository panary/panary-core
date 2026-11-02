import {
  amountPrefix,
  computeOrderTax,
  effectiveLineItems,
  fromCents,
  groupModifiersByComponent,
  hasComponentModifiers,
  lineItemGrossCents,
  modifierLineGrossCents,
  modifiersCountPerUnit,
  multiplyCents,
  toCents,
  type OrderLineItem,
} from '@panary/orders/domain'
import { buildTseReceiptBlock } from '@panary/tse/domain'
import { createEscposEncoder, type EscposOptions } from './escpos.adapter'
import { formatPrintDate, formatPrintDateTime, formatPrintTime, printTimeZoneForLocation } from './print-date-format'

const COLUMNS_MAP: Record<string, number> = { '58mm': 32, '80mm': 48 }

/**
 * Welche Bon-Variante gedruckt wird (#347).
 *
 * `kitchen` ersetzt den Filialkopf durch die Systemzeile „Panary-Bestellsystem"
 * (#1257) und laesst den TSE-Block weg — ab „Bestellnummer" sind Positionen,
 * Nachlaesse und Gesamtsumme in beiden Varianten byte-gleich. Die Kueche soll
 * sehen, was der Gast zahlt; der Unterschied ist der Belegcharakter, nicht der
 * Inhalt.
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
  /**
   * Nachbestellung im Kreis des Tisches (ADR 0063 Nr. 7, core#1140): Die Bestellung traegt eine
   * Referenz `Transaktion`. Der Aufrufer liest sie, der Renderer bleibt eine reine Funktion.
   */
  followUp?: boolean
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
  const { paperWidth = '80mm', variant = 'full', encoding, followUp = false } = options
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
  // 🚨 `!== false`, nicht Truthiness (#1258): Bestandsfilialen tragen das Feld nicht
  // und muessen weiter `EUR` drucken. Der Default „an" sitzt nur hier.
  const showCurrency = settings?.receiptSettings?.showCurrency !== false

  const enc = createEscposEncoder(cols, encoding)
  enc.initialize()

  // ─────────────────────────────────────────
  // FILIALKOPF (nur Vollbon)
  // ─────────────────────────────────────────
  // Zurück seit #347: Name und Anschrift des leistenden Unternehmers sind auf
  // einem Kundenbeleg Pflichtangabe (§146a AO, ADR 0007). Zwischen #342 und #347
  // fehlten sie auf JEDEM Ausdruck, weil eine Vorlage beide Zwecke bediente —
  // erst #346 (Render je Zieldrucker) und die Druckerrolle machen die
  // Fallunterscheidung möglich. Auf dem Küchenbon steht statt der Adresse nur
  // die kleine Systemzeile „Panary-Bestellsystem" (#1257): dort ist die eigene
  // Adresse sinnlos und kostet nur Papier.
  //
  // Nicht der alte Block von vor #342 — der stellte die Polsterung vor die
  // Font-Umschaltung und druckte die Straßenzeile 51 Dots zu weit rechts.
  appendLocationHeader(enc, location, variant)

  // ─────────────────────────────────────────
  // BESTELLNUMMER + BESTELLART (Badge)
  // ─────────────────────────────────────────
  enc.align('center').line('Bestellnummer')
  enc.align('center').bold(true).size(4, 4).line(`${order.dailySequenceNumber}`).size(1, 1).bold(false)

  // Bestellart — gross, aber nicht mehr invertiert (#1257): Der schwarze Balken
  // zog mehr Blick als die Bestellnummer. Invertiert bleiben nur die Sonderfaelle
  // Personalessen, Firmenkunde und STORNIERT, die auffallen sollen.
  const dineLabel = order.dineLocation === 'dine-in' ? 'INNEN' : 'AUSSEN'
  enc.align('center').size(2, 2).text(dineLabel).size(1, 1)
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

  // Tisch / Pager. Bei einer Nachbestellung sagt die Kopfzeile beides: Die Kueche kocht nur die
  // neuen Positionen und bringt sie an den Tisch, der schon isst (core#1140). Doppelte Breite nur,
  // solange die Zeile passt. Passt sie auch einfach breit nicht (langes Tisch-Label auf 58 mm),
  // stehen „Nachbestellung" und der Tisch in zwei Zeilen — ein Umbruch mitten im Label waere
  // schlechter lesbar als beides.
  const followUpHead = order.table && followUp ? `Nachbestellung · Tisch ${order.table}` : null
  if (followUpHead && followUpHead.length <= cols) {
    const width = followUpHead.length * 2 <= cols ? 2 : 1
    enc.align('center').bold(true).size(width, 2).line(followUpHead).size(1, 1).bold(false).align('left')
  } else if (followUpHead) {
    const tableLine = `Tisch: ${order.table}`
    const tableWidth = tableLine.length * 2 <= cols ? 2 : 1
    enc.align('center').bold(true).size(1, 2).line('Nachbestellung').size(1, 1).bold(false)
    enc.align('center').bold(true).size(tableWidth, 2).line(tableLine).size(1, 1).bold(false).align('left')
  } else if (order.table) {
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

  // „Bestellzeit" statt „Uhrzeit": Seit #342 trägt der Bon ZWEI Zeitangaben —
  // die Abholzeit gross unter dem Badge und hier den Registrierungszeitpunkt als
  // Beleg-Metadatum. Ein unspezifisches „Uhrzeit" waere zwischen beiden nicht
  // unterscheidbar.
  const meta = [
    ...(deviceName ? [`Kasse: ${deviceName}`] : []),
    `Datum: ${formatPrintDate(creationDate, timeZone)}`,
    `Bestellzeit: ${formatPrintTime(creationDate, timeZone)} Uhr`,
  ]
  appendMetaLine(enc, meta, cols)

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
      appendArticle(enc, article, nameW, priceW, subNameW, drinkPrice, sideDishPrice, showCurrency)
    }

    // Die Trennlinie folgt der Betragsbreite — mit und ohne `EUR` (#1258).
    const comboText = fmtAmount(calcComboPrice(combo), showCurrency)
    enc.table(
      [
        { width: nameW, align: 'left' },
        { width: priceW, align: 'right' },
      ],
      [
        ['', '-'.repeat(comboText.length)],
        ['', (e: any) => e.bold(true).text(comboText).bold(false)],
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
    appendArticle(enc, article, nameW, priceW, subNameW, drinkPrice, sideDishPrice, showCurrency)
  }

  // ─────────────────────────────────────────
  // NACHLÄSSE + GESAMTSUMME
  // ─────────────────────────────────────────
  // Reihenfolge ist bewusst: `calcTotalWithDiscount` läuft VOR den Nachlasszeilen,
  // weil `computeOrderTax` `computedAmountCents` je appliedDiscount als Seiteneffekt
  // schreibt. So drucken Nachlasszeile und „Gesamt" garantiert aus demselben Lauf —
  // auch bei einer Order, deren persistierte Beträge noch fehlen.
  const totalPrice = calcTotalWithDiscount(order)
  appendDiscountLines(enc, order, nameW, priceW, showCurrency)

  // In Positionsgroesse (#1257): fett, einfach breit und hoch. Die doppelte Summe
  // stand groesser als die Positionen, die die Kueche eigentlich lesen muss.
  const totalText = fmtAmount(totalPrice, showCurrency)
  enc.newline()
  enc.rule({ style: 'single' })
  enc.table(
    [
      { width: cols - totalText.length, align: 'left' },
      { width: totalText.length, align: 'right' },
    ],
    [[(e: any) => e.bold(true).text('Gesamt').bold(false), (e: any) => e.bold(true).text(totalText).bold(false)]],
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
// Der Kuechenbon bekommt stattdessen `appendKitchenHeader`.
//
// Der fuehrende `newline()` ist Pflicht, nicht Kosmetik: Ohne ihn stellt der
// Composer die Zentrier-Polsterung der ersten Zeile VOR das `ESC @` aus
// `initialize()` — die Leerzeichen liefen dann noch im Zustand des
// vorangegangenen Druckauftrags.
function appendLocationHeader(enc: any, location: any, variant: ReceiptVariant): void {
  if (variant === 'kitchen') {
    appendKitchenHeader(enc)
    return
  }
  enc.newline()

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

const KITCHEN_HEADER = 'Panary-Bestellsystem'

// Kopf des Kuechenbons (#1257): eine kleine, zentrierte Systemzeile in Font B.
//
// Beide Font-Wechsel brauchen eine eigene Zeile (Falle siehe oben). Der Wechsel
// auf B sitzt deshalb in der fuehrenden Leerzeile, die ohnehin `initialize()`
// abschliesst, und der Rueckwechsel auf A in der Leerzeile vor „Bestellnummer".
// Ohne die zweite rechnete der Composer die Polsterung von „Bestellnummer" in
// Font-A-Spalten, gedruckt wuerde sie aber noch in 9-Dot-Zellen — die Zeile
// saesse links der Mitte.
function appendKitchenHeader(enc: any): void {
  enc.font('B').newline()
  enc.align('center').line(KITCHEN_HEADER)
  enc.font('A').align('left').newline()
}

// Kasse, Datum und Bestellzeit in EINER Zeile, links/Mitte/rechts (#1257).
//
// Font B wird VOR der Tabelle gesetzt — `font()` wirft in Tabellenzellen. Die
// Spaltenzahl ist dann die des Font-B-Composers: `cols / 42 * 56`, also 64 auf
// 80 mm und abgerundet 42 auf 58 mm. Linke und rechte Spalte sind gleich breit,
// sonst saesse die Mitte nicht in der Papiermitte. Passt die Zeile nicht, fallen
// die Angaben auf je eine Zeile zurueck wie vor #1257 — auf 58 mm ist das mit
// Kassenname der Regelfall.
function appendMetaLine(enc: any, meta: string[], cols: number): void {
  const fontBCols = Math.floor((cols / 42) * 56)
  enc.font('B')
  const first = meta[0]
  const last = meta[meta.length - 1]
  if (meta.length === 2 && first.length + 1 + last.length <= fontBCols) {
    enc.table(
      [
        { width: fontBCols - last.length, align: 'left' },
        { width: last.length, align: 'right' },
      ],
      [[first, last]],
    )
  } else if (meta.length === 3) {
    const w = Math.max(first.length, last.length)
    const middle = fontBCols - 2 * w
    if (middle >= meta[1].length + 2) {
      enc.table(
        [
          { width: w, align: 'left' },
          { width: middle, align: 'center' },
          { width: w, align: 'right' },
        ],
        [meta],
      )
    } else {
      for (const zeile of meta) enc.line(zeile)
    }
  } else {
    for (const zeile of meta) enc.line(zeile)
  }
  enc.font('A')
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
function appendDiscountLines(enc: any, order: any, nameW: number, priceW: number, showCurrency: boolean): void {
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
      [[`Nachlass: ${name}`, fmtAmount(-fromCents(cents), showCurrency)]],
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
  showCurrency: boolean,
): void {
  const prefix = namePrefix(article)
  const name = `${amountPrefix(article.amount)}${prefix}${article.name}`

  // Hauptartikel — Produkt fett, Preis fett, in einer Tabellenzeile
  const price = calcArticlePrice(article)

  enc.table(
    [
      { width: nameW, align: 'left' },
      { width: priceW, align: 'right' },
    ],
    [
      [
        (e: any) => e.bold(true).text(name).bold(false),
        (e: any) => e.bold(true).text(fmtAmount(price, showCurrency)).bold(false),
      ],
    ],
  )

  // FIXED_PROPORTIONAL: Komponenten sind im Festpreis enthalten → keine Aufschläge
  // ausweisen (sonst wirkt der Bon teurer als der fakturierte Festpreis).
  const isFixed = article.bundlePricingMode === 'FIXED_PROPORTIONAL'

  // Modifier einer Beilage oder eines Getränks stehen unter ihrer Komponente (#1127), für `full` und `kitchen`
  // gleich. `components[]` druckt der Bon nicht, deren Modifier bleiben deshalb am Hauptartikel.
  const groups = groupModifiersByComponent(article, { components: false })
  if (article.isMenu && hasComponentModifiers(groups)) {
    appendModifierLines(enc, article, groups.main, isFixed, subNameW, priceW, showCurrency)
    if (article.menuSideDish) {
      appendMenuComponentLine(
        enc,
        article,
        article.menuSideDish,
        sideDishPrice,
        isFixed,
        subNameW,
        priceW,
        showCurrency,
      )
      appendModifierLines(
        enc,
        article,
        groups.sideDish,
        isFixed,
        subNameW,
        priceW,
        showCurrency,
        COMPONENT_MODIFIER_INDENT,
      )
    }
    if (article.menuDrink) {
      appendMenuComponentLine(enc, article, article.menuDrink, drinkPrice, isFixed, subNameW, priceW, showCurrency)
      appendModifierLines(
        enc,
        article,
        groups.drink,
        isFixed,
        subNameW,
        priceW,
        showCurrency,
        COMPONENT_MODIFIER_INDENT,
      )
    }
    return
  }

  // Ohne Zuordnung (Bestand, à la carte) bleibt die Reihenfolge wie vor #1127: Komponenten, dann alle Modifier.
  // Menü-Beilage & Getränk — Font B, eingerückt
  if (article.isMenu) {
    if (article.menuSideDish) {
      appendMenuComponentLine(
        enc,
        article,
        article.menuSideDish,
        sideDishPrice,
        isFixed,
        subNameW,
        priceW,
        showCurrency,
      )
    }
    if (article.menuDrink) {
      appendMenuComponentLine(enc, article, article.menuDrink, drinkPrice, isFixed, subNameW, priceW, showCurrency)
    }
  }

  // Modifiers — Font B, eingerückt. Bei FIXED sind Menü-Bestandteile inklusive →
  // kein Einzelpreis (der Festpreis steht oben).
  appendModifierLines(enc, article, article.modifiers ?? [], isFixed, subNameW, priceW, showCurrency)
}

// Zusätzliche Einrückung der Modifier unter einer Menü-Komponente (#1127). Die Namensspalte wird um denselben
// Betrag schmaler, damit die Preisspalte an derselben Stelle endet.
const COMPONENT_MODIFIER_INDENT = 2

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
  showCurrency: boolean,
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
    [[`+ ${component.name}`, extraCents > 0 ? fmtAmount(fromCents(extraCents), showCurrency) : '']],
  )
  enc.font('A')
}

function appendModifierLines(
  enc: any,
  article: any,
  modifiers: any[],
  isFixed: boolean,
  subNameW: number,
  priceW: number,
  showCurrency: boolean,
  extraIndent = 0,
): void {
  if (modifiers.length > 0) {
    enc.font('B')
    for (const mod of modifiers) {
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
      // Betrag aus der Engine (`modifierLineGrossCents`, #698): Gilt der Modifier je Stück
      // (`modifierScope: 'unit'` oder Komponenten-Zeile), ist es der Gesamtaufpreis der Zeile,
      // und die Mengenangabe trägt „je" — „2x Burger / je 1x Käse 2,00". Sonst rechnete sich
      // der Bon nicht gegen die Positionssumme auf. Mit „je" bleibt auch `1x` stehen (#1257):
      // „je Käse 2,00" läse sich wie ein Stückpreis.
      const modCents = modifierLineGrossCents(article, mod)
      const modPrice = !isFixed && modCents !== 0 ? fmtAmount(fromCents(modCents), showCurrency) : ''
      const perUnit = mod.amount > 0 && modifiersCountPerUnit(article)
      enc.table(
        [
          { width: subNameW - extraIndent, marginLeft: 4 + extraIndent, align: 'left' },
          { width: priceW, align: 'right' },
        ],
        [[`${perUnit ? `je ${amount}x ` : amountPrefix(amount)}${modName}`, modPrice]],
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

function fmtAmount(price: number, showCurrency: boolean): string {
  const amount = price.toFixed(2).replace('.', ',')
  return showCurrency ? `${amount} EUR` : amount
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
