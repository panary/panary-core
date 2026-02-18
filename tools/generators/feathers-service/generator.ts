import { formatFiles, generateFiles, names, Tree, updateJson } from '@nx/devkit'
import { libraryGenerator as angularLibraryGenerator } from '@nx/angular/generators'
import { libraryGenerator } from '@nx/js'
import * as path from 'path'

interface FeathersServiceGeneratorSchema {
  name: string
  displayName?: string
  skipDomain?: boolean
  useBaseSchema?: boolean
  project?: string
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function singularize(str: string): string {
  // Simple singularization for common cases
  if (str.endsWith('ies')) {
    return str.slice(0, -3) + 'y' // categories -> category
  }
  if (str.endsWith('ses') || str.endsWith('xes') || str.endsWith('zes')) {
    return str.slice(0, -2) // boxes -> box
  }
  if (str.endsWith('s') && !str.endsWith('ss')) {
    return str.slice(0, -1) // products -> product
  }
  return str
}

function validateProject(tree: Tree, projectName: string): void {
  const projectPath = `apps/${projectName}`

  if (!tree.exists(projectPath)) {
    throw new Error(
      `ERROR: Project '${projectName}' not found at ${projectPath}. Available projects: ${tree
        .children('apps')
        .join(', ')}`,
    )
  }

  if (!tree.exists('tsconfig.base.json')) {
    throw new Error('ERROR: tsconfig.base.json not found. Please run this generator from the workspace root directory.')
  }

  console.log(`Project validation passed: ${projectName}`)
}

function updateServiceIndex(tree: Tree, serviceName: string, projectName: string): void {
  const names_ = names(serviceName)
  const indexPath = `apps/${projectName}/src/services/index.ts`

  if (!tree.exists(indexPath)) {
    throw new Error(`ERROR: ${indexPath} not found. Make sure ${projectName} has a services/index.ts file.`)
  }

  let content = tree.read(indexPath, 'utf-8')
  if (!content) {
    throw new Error(`ERROR: Could not read content from ${indexPath}`)
  }

  // Füge Import hinzu
  const importStatement = `import { ${names_.propertyName} } from './${names_.fileName}/${names_.fileName}'`

  // Finde die letzte Import-Zeile
  const lines = content.split('\n')
  let lastImportIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) {
      lastImportIndex = i
    }
  }

  if (lastImportIndex !== -1) {
    lines.splice(lastImportIndex + 1, 0, importStatement)
    content = lines.join('\n')
  }

  // Add service configuration
  const configLine = `  app.configure(${names_.propertyName})`
  const servicesMatch = content.match(/export const services = \(app: Application\) => \{([\s\S]*?)\}/)

  if (servicesMatch) {
    const servicesBody = servicesMatch[1]
    const updatedBody = servicesBody.trimEnd() + '\n' + configLine + '\n'
    content = content.replace(servicesMatch[0], `export const services = (app: Application) => {${updatedBody}}`)
  }

  tree.write(indexPath, content)
  console.log(`Updated ${indexPath} with ${serviceName} service registration`)
}

function updateDeclarations(tree: Tree, serviceName: string, projectName: string): void {
  const names_ = names(serviceName)
  const singular = singularize(names_.fileName)
  const singularNames = names(singular)
  const singularClassName = singularNames.className

  const filePath = `apps/${projectName}/src/declarations.ts`

  if (!tree.exists(filePath)) {
    console.warn(`WARN: ${filePath} not found. Skipping declarations update.`)
    return
  }

  let content = tree.read(filePath, 'utf-8')
  if (!content) {
    throw new Error(`ERROR: Could not read content from ${filePath}`)
  }

  const serviceClassName = `${singularClassName}Service`
  const importStatement = `import { ${serviceClassName} } from './services/${names_.fileName}/${names_.fileName}.class'`

  // 1. Add import
  // We check roughly whether the import is already there.
  if (!content.includes(importStatement)) {
    const lines = content.split('\n')
    let lastImportIndex = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) {
        lastImportIndex = i
      }
    }
    if (lastImportIndex !== -1) {
      lines.splice(lastImportIndex + 1, 0, importStatement)
      content = lines.join('\n')
    }
  }

  // 2. Extend ServiceTypes interface
  const propertyKey = names_.propertyName === names_.fileName ? names_.propertyName : `'${names_.fileName}'`
  const propertyLine = `  ${propertyKey}: ${serviceClassName}`
  const interfaceMatch = content.match(/export interface ServiceTypes \{([\s\S]*?)\}/)

  if (interfaceMatch) {
    const body = interfaceMatch[1]
    // Nur hinzufügen, wenn noch nicht existiert
    if (!body.includes(`${propertyKey}:`)) {
      const updatedBody = body.trimEnd() + '\n' + propertyLine + '\n'
      content = content.replace(interfaceMatch[0], `export interface ServiceTypes {${updatedBody}}`)
    }
  }

  tree.write(filePath, content)
  console.log(`Updated ${filePath} with ${serviceName} service type definition`)
}

export default async function (tree: Tree, schema: FeathersServiceGeneratorSchema) {
  console.log('Starting FeathersJS Service Generator...\n')

  // 1. Determine project name
  const projectName = schema.project || 'api-edge'

  // 2. Validation
  validateProject(tree, projectName)

  const names_ = names(schema.name)

  // Create singular names for types/schemas
  const singular = singularize(names_.fileName)
  const singularNames = names(singular)
  const singularClassName = singularNames.className
  const singularPropertyName = singularNames.propertyName

  const displayName = schema.displayName || capitalize(names_.className)

  console.log(`Creating service: ${names_.fileName}`)
  console.log(`   Project: ${projectName}`)
  console.log(`   Display Name: ${displayName}`)
  console.log(`   Singular Type: ${singularClassName}`)
  console.log(`   Use Base Schema: ${schema.useBaseSchema ?? true}`)
  console.log(`   Skip Domain: ${schema.skipDomain ?? false}\n`)

  // 3. Create domain library (if not skipped)
  if (!schema.skipDomain) {
    console.log('Creating domain library...')

    const directory = `libs/domains/${names_.fileName}/domain`
    const importPath = `@panary-core/${names_.fileName}/domain`
    const tags = `type:domain,domain:${names_.fileName}`

    await libraryGenerator(tree, {
      name: `${names_.fileName}-domain`,
      directory,
      bundler: 'tsc',
      linter: 'eslint',
      unitTestRunner: 'vitest',
      tags,
      importPath,
      skipFormat: true,
      projectNameAndRootFormat: 'as-provided',
    } as any)

    // Delete default files created by library generator
    const libPath = `${directory}/src/lib`
    const defaultFile = `${libPath}/${names_.fileName}-domain.ts`
    const defaultSpec = `${libPath}/${names_.fileName}-domain.spec.ts`

    if (tree.exists(defaultFile)) {
      tree.delete(defaultFile)
    }
    if (tree.exists(defaultSpec)) {
      tree.delete(defaultSpec)
    }

    // Overwrite the content with our domain templates
    generateFiles(tree, path.join(__dirname, 'files', 'domain'), directory + '/src', {
      ...names_,
      // Singular names
      className: singularClassName, // Product (not Products)
      propertyName: singularPropertyName, // product (not products)
      displayName,
      useBaseSchema: schema.useBaseSchema ?? true,
      tmpl: '',
    })

    // Rewrite/overwrite index file for domain
    tree.write(`${directory}/src/index.ts`, `export * from './lib/${names_.fileName}.schema'\n`)

    // Update tsconfig.lib.json with module resolution settings
    updateJson(tree, `${directory}/tsconfig.lib.json`, (json) => {
      json.compilerOptions = {
        ...json.compilerOptions,
        moduleResolution: 'node',
        module: 'commonjs',
      }
      return json
    })

    console.log(`Domain library created at ${directory}`)

    // Create Data Access Library (Angular)
    console.log('Creating data-access library...')

    const dataAccessDirectory = `libs/domains/${names_.fileName}/data-access`
    const dataAccessImportPath = `@panary-core/${names_.fileName}/data-access`
    const dataAccessTags = `type:data-access,domain:${names_.fileName}`

    await angularLibraryGenerator(tree, {
      name: `${names_.fileName}-data-access`,
      directory: dataAccessDirectory,
      unitTestRunner: 'none',
      tags: dataAccessTags,
      importPath: dataAccessImportPath,
      skipFormat: true,
      projectNameAndRootFormat: 'as-provided',
    } as any)

    console.log(`Data Access library created at ${dataAccessDirectory}`)
  }

  // 4. Create service files
  console.log('\nCreating service files...')

  const servicePath = `apps/${projectName}/src/services/${names_.fileName}`

  generateFiles(tree, path.join(__dirname, 'files', 'service'), servicePath, {
    ...names_,
    // Singular names
    className: singularClassName, // Product (not Products)
    propertyName: singularPropertyName, // product (not products)
    // Plural names (explicit)
    servicePropertyName: names_.propertyName, // products (not product)
    displayName,
    useBaseSchema: schema.useBaseSchema ?? true,
    tmpl: '',
  })

  console.log(`Service files created at ${servicePath}`)

  // 5. Register service in index.ts
  console.log('\nRegistering service...')
  updateServiceIndex(tree, names_.fileName, projectName)

  // 6. Register service in declarations.ts
  updateDeclarations(tree, names_.fileName, projectName)

  // 7. formatting
  await formatFiles(tree)

  console.log('\n✨ Service generation completed!\n')
  console.log('Next steps:')
  console.log(`   1. Edit libs/domains/${names_.fileName}/domain/src/lib/${names_.fileName}.schema.ts`)
  console.log(`      → Add your custom fields to the schema`)
  console.log(`   2. Edit apps/${projectName}/src/services/${names_.fileName}/${names_.fileName}.schema.ts`)
  console.log(`      → Implement custom resolvers (validation, business logic)`)
  console.log(`   3. Run: nx serve ${projectName}`)
  console.log(`   4. Test your service at: http://localhost:3030/${names_.fileName}\n`)
}
