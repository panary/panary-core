import { type Static, Type } from '@feathersjs/typebox'

export const ingredientReferenceSchema = Type.Object({
  externalId: Type.String({ format: 'uuid' }),
  version: Type.Integer({ minimum: 0 }),

  ingredientName: Type.String({ maxLength: 255 }),
  displayName: Type.Optional(Type.String({ maxLength: 255 })),
  initialQuantity: Type.Number({ minimum: 0 }),
  quantity: Type.Number({ minimum: 0 }),

  isInvalid: Type.Optional(Type.Boolean()),
  isRemovable: Type.Optional(Type.Boolean({ default: false })),
  priceAdjustment: Type.Optional(Type.Number({ default: 0 })),
  onlyOutsideConsumption: Type.Boolean(),
})

export type IngredientReference = Static<typeof ingredientReferenceSchema>

export const recipeReferenceSchema = Type.Object({
  externalId: Type.String({ format: 'uuid' }),
  version: Type.Integer({ minimum: 0 }),
  recipeName: Type.String({ maxLength: 255 }),
  recipeBaseUnit: Type.String({ maxLength: 32 }),
  recipeBaseQuantity: Type.Number({ minimum: 0 }),
  recipeIngredients: Type.Array(ingredientReferenceSchema, { maxItems: 200 }),
  initialQuantity: Type.Number({ minimum: 0 }),
  quantity: Type.Number({ minimum: 0 }),
  isRemovable: Type.Optional(Type.Boolean({ default: false })),
  priceAdjustment: Type.Optional(Type.Number({ default: 0 })),
})

export type RecipeReference = Static<typeof recipeReferenceSchema>
