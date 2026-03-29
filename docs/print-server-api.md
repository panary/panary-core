# Print-Server & ESC/POS Dokumentation

## Library: `@point-of-sale/receipt-printer-encoder` v3

Erzeugt ESC/POS-Befehle als `Uint8Array`, die an jeden Thermodrucker gesendet werden.
Unterstützt ESC/POS, StarLine und StarPRNT.

---

## 1. Schriftarten & Schriftgroessen

### Zwei eingebaute Fonts

| Font | Zeichengroesse | Zeichen/Zeile (80mm) | Zeichen/Zeile (58mm) | Einsatz |
|------|---------------|---------------------|---------------------|---------|
| **A** (Standard) | 12x24 px | 48 | 32 | Produkte, Preise, Ueberschriften |
| **B** (Schmal) | 9x17 px | 64 | 42 | Meta-Infos, Datum, Extras, Kleingedrucktes |

```typescript
encoder.font('A').line('Normaler Text')        // Standard
encoder.font('B').line('Kleiner, schmaler Text') // Fein
```

### Groessen-Multiplikatoren (width x height)

Jeder Font kann mit `width(1-8)` und `height(1-8)` skaliert werden.
Bei `width: 2` halbiert sich die verfuegbare Zeichenanzahl pro Zeile.

| Kombination | Effektive Groesse | Zeichen/Zeile (80mm, Font A) | Einsatz |
|-------------|------------------|------------------------------|---------|
| `1x1` | Normal | 48 | Produkte, Preise |
| `1x2` | Doppelte Hoehe | 48 | Gruppen-Ueberschriften |
| `2x2` | Doppelt | 24 | Tisch, Fertigstellung |
| `3x3` | Dreifach | 16 | Bestellnummer |
| `4x4` | Vierfach | 12 | Extrem gross (selten) |
| Font B `1x1` | Klein | 64 | Extras, Datum, Kleingedrucktes |
| Font B `1x2` | Klein + hoch | 64 | Hervorgehobene Infos |

```typescript
encoder.size(3, 3).line('RIESIG').size(1, 1)
encoder.width(2).height(1).line('Breit aber normal hoch').width(1)
```

### Schriftstile

| Methode | Beschreibung | ESC/POS Support |
|---------|-------------|-----------------|
| `bold(true/false)` | Fettdruck | Alle Drucker |
| `italic(true/false)` | Kursiv | Einige ESC/POS |
| `underline(true/false)` | Unterstrichen | Alle Drucker |
| `invert(true/false)` | Weiss auf Schwarz | Alle Drucker |

**Wichtig:** `italic()` wird nicht von allen Druckern unterstuetzt.
Fettdruck ist die zuverlaessigste Hervorhebung.

---

## 2. Layout & Positionierung

### Ausrichtung

```typescript
encoder.align('left').line('Links')
encoder.align('center').line('Zentriert')
encoder.align('right').line('Rechts')
```

### Tabellen (Mehrspalten-Layout)

**Das ist die Antwort auf "Zwei-Spalten-Layout"** — `table()` ermoeglicht beliebig viele Spalten.

```typescript
encoder.table(
  [
    { width: 36, marginRight: 2, align: 'left' },   // Spalte 1: Produktname
    { width: 10, align: 'right' }                    // Spalte 2: Preis
  ],
  [
    ['2x Doener Teller', '12,00 EUR'],
    ['1x Cola 0,3l', '2,50 EUR'],
    ['', '--------'],
    ['Summe', (enc) => enc.bold().text('14,50 EUR')], // Callback fuer Styling
  ]
)
```

**Spalten-Optionen:**

| Option | Typ | Beschreibung |
|--------|-----|-------------|
| `width` | number | Spaltenbreite in Zeichen (Pflicht) |
| `align` | `'left'` / `'right'` | Textausrichtung in der Spalte |
| `marginLeft` | number | Abstand links aussen |
| `marginRight` | number | Abstand rechts aussen |
| `verticalAlign` | `'top'` / `'bottom'` | Vertikale Ausrichtung bei mehrzeiligem Text |

**Zell-Werte:** String oder Callback `(encoder) => encoder.bold().text('styled')` fuer Inline-Styling.

### Boxen (Umrahmter Bereich)

Ideal fuer hervorgehobene Bloecke (Bestellnummer, Summe, etc.):

```typescript
encoder.box(
  { style: 'double', width: 30, align: 'center' },
  'Bestellung Nr. 245'
)

// Mit Callback fuer Styling
encoder.box(
  { style: 'single', width: 40 },
  (enc) => enc.bold().size(2, 2).text('SUMME: 18,50 EUR').size(1, 1).bold(false)
)
```

**Box-Optionen:**

| Option | Typ | Beschreibung |
|--------|-----|-------------|
| `style` | `'none'` / `'single'` / `'double'` | Rahmenart |
| `width` | number | Boxbreite (Standard: Papierbreite) |
| `align` | `'left'` / `'right'` | Textausrichtung im Inneren |
| `marginLeft/Right` | number | Aussenabstand |
| `paddingLeft/Right` | number | Innenabstand |

### Linien (Rules)

```typescript
encoder.rule()                              // Einfache Linie ueber gesamte Breite
encoder.rule({ style: 'single' })           // Einfach (-)
encoder.rule({ style: 'double' })           // Doppelt (=)
encoder.rule({ style: 'single', width: 20 })// Kurze Linie
```

---

## 3. Barcodes & QR-Codes

### QR-Code

```typescript
encoder.qrcode('https://panary.de')
encoder.qrcode('https://panary.de', { model: 2, size: 6, errorlevel: 'h' })
```

| Option | Werte | Standard |
|--------|-------|----------|
| `model` | 1, 2 | 2 |
| `size` | 1-8 | 6 |
| `errorlevel` | `'l'`, `'m'`, `'q'`, `'h'` | `'m'` |

### Barcode

```typescript
encoder.barcode('4015400346860', 'ean13')
encoder.barcode('4015400346860', 'ean13', { height: 80, width: 2, text: true })
```

**Unterstuetzte Symbologien:** `upca`, `upce`, `ean13`, `ean8`, `code39`, `itf`,
`code93`, `code128`, `codabar`, `gs1-128`, `gs1-databar-omni`, `code128-auto`

### PDF417

```typescript
encoder.pdf417('Daten', { width: 3, height: 3, errorlevel: 4 })
```

---

## 4. Bilder & Logos

```typescript
// Node.js mit Sharp
import sharp from 'sharp'
const { data, info } = await sharp('logo.png')
  .resize(200)
  .raw()
  .toBuffer({ resolveWithObject: true })

encoder.image(data, info.width, info.height, 'atkinson')
```

**Dithering-Algorithmen:**

| Algorithmus | Qualitaet | Geschwindigkeit | Einsatz |
|-------------|----------|----------------|---------|
| `threshold` | Niedrig | Schnell | Einfache Icons |
| `bayer` | Mittel | Schnell | Logos mit Graustufen |
| `floydsteinberg` | Hoch | Mittel | Fotos |
| `atkinson` | Hoch | Mittel | Beste Qualitaet fuer Bons |

---

## 5. Geraetesteuerung

### Papier schneiden

```typescript
encoder.cut()           // Vollschnitt
encoder.cut('partial')  // Teilschnitt (Papier haengt noch)
```

### Kassenschublade / Piepser

```typescript
encoder.pulse()                 // Standard: Geraet 0, 100ms, 500ms Pause
encoder.pulse(0, 200, 1000)     // Geraet 0, 200ms Puls, 1000ms Pause
```

### Rohe ESC/POS-Befehle

```typescript
encoder.raw([0x1b, 0x40])  // ESC @ = Initialize
```

---

## 6. Was wir aktuell nutzen vs. was moeglich ist

### Aktuell genutzt

| Feature | Status |
|---------|--------|
| `text()`, `line()`, `newline()` | Ja |
| `bold()`, `underline()` | Ja |
| `italic()`, `invert()` | Ja (neu) |
| `font('A'/'B')` | Ja (neu) |
| `size(w, h)`, `width()`, `height()` | Ja |
| `align('left'/'center'/'right')` | Ja |
| `rule({ style })` | Ja (neu) |
| `qrcode()` | Ja (im Testdruck) |
| `cut()` | Ja |

### Noch nicht genutzt — Potenzial

| Feature | Potenzial | Einsatz |
|---------|----------|---------|
| **`table()`** | **Hoch** | Zweispalten-Layout: Produkt links, Preis rechts. Sauberes Alignment ohne manuelles `padEnd()` |
| **`box()`** | **Hoch** | Bestellnummer umrahmt, Summe umrahmt, Fertigstellungs-Block |
| **`image()`** | Mittel | Logo auf dem Bon, Produkt-Icons |
| **`barcode()`** | Mittel | Bestellnummer als Barcode fuer Scanner |
| **`pdf417()`** | Niedrig | Rechnungsdaten |
| **`invert()`** | Mittel | Hervorgehobene Bloecke (z.B. "AUSSEN" invertiert) |
| **`pulse()`** | Niedrig | Kassenschublade oeffnen |
| **`raw()`** | Niedrig | Drucker-spezifische Befehle |

---

## 7. Beispiel: Professionelles Bon-Layout mit table() und box()

```typescript
const encoder = new ReceiptPrinterEncoder({ columns: 48, language: 'esc-pos' })

encoder
  .initialize()
  .newline(2)

  // Bestellnummer in Box
  .box({ style: 'double', align: 'center' },
    (enc) => enc.size(3, 3).bold().text(`Nr. 245`).bold(false).size(1, 1)
  )
  .font('B').align('center').line('28.03.2026, 14:20 Uhr').font('A').align('left')
  .newline()

  // Fertigstellung in Box
  .box({ style: 'double' },
    (enc) => enc.size(2, 2).bold()
      .text('14:35')
      .bold(false).size(1, 1).text('      ')
      .size(2, 2).bold().text('INNEN')
      .bold(false).size(1, 1)
  )
  .newline()

  // Produktgruppe
  .bold().height(2).line('Speisen').height(1).bold(false)
  .rule({ style: 'single' })

  // Produkte als Tabelle — sauberes Zwei-Spalten-Layout
  .table(
    [
      { width: 38, marginRight: 1, align: 'left' },
      { width: 9, align: 'right' }
    ],
    [
      [(enc) => enc.bold().text('2x Doener Teller'), (enc) => enc.bold().text('12,00,-')],
      [(enc) => enc.font('B').text('    1x Extra Kaese'), (enc) => enc.font('B').text('1,50,-')],
      [(enc) => enc.bold().text('1x Lahmacun'), (enc) => enc.bold().text('5,00,-')],
    ]
  )
  .newline()

  // Summe
  .rule({ style: 'double' })
  .align('center').size(2, 2).bold().line('SUMME: 18,50 EUR').bold(false).size(1, 1).align('left')
  .rule({ style: 'double' })

  .newline(6)
  .cut()
  .encode()
```

---

## 8. Vergleich: Manuelles padEnd vs. table()

### Aktuell (manuell):
```typescript
// Wir berechnen Abstande selbst
const name = '2x Doener Teller'
const price = '  12,00,-'
el.push({ type: 'text', text: name.padEnd(39, '.') + price, bold: true })
```

**Nachteile:**
- Abhaengig von `cols`-Konfiguration
- Bricht bei langen Namen oder Preisen
- Font B hat andere Zeichenbreite → Berechnung stimmt nicht mehr

### Besser (table):
```typescript
encoder.table(
  [{ width: 38, align: 'left' }, { width: 10, align: 'right' }],
  [[(enc) => enc.bold().text('2x Doener Teller'), (enc) => enc.bold().text('12,00,-')]]
)
```

**Vorteile:**
- Library berechnet Abstande automatisch
- Funktioniert mit Font A und Font B
- Sauberes Alignment auch bei unterschiedlichen Textlaengen
- Kein manuelles `padEnd()` oder `padStart()` noetig

---

## 9. Limitierungen

- **Keine echten "Schriftarten"**: Thermodrucker haben nur Font A und Font B eingebaut. Keine TrueType/OpenType-Fonts.
- **Keine Pixel-Positionierung**: Text wird Zeichen-fuer-Zeichen gesetzt, nicht Pixel-fuer-Pixel. Position wird ueber Spaltenbreite und Alignment gesteuert.
- **Kein CSS-Grid**: Aber `table()` und `box()` decken die meisten Layout-Beduerfnisse ab.
- **Schriftstärke**: Nur `bold()` (ein/aus). Keine Abstufungen wie `font-weight: 300/400/700`.
- **Italic**: Wird nicht von allen Druckern unterstuetzt.
- **Bilder**: Immer Schwarz-Weiss, Dithering fuer Graustufen.
