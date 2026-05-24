// import { environment } from '../../../../../../../apps/admin/src/environments/environment' // TODO: remove environment dependency
import {
  computeOrderTax,
  DiscountType,
  GenericOrderLineItem,
  Order,
  OrderLineItem,
  TaxInfo,
} from '@panary/orders/domain'

function printOut(value: string): void {
  const enablePrintOut = false // TODO: printOut feature
  if (enablePrintOut) {
    console.log(value)
  }
}

function round(value: number): number {
  return parseFloat(value.toFixed(2))
}

export function calculateArticlePriceWithoutExtras(
  articleItem: OrderLineItem,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let articlePrice=0

  if (articleItem.price) {
    printOut('Calculate article price without extras')

    articlePrice+=articleItem.price*articleItem.amount
    printOut(`ArticleAmount: ${articleItem.amount}`)

    if (articleItem.isMenu) {
      if (!articleItem.menuSideDish||articleItem.menuSideDish?.price===generalMenuSideDishPrice) {
        articlePrice+=generalMenuSideDishPrice*articleItem.amount
        printOut(`+ GeneralMenuSideDishPrice: ${generalMenuSideDishPrice*articleItem.amount}`)
      } else {
        articlePrice+=articleItem.menuSideDish.price*articleItem.amount
        printOut(`+ MenuSideDishPrice: ${articleItem.menuSideDish.price*articleItem.amount}`)
      }
      if (!articleItem.menuDrink||articleItem.menuDrink?.price===generalMenuDrinkPrice) {
        articlePrice+=generalMenuDrinkPrice*articleItem.amount
        printOut(`+ GeneralMenuDrinkPrice: ${generalMenuDrinkPrice*articleItem.amount}`)
      } else {
        articlePrice+=articleItem.menuDrink.price*articleItem.amount
        printOut(`+ MenuDrinkPrice: ${articleItem.menuDrink.price*articleItem.amount}`)
      }
    }
  }

  articlePrice=round(articlePrice)
  printOut(`ResultWithoutExtras: ${articlePrice}`)

  return articlePrice
}

export function calculateArticlePrice(
  articleItem: OrderLineItem,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let articlePrice: number=calculateArticlePriceWithoutExtras(
    articleItem,
    generalMenuSideDishPrice,
    generalMenuDrinkPrice,
  )

  printOut('Calculate article price')

  articleItem.modifiers.forEach((extra: GenericOrderLineItem): void => {
    if (extra.price&&extra.amount>0) {
      articlePrice+=extra.price*extra.amount
      printOut(`+ ExtraPrice: ${extra.price*extra.amount}`)
    }
  })

  articlePrice=round(articlePrice)
  printOut(`Result: ${articlePrice}`)

  return articlePrice
}

export function calculateSumPriceSeperated(
  articleItems: OrderLineItem[],
  combinations: Array<OrderLineItem[]>,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let sumPriceSeperated=0

  articleItems.forEach((article: OrderLineItem): void => {
    if (article.price!==undefined) {
      sumPriceSeperated+=calculateArticlePrice(article, generalMenuSideDishPrice, generalMenuDrinkPrice)
    }
  })

  combinations.forEach((articles: OrderLineItem[]): void => {
    sumPriceSeperated+=calculateCombinationPrice(articles, generalMenuSideDishPrice, generalMenuDrinkPrice)
  })

  return round(sumPriceSeperated)
}

export function calculateSumPrice(
  orderItem: Order,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let sumPrice=0

  orderItem.lineItems.forEach((article: OrderLineItem): void => {
    if (article.price) {
      sumPrice+=calculateArticlePrice(article, generalMenuSideDishPrice, generalMenuDrinkPrice)
    }
  })

  return round(sumPrice)
}

export function calculateSumPriceWithDiscountDetails(
  orderItem: Order,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let sumPrice: number=calculateSumPrice(orderItem, generalMenuSideDishPrice, generalMenuDrinkPrice)

  if (orderItem.discount&&orderItem.discount.discountType===DiscountType.PERCENT) {
    sumPrice=sumPrice-sumPrice*(orderItem.discount.discount/100)
  } else if (orderItem.discount&&orderItem.discount.discountType===DiscountType.AMOUNT) {
    sumPrice=sumPrice-orderItem.discount.discount
    if (sumPrice<0) {
      sumPrice=0
    }
  }

  return round(sumPrice)
}

export function calculateCombinationPrice(
  combination: Array<OrderLineItem>,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let combinationPrice=0

  combination.forEach((articleItem: OrderLineItem): void => {
    if (articleItem.price!==undefined) {
      combinationPrice+=calculateArticlePrice(articleItem, generalMenuSideDishPrice, generalMenuDrinkPrice)
    }
  })

  return round(combinationPrice)
}

// Delegiert an die kanonische Engine `computeOrderTax` (@panary/orders/domain):
// cents-intern, fiskalisch korrekte MwSt-Extraktion, Single Source of Truth.
// Die frühere lokale Duplikat-Logik (calculateArticleTaxInfomation) wurde entfernt.
export function calculateTaxSummary(order: Order): TaxInfo {
  return computeOrderTax(order)
}
