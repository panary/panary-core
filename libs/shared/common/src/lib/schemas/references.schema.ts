import { type Static, Type } from '@feathersjs/typebox'

export const ingredientReferenceSchema = Type.Object({
  externalId: Type.String({ format: 'uuid' }),
  version: Type.Number(),

  ingredientName: Type.String(),
  displayName: Type.Optional(Type.String()),
  initialQuantity: Type.Number(),
  quantity: Type.Number(),

  isInvalid: Type.Optional(Type.Boolean()),
  isRemovable: Type.Optional(Type.Boolean({ default: false })),
  priceAdjustment: Type.Optional(Type.Number({ default: 0 })),
  onlyOutsideConsumption: Type.Boolean(),
})

export type IngredientReference = Static<typeof ingredientReferenceSchema>

export const recipeReferenceSchema = Type.Object({
  externalId: Type.String({ format: 'uuid' }),
  version: Type.Number(),
  recipeName: Type.String(),
  recipeBaseUnit: Type.String(),
  recipeBaseQuantity: Type.Number(),
  recipeIngredients: Type.Array(ingredientReferenceSchema),
  initialQuantity: Type.Number(),
  quantity: Type.Number(),
  isRemovable: Type.Optional(Type.Boolean({ default: false })),
  priceAdjustment: Type.Optional(Type.Number({ default: 0 })),
})

export type RecipeReference = Static<typeof recipeReferenceSchema>
