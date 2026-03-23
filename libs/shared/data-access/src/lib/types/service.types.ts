// Typen und Interfaces für Services

export type ServiceName =
  | 'apikeyService'
  | 'businessDayService'
  | 'corporateCustomerService'
  | 'incomingGoodService'
  | 'ingredientService'
  | 'inventoryService'
  | 'invoiceService'
  | 'locationService'
  | 'productGroupService'
  | 'productService'
  | 'orderInteractionService'
  | 'orderService'
  | 'organizationService'
  | 'pricelistService'
  | 'privateCustomerService'
  | 'recipeService'
  | 'smartcardService'
  | 'userPreferencesService'
  | 'userService'
  | 'workingTimeService'

// Optional: weitere Typen aus connection.service.ts auslagern
// z.B. ServiceTypes, falls benötigt

// Hinweis: Die Verbindung zu ConnectionService wird in base.service.ts nur zur Laufzeit per inject hergestellt, nicht für Typen.
