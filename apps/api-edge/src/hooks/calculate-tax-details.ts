import { HookContext } from '@feathersjs/feathers'
import { Order, OrderLineItem, TaxInfo } from '@panary/orders/domain'

function calculateTaxForOrderLineItem(
  lineItems: OrderLineItem,
  dineLocation: 'dine-in' | 'take-out'
): TaxInfo {
  const taxInfo: TaxInfo = { taxes: [], netto: 0.0, brutto: 0.0 }

  switch (dineLocation) {
    case 'dine-in':
      if (lineItems.price) {
        // Calculate price and taxes of the menu item
        const price = lineItems.price * lineItems.amount
        const tax = (price * lineItems.taxInside) / 100
        const taxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxInside)
        if (taxIndex === -1) {
          taxInfo.taxes.push({ taxRate: lineItems.taxInside, amount: price - tax, tax: tax })
        } else {
          taxInfo.taxes[taxIndex].tax += tax
          taxInfo.taxes[taxIndex].amount += price
        }
        taxInfo.netto += price - tax
        taxInfo.brutto += price
      }
      // Calculate taxes for modifiers
      lineItems.modifiers.forEach(extra => {
        if (extra.price) {
          const extraPrice = extra.price * extra.amount
          const extraTax = (extraPrice * lineItems.taxInside) / 100
          const extraTaxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxInside)
          if (extraTaxIndex === -1) {
            taxInfo.taxes.push({
              taxRate: lineItems.taxInside,
              amount: extraPrice - extraTax,
              tax: extraTax
            })
          } else {
            taxInfo.taxes[extraTaxIndex].tax += extraTax
            taxInfo.taxes[extraTaxIndex].amount += extraPrice - extraTax
          }
          taxInfo.netto += extraPrice - extraTax
          taxInfo.brutto += extraPrice
        }
      })
      // Calculate taxes for side dish
      if (lineItems.menuSideDish && lineItems.menuSideDish.price) {
        const sideDishPrice = lineItems.menuSideDish.price
        const sideDishTax = (sideDishPrice * lineItems.taxInside) / 100
        const sideDishTaxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxInside)
        if (sideDishTaxIndex === -1) {
          taxInfo.taxes.push({
            taxRate: lineItems.taxInside,
            amount: sideDishPrice - sideDishTax,
            tax: sideDishTax
          })
        } else {
          taxInfo.taxes[sideDishTaxIndex].tax += sideDishTax
          taxInfo.taxes[sideDishTaxIndex].amount += sideDishPrice - sideDishTax
        }
        taxInfo.netto += sideDishPrice - sideDishTax
        taxInfo.brutto += sideDishPrice
      }
      // Calculate taxes for menu drink
      if (lineItems.menuDrink && lineItems.menuDrink.price) {
        const menuDrinkPrice = lineItems.menuDrink.price
        const menuDrinkTax = (menuDrinkPrice * lineItems.taxInside) / 100
        const menuDrinkTaxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxInside)
        if (menuDrinkTaxIndex === -1) {
          taxInfo.taxes.push({
            taxRate: lineItems.taxInside,
            amount: menuDrinkPrice - menuDrinkTax,
            tax: menuDrinkTax
          })
        } else {
          taxInfo.taxes[menuDrinkTaxIndex].tax += menuDrinkTax
          taxInfo.taxes[menuDrinkTaxIndex].amount += menuDrinkPrice - menuDrinkTax
        }
        taxInfo.netto += menuDrinkPrice - menuDrinkTax
        taxInfo.brutto += menuDrinkPrice
      }
      break

    case 'take-out':
      if (lineItems.price) {
        // Calculate price and taxes of the menu item
        const price = lineItems.price * lineItems.amount
        const tax = (price * lineItems.taxOutside) / 100
        const taxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxOutside)
        if (taxIndex === -1) {
          taxInfo.taxes.push({ taxRate: lineItems.taxOutside, amount: price - tax, tax: tax })
        } else {
          taxInfo.taxes[taxIndex].tax += tax
          taxInfo.taxes[taxIndex].amount += price - tax
        }
        taxInfo.netto += price - tax
        taxInfo.brutto += price
      }
      // Calulate taxes for modifiers
      lineItems.modifiers.forEach(extra => {
        if (extra.price) {
          const extraPrice = extra.price * extra.amount
          const extraTax = (extraPrice * lineItems.taxOutside) / 100
          const extraTaxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxOutside)
          if (extraTaxIndex === -1) {
            taxInfo.taxes.push({
              taxRate: lineItems.taxOutside,
              amount: extraPrice - extraTax,
              tax: extraTax
            })
          } else {
            taxInfo.taxes[extraTaxIndex].tax += extraTax
            taxInfo.taxes[extraTaxIndex].amount += extraPrice - extraTax
          }
          taxInfo.netto += extraPrice - extraTax
          taxInfo.brutto += extraPrice
        }
      })
      // Calculate taxes for side dish
      if (lineItems.menuSideDish && lineItems.menuSideDish.price) {
        const sideDishPrice = lineItems.menuSideDish.price
        const sideDishTax = (sideDishPrice * lineItems.taxOutside) / 100
        const sideDishTaxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxOutside)
        if (sideDishTaxIndex === -1) {
          taxInfo.taxes.push({
            taxRate: lineItems.taxOutside,
            amount: sideDishPrice - sideDishTax,
            tax: sideDishTax
          })
        } else {
          taxInfo.taxes[sideDishTaxIndex].tax += sideDishTax
          taxInfo.taxes[sideDishTaxIndex].amount += sideDishPrice - sideDishTax
        }
        taxInfo.netto += sideDishPrice - sideDishTax
        taxInfo.brutto += sideDishPrice
      }
      // Calculate taxes for menu drink
      if (lineItems.menuDrink && lineItems.menuDrink.price) {
        const menuDrinkPrice = lineItems.menuDrink.price
        const menuDrinkTax = (menuDrinkPrice * lineItems.taxOutside) / 100
        const menuDrinkTaxIndex = taxInfo.taxes.findIndex(tax => tax.taxRate === lineItems.taxOutside)
        if (menuDrinkTaxIndex === -1) {
          taxInfo.taxes.push({
            taxRate: lineItems.taxOutside,
            amount: menuDrinkPrice - menuDrinkTax,
            tax: menuDrinkTax
          })
        } else {
          taxInfo.taxes[menuDrinkTaxIndex].tax += menuDrinkTax
          taxInfo.taxes[menuDrinkTaxIndex].amount += menuDrinkPrice - menuDrinkTax
        }
        taxInfo.netto += menuDrinkPrice - menuDrinkTax
        taxInfo.brutto += menuDrinkPrice
      }
      break

    default:
      break
  }
  return taxInfo
}

function calculateTaxForOrder(order: Order): TaxInfo {
  const dineLocation = order.dineLocation // INSIDE = 'dine-in', OUTSIDE = 'take-out'

  const taxInformation: TaxInfo = { taxes: [], netto: 0.0, brutto: 0.0 }

  order.lineItems.forEach((lineItem: OrderLineItem) => {
    const taxInfo = calculateTaxForOrderLineItem(lineItem, dineLocation)

    taxInfo.taxes.forEach(taxItem => {
      const taxIndex = taxInformation.taxes.findIndex(tax => tax.taxRate === taxItem.taxRate)

      if (taxIndex === -1) {
        taxInformation.taxes.push(taxItem)
      } else {
        taxInformation.taxes[taxIndex].amount += taxItem.amount
        taxInformation.taxes[taxIndex].tax += taxItem.tax
      }
    })
    taxInformation.netto += taxInfo.netto
    taxInformation.brutto += taxInfo.brutto
  })

  // Set discount if available
  if (order.discount) {
    if (order.discount.discountType === 'percent') {
      taxInformation.netto = taxInformation.netto - (taxInformation.netto * order.discount.discount) / 100
      taxInformation.brutto = taxInformation.brutto - (taxInformation.brutto * order.discount.discount) / 100
      taxInformation.taxes.forEach(tax => {
        if (order.discount) {
          tax.amount = tax.amount - (tax.amount * order.discount.discount) / 100
          tax.tax = tax.tax - (tax.tax * order.discount.discount) / 100
        }
      })
    } else if (order.discount.discountType === 'amount') {
      if (order.discount.discount > taxInformation.brutto) {
        taxInformation.brutto = 0.0
        taxInformation.netto = 0.0
        taxInformation.taxes.forEach(tax => {
          tax.amount = 0.0
          tax.tax = 0.0
        })
      } else {
        const oldBrutto = taxInformation.brutto
        taxInformation.brutto = taxInformation.brutto - order.discount.discount
        taxInformation.netto = 0.0
        taxInformation.taxes.forEach(tax => {
          if (order.discount) {
            const factor = (tax.amount + tax.tax) / oldBrutto
            const discountToDivide = order.discount.discount * factor
            const texRateProportion = (discountToDivide / 100) * tax.taxRate
            tax.tax -= texRateProportion
            tax.amount = tax.amount - discountToDivide + texRateProportion
            taxInformation.netto += tax.amount
          }
        })
      }
    }
  }

  taxInformation.taxes.forEach(tax => {
    tax.amount = parseFloat(tax.amount.toFixed(2))
    tax.tax = parseFloat(tax.tax.toFixed(2))
  })
  taxInformation.netto = parseFloat(taxInformation.netto.toFixed(2))
  taxInformation.brutto = parseFloat(taxInformation.brutto.toFixed(2))

  return taxInformation
}

export const calculateTaxDetails = async (context: HookContext) => {
  const order = context.data as Order
  context.data.taxSnapshot = calculateTaxForOrder(order)
}

export const calculateTaxDetailsOnPatch = async (context: HookContext) => {
  const id = context.id
  const data = context.data as Order

  if (!id) {
    return
  }

  const order = await context.app.service('orders').get(id)
  if (order && data.discount) {
    order.discount = data.discount
    context.data.taxSnapshot = calculateTaxForOrder(order)
  }
}
