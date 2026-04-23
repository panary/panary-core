// import { environment } from '../../../../../../../apps/admin/src/environments/environment' // TODO: remove environment dependency
import { GenericOrderLineItemSchema, OrderLineItemSchema } from '../models/order-line-item.model'
import { DineLocation, DiscountType, Order, TaxInfo } from '@panary-core/orders/domain'

function getDefaultTaxSummary(): TaxInfo {
  return {
    taxes: [],
    netto: 0,
    brutto: 0,
  }
}

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
  articleItem: OrderLineItemSchema,
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
  articleItem: OrderLineItemSchema,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let articlePrice: number=calculateArticlePriceWithoutExtras(
    articleItem,
    generalMenuSideDishPrice,
    generalMenuDrinkPrice,
  )

  printOut('Calculate article price')

  articleItem.modifiers.forEach((extra: GenericOrderLineItemSchema): void => {
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
  articleItems: OrderLineItemSchema[],
  combinations: Array<OrderLineItemSchema[]>,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let sumPriceSeperated=0

  articleItems.forEach((article: OrderLineItemSchema): void => {
    if (article.price!==undefined) {
      sumPriceSeperated+=calculateArticlePrice(article, generalMenuSideDishPrice, generalMenuDrinkPrice)
    }
  })

  combinations.forEach((articles: OrderLineItemSchema[]): void => {
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

  orderItem.lineItems.forEach((article: OrderLineItemSchema): void => {
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
  combination: Array<OrderLineItemSchema>,
  generalMenuSideDishPrice: number,
  generalMenuDrinkPrice: number,
): number {
  let combinationPrice=0

  combination.forEach((articleItem: OrderLineItemSchema): void => {
    if (articleItem.price!==undefined) {
      combinationPrice+=calculateArticlePrice(articleItem, generalMenuSideDishPrice, generalMenuDrinkPrice)
    }
  })

  return round(combinationPrice)
}

export function calculateArticleTaxInfomation(article: OrderLineItemSchema, taxRate: string): TaxInfo {
  const taxInfomation: TaxInfo=getDefaultTaxSummary()

  switch (taxRate) {
    case DineLocation.DINE_IN:
      if (article.price) {
        // Calculate price and taxes of the article
        const price: number=article.price*article.amount
        const tax: number=(price*article.taxInside)/100

        const taxIndex=taxInfomation.taxes.findIndex((tax): boolean => tax.taxRate===article.taxInside)

        if (taxIndex===-1) {
          taxInfomation.taxes.push({
            taxRate: article.taxInside,
            amount: price-tax,
            tax: tax,
          })
        } else {
          taxInfomation.taxes[taxIndex].tax+=tax
          taxInfomation.taxes[taxIndex].amount+=price
        }
        taxInfomation.netto+=price-tax
        taxInfomation.brutto+=price
      }

      // Calculate taxes for extras
      article.modifiers.forEach((extra: GenericOrderLineItemSchema): void => {
        if (extra.price) {
          const extraPrice: number=extra.price*extra.amount
          const extraTax: number=(extraPrice*article.taxInside)/100

          const extraTaxIndex=taxInfomation.taxes.findIndex((tax): boolean => tax.taxRate===article.taxInside)

          if (extraTaxIndex===-1) {
            taxInfomation.taxes.push({
              taxRate: article.taxInside,
              amount: extraPrice-extraTax,
              tax: extraTax,
            })
          } else {
            taxInfomation.taxes[extraTaxIndex].tax+=extraTax
            taxInfomation.taxes[extraTaxIndex].amount+=extraPrice-extraTax
          }
          taxInfomation.netto+=extraPrice-extraTax
          taxInfomation.brutto+=extraPrice
        }
      })

      // Calculate taxes for side dish
      if (article.menuSideDish&&article.menuSideDish.price) {
        const sideDishPrice: number=article.menuSideDish.price
        const sideDishTax: number=(sideDishPrice*article.taxInside)/100

        const sideDishTaxIndex=taxInfomation.taxes.findIndex(
          (tax): boolean => tax.taxRate===article.taxInside,
        )

        if (sideDishTaxIndex===-1) {
          taxInfomation.taxes.push({
            taxRate: article.taxInside,
            amount: sideDishPrice-sideDishTax,
            tax: sideDishTax,
          })
        } else {
          taxInfomation.taxes[sideDishTaxIndex].tax+=sideDishTax
          taxInfomation.taxes[sideDishTaxIndex].amount+=sideDishPrice-sideDishTax
        }
        taxInfomation.netto+=sideDishPrice-sideDishTax
        taxInfomation.brutto+=sideDishPrice
      }

      // Calculate taxes for menu drink
      if (article.menuDrink&&article.menuDrink.price) {
        const menuDrinkPrice: number=article.menuDrink.price
        const menuDrinkTax: number=(menuDrinkPrice*article.taxInside)/100

        const menuDrinkTaxIndex=taxInfomation.taxes.findIndex(
          (tax): boolean => tax.taxRate===article.taxInside,
        )

        if (menuDrinkTaxIndex===-1) {
          taxInfomation.taxes.push({
            taxRate: article.taxInside,
            amount: menuDrinkPrice-menuDrinkTax,
            tax: menuDrinkTax,
          })
        } else {
          taxInfomation.taxes[menuDrinkTaxIndex].tax+=menuDrinkTax
          taxInfomation.taxes[menuDrinkTaxIndex].amount+=menuDrinkPrice-menuDrinkTax
        }
        taxInfomation.netto+=menuDrinkPrice-menuDrinkTax
        taxInfomation.brutto+=menuDrinkPrice
      }
      break

    case DineLocation.TAKE_OUT:
      if (article.price) {
        // Calculate price and taxes of the article
        const price: number=article.price*article.amount
        const tax: number=(price*article.taxOutside)/100

        const taxIndex=taxInfomation.taxes.findIndex((tax): boolean => tax.taxRate===article.taxOutside)

        if (taxIndex===-1) {
          taxInfomation.taxes.push({
            taxRate: article.taxOutside,
            amount: price-tax,
            tax: tax,
          })
        } else {
          taxInfomation.taxes[taxIndex].tax+=tax
          taxInfomation.taxes[taxIndex].amount+=price-tax
        }
        taxInfomation.netto+=price-tax
        taxInfomation.brutto+=price
      }

      // Calculate taxes for extras
      article.modifiers.forEach(extra => {
        if (extra.price) {
          const extraPrice: number=extra.price*extra.amount
          const extraTax: number=(extraPrice*article.taxOutside)/100

          const extraTaxIndex=taxInfomation.taxes.findIndex(
            (tax): boolean => tax.taxRate===article.taxOutside,
          )

          if (extraTaxIndex===-1) {
            taxInfomation.taxes.push({
              taxRate: article.taxOutside,
              amount: extraPrice-extraTax,
              tax: extraTax,
            })
          } else {
            taxInfomation.taxes[extraTaxIndex].tax+=extraTax
            taxInfomation.taxes[extraTaxIndex].amount+=extraPrice-extraTax
          }
          taxInfomation.netto+=extraPrice-extraTax
          taxInfomation.brutto+=extraPrice
        }
      })

      // Calculate taxes for side dish
      if (article.menuSideDish&&article.menuSideDish.price) {
        const sideDishPrice: number=article.menuSideDish.price
        const sideDishTax: number=(sideDishPrice*article.taxOutside)/100

        const sideDishTaxIndex=taxInfomation.taxes.findIndex(
          (tax): boolean => tax.taxRate===article.taxOutside,
        )

        if (sideDishTaxIndex===-1) {
          taxInfomation.taxes.push({
            taxRate: article.taxOutside,
            amount: sideDishPrice-sideDishTax,
            tax: sideDishTax,
          })
        } else {
          taxInfomation.taxes[sideDishTaxIndex].tax+=sideDishTax
          taxInfomation.taxes[sideDishTaxIndex].amount+=sideDishPrice-sideDishTax
        }
        taxInfomation.netto+=sideDishPrice-sideDishTax
        taxInfomation.brutto+=sideDishPrice
      }

      // Calculate taxes for menu drink
      if (article.menuDrink&&article.menuDrink.price) {
        const menuDrinkPrice: number=article.menuDrink.price
        const menuDrinkTax: number=(menuDrinkPrice*article.taxOutside)/100

        const menuDrinkTaxIndex=taxInfomation.taxes.findIndex(tax => tax.taxRate===article.taxOutside)

        if (menuDrinkTaxIndex===-1) {
          taxInfomation.taxes.push({
            taxRate: article.taxOutside,
            amount: menuDrinkPrice-menuDrinkTax,
            tax: menuDrinkTax,
          })
        } else {
          taxInfomation.taxes[menuDrinkTaxIndex].tax+=menuDrinkTax
          taxInfomation.taxes[menuDrinkTaxIndex].amount+=menuDrinkPrice-menuDrinkTax
        }
        taxInfomation.netto+=menuDrinkPrice-menuDrinkTax
        taxInfomation.brutto+=menuDrinkPrice
      }
      break

    default:
      break
  }
  return taxInfomation
}

export function calculateTaxSummary(order: Order): TaxInfo {
  const taxInformation: TaxInfo=getDefaultTaxSummary()

  const dineLocation: string = order.dineLocation

  order.lineItems.forEach((article: OrderLineItemSchema): void => {
    const articleTaxInformation=calculateArticleTaxInfomation(article, dineLocation)

    articleTaxInformation.taxes.forEach((articleTax): void => {
      const taxIndex=taxInformation.taxes.findIndex((tax): boolean => tax.taxRate===articleTax.taxRate)

      if (taxIndex===-1) {
        taxInformation.taxes.push(articleTax)
      } else {
        taxInformation.taxes[taxIndex].amount+=articleTax.amount
        taxInformation.taxes[taxIndex].tax+=articleTax.tax
      }
    })
    taxInformation.netto+=articleTaxInformation.netto
    taxInformation.brutto+=articleTaxInformation.brutto
  })

  // Set discount if available
  if (order.discount) {
    if (order.discount.discountType===DiscountType.PERCENT) {
      taxInformation.brutto=taxInformation.brutto-(taxInformation.brutto*order.discount.discount)/100
      taxInformation.netto=taxInformation.netto-(taxInformation.netto*order.discount.discount)/100
      taxInformation.taxes.forEach((tax): void => {
        if (order.discount) {
          tax.amount=tax.amount-(tax.amount*order.discount.discount)/100
          tax.tax=tax.tax-(tax.tax*order.discount.discount)/100
        }
      })
    } else if (order.discount.discountType===DiscountType.AMOUNT) {
      if (order.discount.discount>taxInformation.brutto) {
        taxInformation.brutto=0
        taxInformation.netto=0
        taxInformation.taxes.forEach((tax): void => {
          tax.amount=0
          tax.tax=0
        })
      } else {
        const oldBrutto: number=taxInformation.brutto

        taxInformation.brutto=taxInformation.brutto-order.discount.discount
        taxInformation.netto=0
        taxInformation.taxes.forEach(tax => {
          if (order.discount) {
            const factor: number=(tax.amount+tax.tax)/oldBrutto
            const discountToDivide: number=order.discount.discount*factor
            const texRatePropotion: number=(discountToDivide/100)*tax.taxRate
            tax.tax-=texRatePropotion
            tax.amount=tax.amount-discountToDivide+texRatePropotion
            taxInformation.netto+=tax.amount
          }
        })
      }
    }
  }

  taxInformation.taxes.forEach((tax): void => {
    tax.amount=parseFloat(tax.amount.toFixed(2))
    tax.tax=parseFloat(tax.tax.toFixed(2))
  })
  taxInformation.netto=parseFloat(taxInformation.netto.toFixed(2))
  taxInformation.brutto=parseFloat(taxInformation.brutto.toFixed(2))

  return taxInformation
}
