/**
 * Migrationsskript: Produktivdaten aus MongoDB-Export → panary-core SQLite
 *
 * Liest die vier JSON-Exporte aus migration/ und fügt die Daten
 * in die panary-core SQLite-Datenbank ein.
 *
 * Ausführung: cd panary-core && npx tsx scripts/migrate-legacy-data.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import knex from 'knex'
import { v5 as uuidv5 } from 'uuid'
import { uuidv7 } from 'uuidv7'

// ── Konfiguration ──────────────────────────────────────────────────────────────

const MIGRATION_NAMESPACE = '4a1c7b30-e6f1-4d3a-b8c2-9f0d1a2e3b4c' // Fester Namespace für UUID v5
const DEV_TENANT_ID = '01968000-0000-7000-8000-000000000001'
const DEV_LOCATION_ID = '01968000-0000-7000-8000-000000000002'

const MIGRATION_DIR = resolve(__dirname, '../../migration')
const DB_PATH = resolve(__dirname, '../data/api-edge.sqlite')

// ── Datenbank-Verbindung ───────────────────────────────────────────────────────

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: DB_PATH },
  useNullAsDefault: true,
})

/** Ingredients-Tabelle anlegen, falls sie noch nicht existiert */
async function ensureIngredientsTable(): Promise<void> {
  const exists = await db.schema.hasTable('ingredients')
  if (exists) return

  console.log('  Erstelle ingredients-Tabelle...')
  await db.schema.createTable('ingredients', table => {
    table.string('_id').primary()
    table.string('tenantId').notNullable()
    table.string('locationId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()
    table.string('externalId').nullable()
    table.string('status').nullable().defaultTo('DRAFT')
    table.string('name').notNullable()
    table.string('manufacturer').nullable()
    table.string('category').nullable()
    table.string('basicUnit').notNullable()
    table.float('basicUnitPrice').defaultTo(0)
    table.float('packagingUnit').defaultTo(0)
    table.float('packagingUnitPrice').defaultTo(0)
    table.float('cartonUnit').defaultTo(0)
    table.float('cartonUnitPrice').defaultTo(0)
    table.boolean('onlyOutsideConsumption').defaultTo(false)
  })

  await db.raw('CREATE INDEX IF NOT EXISTS "idx_ingredients_tenant" ON "ingredients" (tenantId)')
  await db.raw('CREATE INDEX IF NOT EXISTS "idx_ingredients_tenant_location" ON "ingredients" (tenantId, locationId)')
  await db.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS "idx_ingredients_tenant_external_unique" ON "ingredients" (tenantId, externalId) WHERE externalId IS NOT NULL',
  )
  console.log('  ✓ ingredients-Tabelle erstellt')
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────

/** MongoDB ObjectId → deterministischer UUID v5 */
function mongoIdToUuid(mongoId: string): string {
  return uuidv5(mongoId, MIGRATION_NAMESPACE)
}

/** ObjectId aus {$oid: "..."} oder direktem String extrahieren */
function extractId(ref: { $oid: string } | string): string {
  if (typeof ref === 'string') return ref
  return ref.$oid
}

/** Farbwert normalisieren (benannte Farben → Hex) */
function normalizeColor(color: string | undefined): string {
  const colorMap: Record<string, string> = {
    gray: '#808080',
    blue: '#0000FF',
    olive: '#808000',
    green: '#008000',
    red: '#FF0000',
    orange: '#FFA500',
    purple: '#800080',
    brown: '#A52A2A',
    teal: '#008080',
    navy: '#000080',
    maroon: '#800000',
    lime: '#00FF00',
    aqua: '#00FFFF',
    silver: '#C0C0C0',
    yellow: '#FFFF00',
    coral: '#FF7F50',
  }

  if (!color) return '#808080'
  if (color.startsWith('#') || color.startsWith('rgb')) return color
  return colorMap[color.toLowerCase()] || '#808080'
}

const now = new Date().toISOString()

// ── JSON einlesen ──────────────────────────────────────────────────────────────

interface MongoRef {
  $oid: string
}

interface ArticleGroup {
  _id: MongoRef
  name: string
  acronym?: string
  index: number
  color?: string
  excluded?: boolean
  taxInside?: number
  taxOutside?: number
  createdAt?: string
  updatedAt?: string
}

interface RecipeItem {
  itemId: MongoRef
  name: string
  quantity: number
  basicUnit: string
  onlyOutsideConsumption?: boolean
}

interface RecipeRef {
  recipeId: MongoRef
  name: string
  quantity: number
}

interface Article {
  _id: MongoRef
  name: string
  acronym?: string
  index?: number
  articleGroupId?: MongoRef
  price: number
  taxInside?: number
  taxOutside?: number
  showExtrasAfterSelect?: boolean
  showSaucesAfterSelect?: boolean
  menuFilterType?: string
  isInvalid?: boolean
  isMenu?: boolean
  isExtra?: boolean
  isMenuDrink?: boolean
  isMenuSideDish?: boolean
  isMenuSideDishSouce?: boolean
  recipeItems?: RecipeItem[]
  recipes?: RecipeRef[]
  soucen?: MongoRef[]
  extras?: MongoRef[] | null
  drinks?: MongoRef[]
  sideDishes?: string[]
  ingredients?: unknown[]
  successorParentId?: MongoRef | null
  createdAt?: string
  updatedAt?: string
}

interface Item {
  _id: MongoRef
  name: string
  manufacturer?: string
  description?: string
  itemnumber?: number
  category?: string
  image?: string
  basicunit: string
  basicunitprice?: number
  basicunitinventory?: number
  packagingunit?: number
  packagingunitprice?: number
  packagingunitinventory?: number
  cartonunit?: number
  cartonunitprice?: number
  cartonunitinventory?: number
  inventory?: number
  consumption?: number
  purchase?: number
  stock?: number
  stock2?: number
  openingBalance?: number
  createdAt?: string
  updatedAt?: string
}

interface Recipe {
  _id: MongoRef
  name: string
  basicUnit: string
  basicQuantity: number
  recipeItems: RecipeItem[]
  createdAt?: string
  updatedAt?: string
}

function loadJson<T>(filename: string): T[] {
  const path = resolve(MIGRATION_DIR, filename)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

// ── Daten laden ────────────────────────────────────────────────────────────────

const articleGroups = loadJson<ArticleGroup>('rospos-prod.article-groups.json')
const articles = loadJson<Article>('rospos-prod.articles.json')
const items = loadJson<Item>('rospos-prod.items.json')
const recipes = loadJson<Recipe>('rospos-prod.recipes.json')

// Lookup-Maps
const recipeById = new Map<string, Recipe>()
for (const r of recipes) {
  recipeById.set(r._id.$oid, r)
}

const articleById = new Map<string, Article>()
for (const a of articles) {
  articleById.set(a._id.$oid, a)
}

// ID-Mapping: Alte MongoDB-ID → neue _id (uuidv7) für die Datenbank
// externalId bleibt UUID v5 aus der MongoDB-ID
const idMap = new Map<string, string>() // mongoId → new uuidv7 _id

function getOrCreateId(mongoId: string): string {
  if (!idMap.has(mongoId)) {
    idMap.set(mongoId, uuidv7())
  }
  return idMap.get(mongoId)!
}

// ── Phase 1: Product Groups ────────────────────────────────────────────────────

async function migrateProductGroups(): Promise<void> {
  console.log(`\n── Phase 1: Product Groups (${articleGroups.length}) ──`)

  for (const ag of articleGroups) {
    const mongoId = ag._id.$oid
    const newId = getOrCreateId(mongoId)

    await db('product-groups').insert({
      _id: newId,
      tenantId: DEV_TENANT_ID,
      locationId: DEV_LOCATION_ID,
      createdAt: ag.createdAt || now,
      updatedAt: ag.updatedAt || now,
      externalId: mongoIdToUuid(mongoId),
      status: 'ACTIVE',
      name: ag.name,
      acronym: ag.acronym || '',
      color: normalizeColor(ag.color),
      excluded: ag.excluded ?? false,
      index: ag.index ?? 0,
      taxInside: ag.taxInside ?? 19,
      taxOutside: ag.taxOutside ?? 7,
    })
  }

  console.log(`  ✓ ${articleGroups.length} Product Groups eingefügt`)
}

// ── Phase 2: Ingredients ───────────────────────────────────────────────────────

async function migrateIngredients(): Promise<void> {
  console.log(`\n── Phase 2: Ingredients (${items.length}) ──`)

  for (const item of items) {
    const mongoId = item._id.$oid
    const newId = getOrCreateId(mongoId)
    const isPackaging = item.category?.toLowerCase() === 'verpackung'

    await db('ingredients').insert({
      _id: newId,
      tenantId: DEV_TENANT_ID,
      locationId: DEV_LOCATION_ID,
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
      externalId: mongoIdToUuid(mongoId),
      status: 'ACTIVE',
      name: item.name,
      manufacturer: item.manufacturer || null,
      category: item.category || null,
      basicUnit: item.basicunit,
      basicUnitPrice: item.basicunitprice ?? 0,
      packagingUnit: item.packagingunit ?? 0,
      packagingUnitPrice: item.packagingunitprice ?? 0,
      cartonUnit: item.cartonunit ?? 0,
      cartonUnitPrice: item.cartonunitprice ?? 0,
      onlyOutsideConsumption: isPackaging,
    })
  }

  console.log(`  ✓ ${items.length} Ingredients eingefügt`)
}

// ── Phase 3: Produkte ──────────────────────────────────────────────────────────

/** RecipeReferences für ein Produkt aufbauen */
function buildRecipeReferences(article: Article): object[] {
  const refs: object[] = []

  // Direkte Zutaten → Synthetische Rezeptur
  if (article.recipeItems && article.recipeItems.length > 0) {
    refs.push({
      externalId: uuidv5(article._id.$oid + '_direct_recipe', MIGRATION_NAMESPACE),
      version: 1,
      recipeName: `Rezeptur: ${article.name}`,
      recipeBaseUnit: 'Stk.',
      recipeBaseQuantity: 1,
      recipeIngredients: article.recipeItems.map(ri => ({
        externalId: mongoIdToUuid(ri.itemId.$oid),
        version: 1,
        ingredientName: ri.name,
        initialQuantity: ri.quantity,
        quantity: ri.quantity,
        onlyOutsideConsumption: ri.onlyOutsideConsumption ?? false,
      })),
      initialQuantity: 1,
      quantity: 1,
    })
  }

  // Referenzierte Rezepturen (z.B. Tomatensauce, Pizzateig)
  if (article.recipes && article.recipes.length > 0) {
    for (const recipeRef of article.recipes) {
      const recipe = recipeById.get(recipeRef.recipeId.$oid)
      if (!recipe) {
        console.warn(`  ⚠ Rezept ${recipeRef.recipeId.$oid} (${recipeRef.name}) nicht gefunden`)
        continue
      }

      // Mengenverhältnis: Produktanteil / Rezeptgesamtmenge
      const ratio = recipe.basicQuantity > 0 ? recipeRef.quantity / recipe.basicQuantity : 1

      refs.push({
        externalId: mongoIdToUuid(recipe._id.$oid),
        version: 1,
        recipeName: recipe.name,
        recipeBaseUnit: recipe.basicUnit,
        recipeBaseQuantity: recipe.basicQuantity,
        recipeIngredients: recipe.recipeItems.map(ri => ({
          externalId: mongoIdToUuid(ri.itemId.$oid),
          version: 1,
          ingredientName: ri.name,
          initialQuantity: ri.quantity * ratio,
          quantity: ri.quantity * ratio,
          onlyOutsideConsumption: ri.onlyOutsideConsumption ?? false,
        })),
        initialQuantity: recipeRef.quantity,
        quantity: recipeRef.quantity,
      })
    }
  }

  return refs
}

/** OptionGroups für reguläre Produkte (Extras + Saucen) */
function buildProductOptionGroups(article: Article): object[] {
  const groups: object[] = []

  // Saucen (nur existierende Artikel referenzieren)
  if (article.soucen && article.soucen.length > 0) {
    const validOptions = article.soucen
      .map(ref => extractId(ref))
      .filter(id => articleById.has(id))
      .map(sauceId => ({ productId: getOrCreateId(sauceId) }))

    if (validOptions.length > 0) {
      groups.push({
        id: uuidv7(),
        name: 'Saucen & Dips',
        minSelections: 0,
        maxSelections: validOptions.length,
        freeQuantity: 0,
        options: validOptions,
      })
    }
  }

  // Extras (nur existierende Artikel referenzieren)
  if (article.extras && article.extras.length > 0) {
    const validOptions = article.extras
      .map(ref => extractId(ref))
      .filter(id => articleById.has(id))
      .map(extraId => ({
        productId: getOrCreateId(extraId),
        priceAdjustment: articleById.get(extraId)?.price ?? 0,
      }))

    if (validOptions.length > 0) {
      groups.push({
        id: uuidv7(),
        name: 'Extras',
        minSelections: 0,
        maxSelections: validOptions.length,
        freeQuantity: 0,
        options: validOptions,
      })
    }
  }

  return groups
}

/** OptionGroups für Menüs (Beilagen, Getränke, Extras) */
function buildMenuOptionGroups(article: Article): object[] {
  const groups: object[] = []

  // Menü Beilagen (nur existierende Artikel)
  if (article.sideDishes && article.sideDishes.length > 0) {
    const validOptions = article.sideDishes
      .map(id => (typeof id === 'string' ? id : extractId(id)))
      .filter(id => articleById.has(id))
      .map(mongoId => ({ productId: getOrCreateId(mongoId) }))

    if (validOptions.length > 0) {
      groups.push({
        id: uuidv7(),
        name: 'Menü Beilage',
        minSelections: 1,
        maxSelections: 1,
        freeQuantity: 1,
        options: validOptions,
      })
    }
  }

  // Menü Getränke (nur existierende Artikel)
  if (article.drinks && article.drinks.length > 0) {
    const validOptions = article.drinks
      .map(ref => extractId(ref))
      .filter(id => articleById.has(id))
      .map(drinkId => ({ productId: getOrCreateId(drinkId) }))

    if (validOptions.length > 0) {
      groups.push({
        id: uuidv7(),
        name: 'Menü Getränk',
        minSelections: 1,
        maxSelections: 1,
        freeQuantity: 1,
        options: validOptions,
      })
    }
  }

  // Extras für Menü (nur existierende Artikel)
  if (article.extras && article.extras.length > 0) {
    const validOptions = article.extras
      .map(ref => extractId(ref))
      .filter(id => articleById.has(id))
      .map(extraId => ({
        productId: getOrCreateId(extraId),
        priceAdjustment: articleById.get(extraId)?.price ?? 0,
      }))

    if (validOptions.length > 0) {
      groups.push({
        id: uuidv7(),
        name: 'Extras',
        minSelections: 0,
        maxSelections: validOptions.length,
        freeQuantity: 0,
        options: validOptions,
      })
    }
  }

  return groups
}

async function migrateProducts(): Promise<void> {
  const modifiers = articles.filter(a => a.isExtra === true)
  const menus = articles.filter(a => a.isMenu === true)
  const products = articles.filter(a => !a.isExtra && !a.isMenu)

  console.log(`\n── Phase 3: Produkte ──`)
  console.log(`  MODIFIER: ${modifiers.length}, PRODUCT: ${products.length}, BUNDLE: ${menus.length}`)

  // Durchgang 1: MODIFIER
  for (const article of modifiers) {
    const mongoId = article._id.$oid
    const newId = getOrCreateId(mongoId)
    const categoryId = article.articleGroupId ? getOrCreateId(article.articleGroupId.$oid) : null
    const recipeRefs = buildRecipeReferences(article)

    await db('products').insert({
      _id: newId,
      tenantId: DEV_TENANT_ID,
      locationId: DEV_LOCATION_ID,
      createdAt: article.createdAt || now,
      updatedAt: article.updatedAt || now,
      externalId: mongoIdToUuid(mongoId),
      status: 'ACTIVE',
      name: article.name,
      acronym: article.acronym || '',
      productType: 'MODIFIER',
      price: article.price ?? 0,
      taxInside: article.taxInside ?? 19,
      taxOutside: article.taxOutside ?? 7,
      categoryIds: JSON.stringify(categoryId ? [categoryId] : []),
      optionGroups: JSON.stringify([]),
      availability: JSON.stringify({ isActive: true }),
      ui: JSON.stringify({
        index: article.index ?? 0,
        showOptionsAuto: false,
        hideOnMainScreen: true,
      }),
      isInvalid: article.isInvalid ?? false,
      recipeReferences: JSON.stringify(recipeRefs),
    })
  }
  console.log(`  ✓ ${modifiers.length} MODIFIER eingefügt`)

  // Durchgang 2: PRODUCT (reguläre Produkte + Menü-Beilagen/Getränke)
  for (const article of products) {
    const mongoId = article._id.$oid
    const newId = getOrCreateId(mongoId)
    const categoryId = article.articleGroupId ? getOrCreateId(article.articleGroupId.$oid) : null
    const recipeRefs = buildRecipeReferences(article)
    const optionGroups = buildProductOptionGroups(article)

    // Menü-Beilagen und Menü-Getränke: hideOnMainScreen
    const isMenuComponent = article.isMenuDrink === true || article.isMenuSideDish === true || article.isMenuSideDishSouce === true

    await db('products').insert({
      _id: newId,
      tenantId: DEV_TENANT_ID,
      locationId: DEV_LOCATION_ID,
      createdAt: article.createdAt || now,
      updatedAt: article.updatedAt || now,
      externalId: mongoIdToUuid(mongoId),
      status: 'ACTIVE',
      name: article.name,
      acronym: article.acronym || '',
      productType: 'PRODUCT',
      price: article.price ?? 0,
      taxInside: article.taxInside ?? 19,
      taxOutside: article.taxOutside ?? 7,
      categoryIds: JSON.stringify(categoryId ? [categoryId] : []),
      optionGroups: JSON.stringify(optionGroups),
      availability: JSON.stringify({ isActive: true }),
      ui: JSON.stringify({
        index: article.index ?? 0,
        showOptionsAuto: article.showExtrasAfterSelect ?? false,
        hideOnMainScreen: isMenuComponent,
      }),
      isInvalid: article.isInvalid ?? false,
      recipeReferences: JSON.stringify(recipeRefs),
    })
  }
  console.log(`  ✓ ${products.length} PRODUCT eingefügt`)

  // Durchgang 3: BUNDLE (Menüs)
  for (const article of menus) {
    const mongoId = article._id.$oid
    const newId = getOrCreateId(mongoId)
    const categoryId = article.articleGroupId ? getOrCreateId(article.articleGroupId.$oid) : null
    const recipeRefs = buildRecipeReferences(article)
    const optionGroups = buildMenuOptionGroups(article)

    await db('products').insert({
      _id: newId,
      tenantId: DEV_TENANT_ID,
      locationId: DEV_LOCATION_ID,
      createdAt: article.createdAt || now,
      updatedAt: article.updatedAt || now,
      externalId: mongoIdToUuid(mongoId),
      status: 'ACTIVE',
      name: article.name,
      acronym: article.acronym || '',
      productType: 'BUNDLE',
      bundlePricingMode: 'FIXED_PROPORTIONAL',
      price: article.price ?? 0,
      taxInside: article.taxInside ?? 19,
      taxOutside: article.taxOutside ?? 7,
      categoryIds: JSON.stringify(categoryId ? [categoryId] : []),
      optionGroups: JSON.stringify(optionGroups),
      availability: JSON.stringify({ isActive: true }),
      ui: JSON.stringify({
        index: article.index ?? 0,
        showOptionsAuto: false,
        hideOnMainScreen: false,
      }),
      isInvalid: article.isInvalid ?? false,
      recipeReferences: JSON.stringify(recipeRefs),
    })
  }
  console.log(`  ✓ ${menus.length} BUNDLE eingefügt`)
}

// ── Hauptprogramm ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════')
  console.log('  Legacy-Daten Migration → panary-core SQLite')
  console.log('═══════════════════════════════════════════════')
  console.log(`  DB: ${DB_PATH}`)
  console.log(`  Tenant: ${DEV_TENANT_ID}`)
  console.log(`  Location: ${DEV_LOCATION_ID}`)

  try {
    // Prüfen ob Tabellen existieren
    const hasProducts = await db.schema.hasTable('products')
    const hasProductGroups = await db.schema.hasTable('product-groups')
    const hasIngredients = await db.schema.hasTable('ingredients')

    if (!hasProducts || !hasProductGroups) {
      throw new Error('Tabellen products / product-groups existieren nicht. Bitte erst pnpm db:migrate ausführen.')
    }
    if (!hasIngredients) {
      await ensureIngredientsTable()
    }

    // Bestehende Daten prüfen (Idempotenz)
    const existingGroups = await db('product-groups').where({ tenantId: DEV_TENANT_ID }).count('* as count').first()
    const existingProducts = await db('products').where({ tenantId: DEV_TENANT_ID }).count('* as count').first()
    const existingIngredients = await db('ingredients').where({ tenantId: DEV_TENANT_ID }).count('* as count').first()

    if ((existingGroups?.count as number) > 0 || (existingProducts?.count as number) > 0 || (existingIngredients?.count as number) > 0) {
      console.log('\n⚠ Es existieren bereits Daten für diesen Tenant.')
      console.log('  Lösche bestehende Daten...')
      await db('products').where({ tenantId: DEV_TENANT_ID }).delete()
      await db('product-groups').where({ tenantId: DEV_TENANT_ID }).delete()
      await db('ingredients').where({ tenantId: DEV_TENANT_ID }).delete()
      console.log('  ✓ Bestehende Daten gelöscht')
    }

    await migrateProductGroups()
    await migrateIngredients()
    await migrateProducts()

    // Statistiken
    console.log('\n═══════════════════════════════════════════════')
    console.log('  Migration abgeschlossen!')
    console.log('═══════════════════════════════════════════════')

    const stats = {
      productGroups: (await db('product-groups').count('* as count').first())?.count,
      ingredients: (await db('ingredients').count('* as count').first())?.count,
      products: (await db('products').count('* as count').first())?.count,
      modifiers: (await db('products').where({ productType: 'MODIFIER' }).count('* as count').first())?.count,
      bundles: (await db('products').where({ productType: 'BUNDLE' }).count('* as count').first())?.count,
      regularProducts: (await db('products').where({ productType: 'PRODUCT' }).count('* as count').first())?.count,
      withRecipes: (
        await db('products')
          .whereNot({ recipeReferences: '[]' })
          .whereNotNull('recipeReferences')
          .count('* as count')
          .first()
      )?.count,
    }

    console.log(`  Product Groups: ${stats.productGroups}`)
    console.log(`  Ingredients:    ${stats.ingredients}`)
    console.log(`  Products total: ${stats.products}`)
    console.log(`    - PRODUCT:    ${stats.regularProducts}`)
    console.log(`    - MODIFIER:   ${stats.modifiers}`)
    console.log(`    - BUNDLE:     ${stats.bundles}`)
    console.log(`  Mit Rezepturen: ${stats.withRecipes}`)
  } catch (error) {
    console.error('\n✗ Fehler bei der Migration:', error)
    process.exit(1)
  } finally {
    await db.destroy()
  }
}

main()
