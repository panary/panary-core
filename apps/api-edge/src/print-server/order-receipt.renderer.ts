// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { computeOrderTax } from '@panary/orders/domain'
import { buildTseReceiptBlock } from '@panary/tse/domain'
import type { EscposOptions } from './escpos.adapter'

const COLUMNS_MAP: Record<string, number> = { '58mm': 32, '80mm': 48 }

/**
 * Rendert einen Bestellbon direkt mit der Encoder-API.
 * Volle Kontrolle: table() mit Callbacks, font-Wechsel in Zellen, box(), etc.
 */
export function renderOrderReceipt(order: any, location: any, options: EscposOptions = {}, deviceName?: string): Uint8Array {
  const { paperWidth = '80mm' } = options
  const cols = COLUMNS_MAP[paperWidth] || 48

  // Spaltenbreiten
  const priceW = 12
  const nameW = cols - priceW
  const subNameW = cols - priceW - 4 // 4 Zeichen Einrückung

  const settings = location?.settings || {}
  const drinkPrice = settings?.genericProductSettings?.generalDrinkPrice ?? 0
  const sideDishPrice = settings?.genericProductSettings?.generalSideDishPrice ?? 0

  const enc = new ReceiptPrinterEncoder({ columns: cols, language: 'esc-pos' })
  enc.initialize()

  // ─────────────────────────────────────────
  // FILIAL-ANGABEN (ohne Name — wird über die Location konfiguriert)
  // ─────────────────────────────────────────
  enc.newline()
  if (location?.address) {
    enc.align('center').font('B')
      .line(location.address.street)
      .line(`${location.address.postalCode} ${location.address.city}`)
    enc.font('A')
  }
  if (location?.phone) {
    enc.align('center').font('B').line(`Tel. ${location.phone}`).font('A')
  }
  enc.align('left')

  // ─────────────────────────────────────────
  // BESTELLNUMMER + BESTELLART (Badge)
  // ─────────────────────────────────────────
  enc.newline(2)
  enc.align('center').line('Bestellnummer')
  enc.align('center').bold(true).size(4, 4).line(`${order.dailySequenceNumber}`).size(1, 1).bold(false)

  // Bestellart als Badge (invertiert: weiß auf schwarz)
  const dineLabel = order.dineLocation === 'dine-in' ? 'INNEN' : 'AUSSEN'
  enc.align('center').size(2, 2).invert(true).text(dineLabel).invert(false).size(1, 1)
  enc.newline()

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
  enc.line(`Datum: ${creationDate.toLocaleDateString('de-DE')}`)
  enc.line(`Uhrzeit: ${creationDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`)
  enc.font('A')

  // Personalessen / Firmenkunde / Storno — hervorgehoben
  const hasExtra = order.staffPaymentInfo || order.customerPaymentInfo || order.cancellation
  if (hasExtra) {
    enc.newline()
    if (order.staffPaymentInfo) {
      enc.bold(true).text('Personalessen: ').bold(false).invert(true).text(order.staffPaymentInfo.userName).invert(false).newline()
    }
    if (order.customerPaymentInfo) {
      enc.bold(true).text('Firmenkunde: ').bold(false).invert(true).text(order.customerPaymentInfo.customerName).invert(false).newline()
    }
    if (order.cancellation) {
      enc.newline()
      enc.invert(true).bold(true).text(' STORNIERT ').bold(false).invert(false).newline()
      enc.font('B')
      if (order.cancellation.reason) enc.line(`Grund: ${order.cancellation.reason}`)
      if (order.cancellation.canceledAt) {
        const cancelDate = new Date(order.cancellation.canceledAt)
        enc.line(`Storniert am: ${cancelDate.toLocaleString('de-DE')}`)
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
    enc.bold(true).height(2).line(`Kombination ${idx + 1}`).height(1).bold(false)
    enc.rule({ style: 'single' })

    for (const article of combo) {
      appendArticle(enc, article, nameW, priceW, subNameW, drinkPrice, sideDishPrice)
    }

    const comboPrice = calcComboPrice(combo, sideDishPrice, drinkPrice)
    enc.table(
      [{ width: nameW, align: 'left' }, { width: priceW, align: 'right' }],
      [['', '--------'], ['', (e: any) => e.bold(true).text(fmtEur(comboPrice)).bold(false)]],
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
      enc.bold(true).height(2).line((lastTopic || '').toUpperCase()).height(1).bold(false)
      enc.rule({ style: 'single' })
    }
    appendArticle(enc, article, nameW, priceW, subNameW, drinkPrice, sideDishPrice)
  }


  // ─────────────────────────────────────────
  // GESAMTSUMME
  // ─────────────────────────────────────────
  enc.newline()
  enc.rule({ style: 'single' })
  const totalPrice = calcTotalWithDiscount(order)
  enc.table(
    [{ width: Math.floor(cols * 0.55), align: 'left' }, { width: Math.floor(cols * 0.45), align: 'right' }],
    [[(e: any) => e.bold(true).size(2, 2).text('Gesamt').size(1, 1).bold(false),
      (e: any) => e.bold(true).size(2, 2).text(fmtEur(totalPrice)).size(1, 1).bold(false)]],
  )
  enc.rule({ style: 'single' })

  // ─────────────────────────────────────────
  // TSE-SIGNATUR (KassenSichV Belegausgabepflicht)
  // ─────────────────────────────────────────
  appendTseBlock(enc, order)

  // ─────────────────────────────────────────
  // FUSSBEREICH
  // ─────────────────────────────────────────
  enc.newline(6)
  enc.cut()

  return enc.encode()
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

// ─── Artikel-Rendering mit voller Encoder-Kontrolle ───

function appendArticle(
  enc: any, article: any,
  nameW: number, priceW: number, subNameW: number,
  drinkPrice: number, sideDishPrice: number,
): void {
  const prefix = namePrefix(article)
  const name = `${article.amount}x ${prefix}${article.name}`

  // Hauptartikel — Produkt fett, Preis fett, in einer Tabellenzeile
  const price = article.modifiers?.length > 0
    ? calcArticlePrice(article, sideDishPrice, drinkPrice)
    : calcArticlePriceSimple(article, drinkPrice, sideDishPrice)

  enc.table(
    [{ width: nameW, align: 'left' }, { width: priceW, align: 'right' }],
    [[(e: any) => e.bold(true).text(name).bold(false),
      (e: any) => e.bold(true).text(fmtEur(price)).bold(false)]],
  )

  // FIXED_PROPORTIONAL: Komponenten sind im Festpreis enthalten → keine Aufschläge
  // ausweisen (sonst wirkt der Bon teurer als der fakturierte Festpreis).
  const isFixed = article.bundlePricingMode === 'FIXED_PROPORTIONAL'

  // Menü-Beilage & Getränk — Font B, eingerückt
  if (article.isMenu) {
    if (article.menuSideDish) {
      const extra = isFixed || (article.menuSideDish.price ?? 0) <= sideDishPrice
        ? 0 : (article.menuSideDish.price ?? 0) - sideDishPrice
      enc.font('B')
      enc.table(
        [{ width: subNameW, marginLeft: 4, align: 'left' }, { width: priceW, align: 'right' }],
        [[`+ ${article.menuSideDish.name}`, extra > 0 ? fmtEur(extra) : '']],
      )
      enc.font('A')
    }
    if (article.menuDrink) {
      const extra = isFixed || (article.menuDrink.price ?? 0) <= drinkPrice
        ? 0 : (article.menuDrink.price ?? 0) - drinkPrice
      enc.font('B')
      enc.table(
        [{ width: subNameW, marginLeft: 4, align: 'left' }, { width: priceW, align: 'right' }],
        [[`+ ${article.menuDrink.name}`, extra > 0 ? fmtEur(extra) : '']],
      )
      enc.font('A')
    }
  }

  // Modifiers — Font B, eingerückt. Bei FIXED sind Menü-Bestandteile inklusive →
  // kein Einzelpreis (der Festpreis steht oben).
  if (article.modifiers?.length > 0) {
    enc.font('B')
    for (const mod of article.modifiers) {
      let amount = mod.amount
      let modName = mod.name
      if (mod.amount === -1) { amount = 1; modName = `OHNE ${modName}` }
      const modPrice = (!isFixed && mod.price > 0 && mod.amount > 0) ? fmtEur(mod.price * mod.amount) : ''
      enc.table(
        [{ width: subNameW, marginLeft: 4, align: 'left' }, { width: priceW, align: 'right' }],
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

function calcArticlePriceSimple(article: any, drinkPrice: number, sideDishPrice: number): number {
  // FIXED_PROPORTIONAL: `price` IST der Festpreis (Beilage/Getränk eingerechnet) —
  // nicht erneut aufschlagen, sonst Doppelzählung.
  if (article.bundlePricingMode === 'FIXED_PROPORTIONAL') {
    return round((article.price ?? 0) * (article.amount ?? 1))
  }
  let p = (article.price ?? 0) * (article.amount ?? 1)
  if (article.isMenu) p += drinkPrice + sideDishPrice
  return round(p)
}

function calcArticlePrice(article: any, sideDishPrice: number, drinkPrice: number): number {
  if (article.bundlePricingMode === 'FIXED_PROPORTIONAL') {
    return round((article.price ?? 0) * (article.amount ?? 1))
  }
  let p = calcArticlePriceSimple(article, drinkPrice, sideDishPrice)
  for (const mod of (article.modifiers || [])) {
    if (mod.price && mod.amount > 0) p += mod.price * mod.amount
  }
  return round(p)
}

function calcComboPrice(combo: any[], sideDishPrice: number, drinkPrice: number): number {
  let total = 0
  for (const a of combo) {
    if (a.price !== undefined) total += calcArticlePrice(a, sideDishPrice, drinkPrice)
  }
  return round(total)
}

// Kanonische Gesamtsumme über `computeOrderTax` (@panary/orders/domain) — dieselbe
// Engine, die taxSnapshot + payment.totalAmount erzeugt. Damit stimmt der Bon-Betrag
// garantiert mit dem fakturierten Betrag überein und behandelt FIXED-Menüs, das
// Komponenten-Modell, Legacy-Shape sowie order.discount/appliedDiscounts korrekt.
function calcTotalWithDiscount(order: any): number {
  return round(computeOrderTax(order).brutto)
}

function getCombinations(order: any): any[][] {
  if (!order.lineItems) return []
  const bundles = new Map<number, any[]>()
  for (const item of order.lineItems) {
    if (item.bundleNumber !== undefined && item.bundleNumber !== null) {
      if (!bundles.has(item.bundleNumber)) bundles.set(item.bundleNumber, [])
      bundles.get(item.bundleNumber)!.push(item)
    }
  }
  return Array.from(bundles.values())
}

function getUnbundledLineItems(order: any): any[] {
  if (!order.lineItems) return []
  return order.lineItems.filter((item: any) => item.bundleNumber === undefined || item.bundleNumber === null)
}
