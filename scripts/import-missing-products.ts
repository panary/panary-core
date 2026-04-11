/**
 * Nachimport-Skript: Fehlende Produkte in panary-core SQLite einfügen
 *
 * Vergleicht die Migration-JSONs mit dem aktuellen DB-Bestand und fügt
 * nur die fehlenden Produkte ein. Bestehende Daten bleiben unberührt.
 *
 * Ausführung: cd panary-core && npx tsx scripts/import-missing-products.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import knex from 'knex'
import { v5 as uuidv5 } from 'uuid'
import { uuidv7 } from 'uuidv7'

// ── Konfiguration ──────────────────────────────────────────────────────────────

const MIGRATION_NAMESPACE = '4a1c7b30-e6f1-4d3a-b8c2-9f0d1a2e3b4c'
const MIGRATION_DIR = resolve(__dirname, '../../migration')
const DB_PATH = resolve(__dirname, '../data/api-edge.sqlite')

// ── Datenbank-Verbindung ───────────────────────────────────────────────────────

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: DB_PATH },
  useNullAsDefault: true,
})

// ── Typen (aus migrate-legacy-data.ts) ─────────────────────────────────────────

interface MongoRef {
  $oid: string
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

interface Recipe {
  _id: MongoRef
  name: string
  basicUnit: string
  basicQuantity: number
  recipeItems: RecipeItem[]
  createdAt?: string
  updatedAt?: string
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────

function mongoIdToUuid(mongoId: string): string {
  return uuidv5(mongoId, MIGRATION_NAMESPACE)
}

function extractId(ref: { $oid: string } | string): string {
  if (typeof ref === 'string') return ref
  return ref.$oid
}

function loadJson<T>(filename: string): T[] {
  const path = resolve(MIGRATION_DIR, filename)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const now = new Date().toISOString()

// ── Hauptprogramm ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════')
  console.log('  Nachimport: Fehlende Produkte einfügen')
  console.log('═══════════════════════════════════════════════')

  // Tenant/Location aus bestehenden Daten ermitteln
  const existingProduct = await db('products').select('tenantId', 'locationId').first()
  if (!existingProduct) {
    throw new Error('Keine bestehenden Produkte in der DB. Bitte erst migrate-legacy-data.ts ausführen.')
  }

  const TENANT_ID = existingProduct.tenantId
  const LOCATION_ID = existingProduct.locationId
  console.log(`  Tenant:   ${TENANT_ID}`)
  console.log(`  Location: ${LOCATION_ID}`)

  // ── Daten laden ──────────────────────────────────────────────────────────────

  const articles = loadJson<Article>('rospos-prod.articles.json')
  const recipes = loadJson<Recipe>('rospos-prod.recipes.json')

  const recipeById = new Map<string, Recipe>()
  for (const r of recipes) {
    recipeById.set(r._id.$oid, r)
  }

  const articleById = new Map<string, Article>()
  for (const a of articles) {
    articleById.set(a._id.$oid, a)
  }

  // ── Bestehende DB-Daten laden ────────────────────────────────────────────────

  const existingProducts: Array<{ _id: string; externalId: string }> = await db('products')
    .select('_id', 'externalId')
    .where({ tenantId: TENANT_ID })

  const existingExternalIds = new Set(existingProducts.map(p => p.externalId))

  // externalId → DB _id Mapping (für OptionGroup-Referenzen)
  const externalToDbId = new Map<string, string>()
  for (const p of existingProducts) {
    externalToDbId.set(p.externalId, p._id)
  }

  // Product-Groups Mapping: externalId → DB _id
  const existingGroups: Array<{ _id: string; externalId: string }> = await db('product-groups')
    .select('_id', 'externalId')
    .where({ tenantId: TENANT_ID })

  const groupExternalToDbId = new Map<string, string>()
  for (const g of existingGroups) {
    groupExternalToDbId.set(g.externalId, g._id)
  }

  console.log(`  Bestehende Produkte: ${existingProducts.length}`)
  console.log(`  Bestehende Gruppen:  ${existingGroups.length}`)

  // ── Fehlende Artikel identifizieren ──────────────────────────────────────────

  const missingArticles = articles.filter(a => {
    const extId = mongoIdToUuid(a._id.$oid)
    return !existingExternalIds.has(extId)
  })

  console.log(`  Fehlende Artikel:    ${missingArticles.length}`)

  if (missingArticles.length === 0) {
    console.log('\n  ✓ Alle Produkte sind bereits vorhanden.')
    await db.destroy()
    return
  }

  // ── ID-Map aufbauen: mongoId → DB _id ────────────────────────────────────────
  // Für bestehende Produkte: externalId rückwärts mappen
  // Für neue Produkte: uuidv7 generieren

  const mongoToDbId = new Map<string, string>()

  // Bestehende Produkte mappen
  for (const a of articles) {
    const extId = mongoIdToUuid(a._id.$oid)
    const dbId = externalToDbId.get(extId)
    if (dbId) {
      mongoToDbId.set(a._id.$oid, dbId)
    }
  }

  // Neue IDs für fehlende Produkte generieren
  for (const a of missingArticles) {
    if (!mongoToDbId.has(a._id.$oid)) {
      mongoToDbId.set(a._id.$oid, uuidv7())
    }
  }

  // Hilfsfunktion: MongoDB-ID → DB _id (bestehend oder neu)
  function resolveDbId(mongoId: string): string {
    const id = mongoToDbId.get(mongoId)
    if (id) return id
    // Fallback: neuen uuidv7 generieren und cachen
    const newId = uuidv7()
    mongoToDbId.set(mongoId, newId)
    return newId
  }

  // ── RecipeReferences aufbauen ────────────────────────────────────────────────

  function buildRecipeReferences(article: Article): object[] {
    const refs: object[] = []

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

    if (article.recipes && article.recipes.length > 0) {
      for (const recipeRef of article.recipes) {
        const recipe = recipeById.get(recipeRef.recipeId.$oid)
        if (!recipe) continue

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

  // ── OptionGroups aufbauen ────────────────────────────────────────────────────

  function buildProductOptionGroups(article: Article): object[] {
    const groups: object[] = []

    if (article.soucen && article.soucen.length > 0) {
      const validOptions = article.soucen
        .map(ref => extractId(ref))
        .filter(id => articleById.has(id))
        .map(sauceId => ({ productId: resolveDbId(sauceId) }))

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

    if (article.extras && article.extras.length > 0) {
      const validOptions = article.extras
        .map(ref => extractId(ref))
        .filter(id => articleById.has(id))
        .map(extraId => ({
          productId: resolveDbId(extraId),
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

  function buildMenuOptionGroups(article: Article): object[] {
    const groups: object[] = []

    if (article.sideDishes && article.sideDishes.length > 0) {
      const validOptions = article.sideDishes
        .map(id => (typeof id === 'string' ? id : extractId(id)))
        .filter(id => articleById.has(id))
        .map(mongoId => ({ productId: resolveDbId(mongoId) }))

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

    if (article.drinks && article.drinks.length > 0) {
      const validOptions = article.drinks
        .map(ref => extractId(ref))
        .filter(id => articleById.has(id))
        .map(drinkId => ({ productId: resolveDbId(drinkId) }))

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

    if (article.extras && article.extras.length > 0) {
      const validOptions = article.extras
        .map(ref => extractId(ref))
        .filter(id => articleById.has(id))
        .map(extraId => ({
          productId: resolveDbId(extraId),
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

  // ── Fehlende Produkte einfügen ───────────────────────────────────────────────

  const modifiers = missingArticles.filter(a => a.isExtra === true)
  const menus = missingArticles.filter(a => a.isMenu === true)
  const products = missingArticles.filter(a => !a.isExtra && !a.isMenu)

  console.log(`\n── Einfügen: MODIFIER: ${modifiers.length}, PRODUCT: ${products.length}, BUNDLE: ${menus.length} ──`)

  let inserted = 0

  // MODIFIER
  for (const article of modifiers) {
    const mongoId = article._id.$oid
    const newId = resolveDbId(mongoId)
    const groupExtId = article.articleGroupId ? mongoIdToUuid(article.articleGroupId.$oid) : null
    const categoryDbId = groupExtId ? groupExternalToDbId.get(groupExtId) : null
    const recipeRefs = buildRecipeReferences(article)

    await db('products').insert({
      _id: newId,
      tenantId: TENANT_ID,
      locationId: LOCATION_ID,
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
      categoryIds: JSON.stringify(categoryDbId ? [categoryDbId] : []),
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
    inserted++
  }
  if (modifiers.length > 0) console.log(`  ✓ ${modifiers.length} MODIFIER eingefügt`)

  // PRODUCT
  for (const article of products) {
    const mongoId = article._id.$oid
    const newId = resolveDbId(mongoId)
    const groupExtId = article.articleGroupId ? mongoIdToUuid(article.articleGroupId.$oid) : null
    const categoryDbId = groupExtId ? groupExternalToDbId.get(groupExtId) : null
    const recipeRefs = buildRecipeReferences(article)
    const optionGroups = buildProductOptionGroups(article)
    const isMenuComponent =
      article.isMenuDrink === true || article.isMenuSideDish === true || article.isMenuSideDishSouce === true

    await db('products').insert({
      _id: newId,
      tenantId: TENANT_ID,
      locationId: LOCATION_ID,
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
      categoryIds: JSON.stringify(categoryDbId ? [categoryDbId] : []),
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
    inserted++
  }
  if (products.length > 0) console.log(`  ✓ ${products.length} PRODUCT eingefügt`)

  // BUNDLE
  for (const article of menus) {
    const mongoId = article._id.$oid
    const newId = resolveDbId(mongoId)
    const groupExtId = article.articleGroupId ? mongoIdToUuid(article.articleGroupId.$oid) : null
    const categoryDbId = groupExtId ? groupExternalToDbId.get(groupExtId) : null
    const recipeRefs = buildRecipeReferences(article)
    const optionGroups = buildMenuOptionGroups(article)

    await db('products').insert({
      _id: newId,
      tenantId: TENANT_ID,
      locationId: LOCATION_ID,
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
      categoryIds: JSON.stringify(categoryDbId ? [categoryDbId] : []),
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
    inserted++
  }
  if (menus.length > 0) console.log(`  ✓ ${menus.length} BUNDLE eingefügt`)

  // ── Statistiken ──────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════')
  console.log(`  Nachimport abgeschlossen! ${inserted} Produkte eingefügt.`)
  console.log('═══════════════════════════════════════════════')

  const stats = {
    total: (await db('products').count('* as count').first())?.count,
    products: (await db('products').where({ productType: 'PRODUCT' }).count('* as count').first())?.count,
    modifiers: (await db('products').where({ productType: 'MODIFIER' }).count('* as count').first())?.count,
    bundles: (await db('products').where({ productType: 'BUNDLE' }).count('* as count').first())?.count,
  }

  console.log(`  Gesamt:    ${stats.total}`)
  console.log(`  PRODUCT:   ${stats.products}`)
  console.log(`  MODIFIER:  ${stats.modifiers}`)
  console.log(`  BUNDLE:    ${stats.bundles}`)

  await db.destroy()
}

main().catch(err => {
  console.error('\n✗ Fehler:', err)
  process.exit(1)
})
