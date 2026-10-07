import { describe, it, expect } from 'vitest'
import { computeOrderTax, Order, PaymentState } from '@panary/orders/domain'
import { getOrderGrossCents, getOrderNetCents, getOrderTipCents, computeGrossFromLineItems } from './order-total'
import { makeOrder } from './fixtures/orders.fixtures'
import { toCents } from './money'

// Erwartungswert aus der Engine statt hart gerechnet (#634): Der Rückfall soll
// genau das liefern, was `computeOrderTax` als `taxSnapshot.brutto` stempeln
// würde — eine zweite, von Hand gerechnete Zahl wäre wieder eine eigene Formel.
const engineGrossCents = (lineItems: unknown): number =>
  toCents(computeOrderTax({ lineItems } as unknown as Order).brutto)

describe('order-total', () => {
  it('verwendet payment.totalAmount als primäre Quelle', () => {
    const order = makeOrder({ grossAmount: 15.5 })
    expect(getOrderGrossCents(order)).toBe(1550)
  })

  // Regression: `pre-orders.convert` legte die Order mit einem Platzhalter
  // `payment { state: PENDING, totalAmount: 0, transactions: [] }` an. Da
  // `0 !== undefined && 0 !== null` gewann dieser Platzhalter gegen
  // taxSnapshot UND lineItems — die Order zaehlte mit 0 EUR, waehrend der
  // Wareneinsatz normal gerechnet wurde (negativer Deckungsbeitrag).
  describe('nie befuellter Payment-Platzhalter', () => {
    const placeholder = (order: Order): Order => ({
      ...order,
      payment: { state: PaymentState.PENDING, totalAmount: 0, tipAmount: 0, transactions: [] },
    })

    it('ignoriert den Platzhalter und faellt auf den taxSnapshot zurueck', () => {
      const order = placeholder(makeOrder({ grossAmount: 12.34 }))
      expect(getOrderGrossCents(order)).toBe(1234)
    })

    it('greift nur bei Betrag 0 — ein echter Betrag bleibt autoritativ', () => {
      const order = makeOrder({ grossAmount: 12.34 })
      const pendingWithAmount: Order = {
        ...order,
        payment: { state: PaymentState.PENDING, totalAmount: 5, tipAmount: 0, transactions: [] },
      }
      expect(getOrderGrossCents(pendingWithAmount)).toBe(500)
    })

    it('greift NICHT bei einem legitim mit 0 EUR bezahlten Vorgang (100 % Rabatt)', () => {
      // Wichtig: Der lineItem-Fallback kennt keine Rabatte. Wuerde der Guard
      // hier greifen, lieferte er den vollen unrabattierten Preis — ein
      // schlimmerer Fehler als der behobene.
      const order = makeOrder({ grossAmount: 12.34 })
      const paidZero: Order = {
        ...order,
        payment: { state: PaymentState.PAID, totalAmount: 0, tipAmount: 0, transactions: [] },
      }
      expect(getOrderGrossCents(paidZero)).toBe(0)
    })

    it('greift NICHT, wenn Transaktionen vorliegen', () => {
      const order = makeOrder({ grossAmount: 12.34 })
      const withTx: Order = {
        ...order,
        payment: {
          state: PaymentState.PENDING,
          totalAmount: 0,
          tipAmount: 0,
          transactions: order.payment?.transactions ?? [],
        },
      }
      expect(getOrderGrossCents(withTx)).toBe(0)
    })

    it('ohne taxSnapshot UND ohne Positionen bleibt es bei 0 — kein Verhaltensunterschied', () => {
      const order = makeOrder({ grossAmount: 12.34 })
      const bare: Order = {
        ...order,
        lineItems: [],
        taxSnapshot: null,
        payment: { state: PaymentState.PENDING, totalAmount: 0, tipAmount: 0, transactions: [] },
      } as Order
      expect(getOrderGrossCents(bare)).toBe(0)
    })
  })

  // Form von Staging-Bon #930 (core#634): offen, Platzhalter-`payment`, kein
  // `taxSnapshot` → der Positions-Rückfall entscheidet. Margherita 6,70 × 2 mit
  // Extra Gauda 2,00 × 1 — der Rückfall zählte den Modifier doppelt.
  it('offener Bon ohne taxSnapshot: Positions-Rückfall gleich der Engine (#634, Bon #930)', () => {
    const order = makeOrder({
      lineItems: [
        {
          _id: '00000000-0000-7000-8000-000000000930',
          externalId: '00000000-0000-7000-8000-000000000931',
          amount: 2,
          name: 'Margherita',
          price: 6.7,
          recipeReferences: [],
          ingredientReferences: [],
          taxInside: 19,
          taxOutside: 7,
          topic: '',
          productGroupExternalId: '00000000-0000-7000-8000-000000000932',
          bundleNumber: null,
          modifiers: [
            {
              _id: '00000000-0000-7000-8000-000000000933',
              externalId: '00000000-0000-7000-8000-000000000934',
              amount: 1,
              name: 'Extra Gauda',
              price: 2,
              recipeReferences: [],
              ingredientReferences: [],
              taxInside: 19,
              taxOutside: 7,
              topic: '',
            },
          ],
          isMenu: false,
          menuDrink: null,
          menuSideDish: null,
        },
      ],
    })
    const open = {
      ...order,
      taxSnapshot: null,
      payment: { state: PaymentState.PENDING, totalAmount: 0, tipAmount: 0, transactions: [] },
    } as unknown as Order
    expect(getOrderGrossCents(open)).toBe(engineGrossCents(order.lineItems))
  })

  it('fällt auf taxSnapshot.brutto zurück, wenn payment fehlt', () => {
    const order = makeOrder({ grossAmount: 9.99 })
    const noPayment: Order = { ...order, payment: null }
    expect(getOrderGrossCents(noPayment)).toBe(999)
  })

  it('fällt auf Line-Items zurück, wenn payment & taxSnapshot fehlen', () => {
    const order = makeOrder({
      lineItems: [
        {
          _id: '00000000-0000-7000-8000-000000000010',
          externalId: '00000000-0000-7000-8000-000000000011',
          amount: 2,
          name: 'Burger',
          price: 5.5,
          recipeReferences: [],
          ingredientReferences: [],
          taxInside: 0,
          taxOutside: 0,
          topic: '',
          productGroupExternalId: '00000000-0000-7000-8000-000000000012',
          bundleNumber: null,
          modifiers: [
            {
              _id: '00000000-0000-7000-8000-000000000013',
              externalId: '00000000-0000-7000-8000-000000000014',
              amount: 1,
              name: 'Extra Käse',
              price: 0.5,
              recipeReferences: [],
              ingredientReferences: [],
              taxInside: 0,
              taxOutside: 0,
              topic: '',
            },
          ],
          isMenu: false,
          menuDrink: null,
          menuSideDish: null,
        },
      ],
    })
    const stripped: Order = { ...order, payment: null, taxSnapshot: null }
    expect(getOrderGrossCents(stripped)).toBe(engineGrossCents(order.lineItems))
  })

  it('Modifier zählt mit seiner eigenen Menge, nicht mit der Positionsmenge — wie die Engine (#634)', () => {
    // Bis #634 multiplizierte der Rückfall den Modifier zusätzlich mit der
    // Positionsmenge; Anzeige, Bon und taxSnapshot tun das nicht.
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 3,
        name: 'Burger',
        price: 5,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 0,
        taxOutside: 0,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        modifiers: [
          {
            _id: 'm1',
            externalId: 'em1',
            amount: 1,
            name: 'Käse',
            price: 0.5,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 0,
            taxOutside: 0,
            topic: '',
          },
        ],
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
      },
    ]
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(engineGrossCents(lineItems))
  })

  it('„OHNE"-Modifier (amount −1) bleibt preisneutral', () => {
    // Muss zur Engine `computeOrderTax` passen: der POS-Marker für „OHNE <Extra>"
    // darf keinen Aufpreis gutschreiben, sonst driftet dieser Reporting-Fallback
    // vom `taxSnapshot` der Order ab.
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 1,
        name: 'Margherita',
        price: 6.7,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 7,
        taxOutside: 7,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        modifiers: [
          {
            _id: 'm1',
            externalId: 'em1',
            amount: -1,
            name: 'Bacon',
            price: 1.9,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
          },
        ],
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
      },
    ]
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(670)
  })

  it('Modifier mit negativem Preis zieht ab (entfernbare Zutat), geklemmt bei 0', () => {
    // `toggleRemovableIngredient()` übernimmt `ingredient.priceAdjustment` als
    // Modifier-Preis — negativ = Abzug fürs Weglassen. Muss zur Engine
    // `computeOrderTax` passen, inklusive der Klemme bei 0.
    const mk = (adj: number) => [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 1,
        name: 'Margherita',
        price: 6.7,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 7,
        taxOutside: 7,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        modifiers: [
          {
            _id: 'm1',
            externalId: 'em1',
            amount: 1,
            name: 'Ohne Zwiebeln',
            price: adj,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
          },
        ],
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
      },
    ]
    expect(computeGrossFromLineItems(mk(-1) as unknown as Order['lineItems'])).toBe(570)
    expect(computeGrossFromLineItems(mk(-99) as unknown as Order['lineItems'])).toBe(0)
  })

  it('FIXED_PROPORTIONAL: Fallback nutzt den Festpreis (line.price), Komponenten nicht erneut addiert', () => {
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 1,
        name: 'Menü',
        price: 7,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 7,
        taxOutside: 7,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        modifiers: [],
        isMenu: true,
        menuDrink: null,
        menuSideDish: null,
        bundlePricingMode: 'FIXED_PROPORTIONAL',
        components: [
          {
            _id: 'c0',
            externalId: 'e0',
            amount: 1,
            name: 'Haupt',
            price: 3.8,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'main',
            role: 'main',
          },
          {
            _id: 'c1',
            externalId: 'ec1',
            amount: 1,
            name: 'Cola',
            price: 2.3,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 19,
            taxOutside: 19,
            topic: '',
            role: 'drink',
          },
          {
            _id: 'c2',
            externalId: 'ec2',
            amount: 1,
            name: 'Beilage',
            price: 0.9,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: '',
            role: 'side',
          },
        ],
      },
    ]
    // Festpreis 7,00 € — Komponenten sind eingerechnet, NICHT erneut addiert
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(700)
  })

  it('components[] (ROLLUP/à-la-carte): Komponenten werden on top addiert (Parent-Amount-skaliert)', () => {
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 2,
        name: 'Bowl',
        price: 5,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 7,
        taxOutside: 7,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        modifiers: [],
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
        components: [
          {
            _id: 'c1',
            externalId: 'ec1',
            amount: 1,
            name: 'Topping',
            price: 1.5,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: '',
            role: 'extra',
          },
        ],
      },
    ]
    // (5,00 + 1,50) × 2 = 13,00 €
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(1300)
  })

  // HIGHEST: Die Regel „höchster Aufpreis gewinnt“ wendet der POS beim Erzeugen
  // der Order an, indem er die unterlegenen Aufpreise auf 0 setzt. Anzeige, Bon,
  // taxSnapshot und Storefront-Warenkorb rechnen über die Engine und summieren
  // die gestempelten Preise. Der Rückfall rechnet seit #634 genauso und nicht
  // klüger als der Betrag, den der Kunde gesehen hat.
  it('HIGHEST mit nicht genullten Aufpreisen: Rückfall rechnet wie die Engine (#634)', () => {
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 1,
        name: 'Pizzablech',
        price: 10,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 7,
        taxOutside: 7,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
        modifiers: [
          {
            _id: 'm1',
            externalId: 'em1',
            amount: 1,
            name: 'Belag A',
            price: 4.3,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
            pricingMode: 'HIGHEST',
          },
          {
            _id: 'm2',
            externalId: 'em2',
            amount: 1,
            name: 'Belag B',
            price: 4.3,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
            pricingMode: 'HIGHEST',
          },
          {
            _id: 'm3',
            externalId: 'em3',
            amount: 1,
            name: 'Belag C',
            price: 4.3,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
            pricingMode: 'HIGHEST',
          },
          {
            _id: 'm4',
            externalId: 'em4',
            amount: 1,
            name: 'Premium-Belag',
            price: 8.4,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
            pricingMode: 'HIGHEST',
          },
        ],
      },
    ]
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(engineGrossCents(lineItems))
  })

  it('HIGHEST mit mehreren topics: Rückfall rechnet wie die Engine (#634)', () => {
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 1,
        name: 'Pizzablech',
        price: 10,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 7,
        taxOutside: 7,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
        modifiers: [
          {
            _id: 'm1',
            externalId: 'em1',
            amount: 1,
            name: 'Belag A',
            price: 4.3,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Belag',
            pricingMode: 'HIGHEST',
          },
          {
            _id: 'm4',
            externalId: 'em4',
            amount: 1,
            name: 'Premium',
            price: 8.4,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Belag',
            pricingMode: 'HIGHEST',
          },
          {
            _id: 's1',
            externalId: 'es1',
            amount: 1,
            name: 'Sauce X',
            price: 1.5,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Sauce',
            pricingMode: 'HIGHEST',
          },
          {
            _id: 's2',
            externalId: 'es2',
            amount: 1,
            name: 'Sauce Y',
            price: 2.0,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Sauce',
            pricingMode: 'HIGHEST',
          },
        ],
      },
    ]
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(engineGrossCents(lineItems))
  })

  it('SUM (Default ohne pricingMode): alle Modifier werden summiert (Regression)', () => {
    // Kein pricingMode → Bestandsverhalten: 10,00 + 4,30 + 8,40 = 22,70€.
    const lineItems = [
      {
        _id: 'l1',
        externalId: 'e1',
        amount: 1,
        name: 'Pizzablech',
        price: 10,
        recipeReferences: [],
        ingredientReferences: [],
        taxInside: 7,
        taxOutside: 7,
        topic: '',
        productGroupExternalId: 'g1',
        bundleNumber: null,
        isMenu: false,
        menuDrink: null,
        menuSideDish: null,
        modifiers: [
          {
            _id: 'm1',
            externalId: 'em1',
            amount: 1,
            name: 'Belag A',
            price: 4.3,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
          },
          {
            _id: 'm4',
            externalId: 'em4',
            amount: 1,
            name: 'Premium',
            price: 8.4,
            recipeReferences: [],
            ingredientReferences: [],
            taxInside: 7,
            taxOutside: 7,
            topic: 'Extras',
          },
        ],
      },
    ]
    expect(computeGrossFromLineItems(lineItems as unknown as Order['lineItems'])).toBe(2270)
  })

  it('getOrderTipCents liest Trinkgeld', () => {
    const order = makeOrder({ tipAmount: 2.5 })
    expect(getOrderTipCents(order)).toBe(250)
  })

  it('getOrderNetCents bevorzugt taxSnapshot.netto', () => {
    const order = makeOrder({ grossAmount: 11.9, taxes: [{ rate: 19, gross: 11.9, tax: 1.9 }] })
    expect(getOrderNetCents(order)).toBe(1000)
  })
})
