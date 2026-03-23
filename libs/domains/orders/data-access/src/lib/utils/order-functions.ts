import { Order } from '../models/order.model'
import { GenericOrderLineItemSchema, OrderLineItemSchema } from '../models/order-line-item.model'
import { ProductSchema } from '../../../../../products/data-access/src/lib/models/product.model'
import { ProductService } from '../../../../../products/data-access/src/lib/services/product.service'
import {
  IngredientReferenceSchema,
} from '../../../../../ingredients/data-access/src/lib/models/ingredient-reference.model'
import { RecipeReferenceSchema } from '../../../../../recipes/data-access/src/lib/models/recipe-reference.model'
import { Id } from '@feathersjs/feathers'

export function getOrderArticles(orderItem: Order): OrderLineItemSchema[] {
  return [...orderItem.lineItems]
}

export function getCombinations(order: Order): OrderLineItemSchema[][] {
  if (!order.lineItems) return []
  const bundles = new Map<number, OrderLineItemSchema[]>()
  order.lineItems.forEach(item => {
    if (item.bundleNumber !== undefined && item.bundleNumber !== null) {
      if (!bundles.has(item.bundleNumber)) {
        bundles.set(item.bundleNumber, [])
      }
      bundles.get(item.bundleNumber)?.push(item)
    }
  })
  return Array.from(bundles.values())
}

export function getUnbundledLineItems(order: Order): OrderLineItemSchema[] {
  if (!order.lineItems) return []
  return order.lineItems.filter(item => item.bundleNumber === undefined || item.bundleNumber === null)
}

export function getRecipeItemReferences(
  orderArticleItem: OrderLineItemSchema,
  mode = 'retain',
  productService: ProductService | null = null,
): IngredientReferenceSchema[] {
  let recipeItems: IngredientReferenceSchema[] = []

  if (mode === 'update') {
    if (!productService) throw Error(`No ArticleService available`)

    const mainArticle: undefined | ProductSchema = productService.findProductById(orderArticleItem._id)
    if (!mainArticle) return recipeItems

    recipeItems = getRecipeItemReferencesFromArticle(mainArticle)
    recipeItems = getRecipeItemReferencesFromExtras(orderArticleItem, recipeItems, productService)
    recipeItems = getRecipeItemReferencesFromProducts(orderArticleItem, recipeItems, productService)
  } else {
    recipeItems = getRecipeItemReferencesFromArticle(orderArticleItem)
    recipeItems = getRecipeItemReferencesFromExtras(orderArticleItem, recipeItems)
    recipeItems = getRecipeItemReferencesFromProducts(orderArticleItem, recipeItems)
  }
  return recipeItems
}

function getRecipeItemReferencesFromArticle(
  orderArticleItem: OrderLineItemSchema | ProductSchema,
): IngredientReferenceSchema[] {
  return [...(orderArticleItem.ingredientReferences || [])]
}

function getRecipeItemReferencesFromExtras(
  orderArticleItem: OrderLineItemSchema,
  recipeItems: IngredientReferenceSchema[],
  articleService: ProductService | null = null,
): IngredientReferenceSchema[] {
  orderArticleItem.modifiers.forEach((extra: GenericOrderLineItemSchema): void => {
    const extraRecipeItemReferences: IngredientReferenceSchema[] = articleService
      ? getArticleByIdAndExtractRecipeItemReferences(articleService, extra._id)
      : extra.ingredientReferences
    recipeItems.push(...extraRecipeItemReferences)
  })
  return recipeItems
}

function getRecipeItemReferencesFromProducts(
  orderLineItem: OrderLineItemSchema,
  ingredientReference: IngredientReferenceSchema[],
  productService: ProductService | null = null,
): IngredientReferenceSchema[] {
  if (orderLineItem.isMenu) {
    if (orderLineItem.menuSideDish) {
      const sideDishRecipeItemReferences: IngredientReferenceSchema[] = productService
        ? getArticleByIdAndExtractRecipeItemReferences(productService, orderLineItem.menuSideDish._id)
        : orderLineItem.menuSideDish.ingredientReferences
      ingredientReference.push(...sideDishRecipeItemReferences)
    }
    if (orderLineItem.menuDrink) {
      const drinkRecipeItemReferences: IngredientReferenceSchema[] = productService
        ? getArticleByIdAndExtractRecipeItemReferences(productService, orderLineItem.menuDrink._id)
        : orderLineItem.menuDrink.ingredientReferences
      ingredientReference.push(...drinkRecipeItemReferences)
    }
  }
  return ingredientReference
}

function getArticleByIdAndExtractRecipeItemReferences(
  articleService: ProductService,
  id: Id,
): IngredientReferenceSchema[] {
  const article: undefined | ProductSchema = articleService.findProductById(id)
  return article ? [...(article.ingredientReferences || [])] : []
}

export function getRecipeReferences(
  orderArticleItem: OrderLineItemSchema,
  mode = 'retain',
  articleService: ProductService | null = null,
): RecipeReferenceSchema[] {
  let recipes: RecipeReferenceSchema[] = []

  if (mode === 'update') {
    if (!articleService) throw Error(`No ArticleService available`)

    const mainArticle: undefined | ProductSchema = articleService.findProductById(orderArticleItem._id)
    if (!mainArticle) return recipes

    recipes = getRecipesFromArticle(mainArticle)
    recipes = getRecipesFromExtras(orderArticleItem, recipes, articleService)
    recipes = getRecipesFromPrducts(orderArticleItem, recipes, articleService)
  } else {
    recipes = getRecipesFromArticle(orderArticleItem)
    recipes = getRecipesFromExtras(orderArticleItem, recipes)
    recipes = getRecipesFromPrducts(orderArticleItem, recipes)
  }
  return recipes
}

function getRecipesFromArticle(orderArticleItem: OrderLineItemSchema | ProductSchema): RecipeReferenceSchema[] {
  return [...(orderArticleItem.recipeReferences || [])]
}

function getRecipesFromExtras(
  orderArticleItem: OrderLineItemSchema,
  orderRecipes: RecipeReferenceSchema[],
  articleService: ProductService | null = null,
): RecipeReferenceSchema[] {
  orderArticleItem.modifiers.forEach((extra: GenericOrderLineItemSchema): void => {
    const extraRecipes: RecipeReferenceSchema[] = articleService
      ? getArticleByIdAndExtractRecipes(articleService, extra._id)
      : extra.recipeReferences
    orderRecipes.push(...extraRecipes)
  })
  return orderRecipes
}

function getRecipesFromPrducts(
  orderLineItem: OrderLineItemSchema,
  recipeReference: RecipeReferenceSchema[],
  productService: ProductService | null = null,
): RecipeReferenceSchema[] {
  if (orderLineItem.isMenu) {
    if (orderLineItem.menuSideDish) {
      const sideDishRecipes: RecipeReferenceSchema[] = productService
        ? getArticleByIdAndExtractRecipes(productService, orderLineItem.menuSideDish._id)
        : orderLineItem.menuSideDish.recipeReferences
      recipeReference.push(...sideDishRecipes)
    }
    if (orderLineItem.menuDrink) {
      const drinkRecipes: RecipeReferenceSchema[] = productService
        ? getArticleByIdAndExtractRecipes(productService, orderLineItem.menuDrink._id)
        : orderLineItem.menuDrink.recipeReferences
      recipeReference.push(...drinkRecipes)
    }
  }
  return recipeReference
}

function getArticleByIdAndExtractRecipes(productService: ProductService, id: Id): RecipeReferenceSchema[] {
  const product: undefined | ProductSchema = productService.findProductById(id)

  return product ? [...(product.recipeReferences || [])] : []
}
