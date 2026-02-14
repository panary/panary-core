import {
  Tree,
  formatFiles,
  generateFiles,
  names,
  updateJson,
} from '@nx/devkit';
import * as path from 'path';

interface FeathersServiceGeneratorSchema {
  name: string;
  displayName?: string;
  skipDomain?: boolean;
  useBaseSchema?: boolean;
  project?: string;  // Neuer Parameter: welches Projekt (default: api-edge)
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function singularize(str: string): string {
  // Einfache Singularisierung für häufige Fälle
  if (str.endsWith('ies')) {
    return str.slice(0, -3) + 'y'; // categories -> category
  }
  if (str.endsWith('ses') || str.endsWith('xes') || str.endsWith('zes')) {
    return str.slice(0, -2); // boxes -> box
  }
  if (str.endsWith('s') && !str.endsWith('ss')) {
    return str.slice(0, -1); // products -> product
  }
  return str;
}

function validateProject(tree: Tree, projectName: string): void {
  const projectPath = `apps/${projectName}`;

  if (!tree.exists(projectPath)) {
    throw new Error(
      `ERROR: Project '${projectName}' not found at ${projectPath}. Available projects: ${
        tree.children('apps').join(', ')
      }`
    );
  }

  if (!tree.exists('tsconfig.base.json')) {
    throw new Error(
      'ERROR: tsconfig.base.json not found. Please run this generator from the workspace root directory.'
    );
  }

  console.log(`Project validation passed: ${projectName}`);
}

function updateTsConfig(tree: Tree, serviceName: string): void {
  const names_ = names(serviceName);
  const tsConfigPath = 'tsconfig.base.json';

  updateJson(tree, tsConfigPath, (json) => {
    if (!json.compilerOptions) {
      json.compilerOptions = {};
    }
    if (!json.compilerOptions.paths) {
      json.compilerOptions.paths = {};
    }

    // Füge Domain Path hinzu
    json.compilerOptions.paths[`@panary-core/${names_.fileName}/domain`] = [
      `libs/domains/${names_.fileName}/domain/src/index.ts`,
    ];

    return json;
  });

  console.log(`Updated tsconfig.base.json with @panary-core/${names_.fileName}/domain path`);
}

function updateServiceIndex(tree: Tree, serviceName: string, projectName: string): void {
  const names_ = names(serviceName);
  const indexPath = `apps/${projectName}/src/services/index.ts`;

  if (!tree.exists(indexPath)) {
    throw new Error(`ERROR: ${indexPath} not found. Make sure ${projectName} has a services/index.ts file.`);
  }

  let content = tree.read(indexPath, 'utf-8');
  if (!content) {
    throw new Error(`ERROR: Could not read content from ${indexPath}`);
  }

  // Füge Import hinzu
  const importStatement = `import { ${names_.propertyName} } from './${names_.fileName}/${names_.fileName}'`;

  // Finde die letzte Import-Zeile
  const lines = content.split('\n');
  let lastImportIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) {
      lastImportIndex = i;
    }
  }

  if (lastImportIndex !== -1) {
    lines.splice(lastImportIndex + 1, 0, importStatement);
    content = lines.join('\n');
  }

  // Füge Service Konfiguration hinzu
  const configLine = `  app.configure(${names_.propertyName})`;
  const servicesMatch = content.match(/export const services = \(app: Application\) => \{([\s\S]*?)\}/);

  if (servicesMatch) {
    const servicesBody = servicesMatch[1];
    const updatedBody = servicesBody.trimEnd() + '\n' + configLine + '\n';
    content = content.replace(servicesMatch[0], `export const services = (app: Application) => {${updatedBody}}`);
  }

  tree.write(indexPath, content);
  console.log(`Updated ${indexPath} with ${serviceName} service registration`);
}

function updateDeclarations(tree: Tree, serviceName: string, projectName: string): void {
  const names_ = names(serviceName);
  const singularFileName = singularize(names_.fileName);
  const singularClassName = capitalize(singularFileName);

  const filePath = `apps/${projectName}/src/declarations.ts`;

  if (!tree.exists(filePath)) {
    console.warn(`WARN: ${filePath} not found. Skipping declarations update.`);
    return;
  }

  let content = tree.read(filePath, 'utf-8');
  if (!content) {
    throw new Error(`ERROR: Could not read content from ${filePath}`);
  }

  const serviceClassName = `${singularClassName}Service`;
  const importStatement = `import { ${serviceClassName} } from './services/${names_.fileName}/${names_.fileName}.class'`;

  // 1. Import hinzufügen
  // Wir prüfen grob, ob der Import schon da ist
  if (!content.includes(importStatement)) {
    const lines = content.split('\n');
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) {
        lastImportIndex = i;
      }
    }
    if (lastImportIndex !== -1) {
      lines.splice(lastImportIndex + 1, 0, importStatement);
      content = lines.join('\n');
    }
  }

  // 2. ServiceTypes Interface erweitern
  const propertyLine = `  ${names_.propertyName}: ${serviceClassName}`;
  const interfaceMatch = content.match(/export interface ServiceTypes \{([\s\S]*?)\}/);

  if (interfaceMatch) {
    const body = interfaceMatch[1];
    // Nur hinzufügen, wenn noch nicht existiert
    if (!body.includes(`${names_.propertyName}:`)) {
      const updatedBody = body.trimEnd() + '\n' + propertyLine + '\n';
      content = content.replace(interfaceMatch[0], `export interface ServiceTypes {${updatedBody}}`);
    }
  }

  tree.write(filePath, content);
  console.log(`Updated ${filePath} with ${serviceName} service type definition`);
}

export default async function (tree: Tree, schema: FeathersServiceGeneratorSchema) {
  console.log('Starting FeathersJS Service Generator...\n');

  // 1. Project Name bestimmen
  const projectName = schema.project || 'api-edge';

  // 2. Validierung
  validateProject(tree, projectName);

  const names_ = names(schema.name);

  // Singular Namen für Types/Schemas erstellen
  const singularFileName = singularize(names_.fileName);
  const singularClassName = capitalize(singularFileName);
  const singularPropertyName = singularFileName;

  const displayName = schema.displayName || capitalize(names_.className);

  console.log(`Creating service: ${names_.fileName}`);
  console.log(`   Project: ${projectName}`);
  console.log(`   Display Name: ${displayName}`);
  console.log(`   Singular Type: ${singularClassName}`);
  console.log(`   Use Base Schema: ${schema.useBaseSchema ?? true}`);
  console.log(`   Skip Domain: ${schema.skipDomain ?? false}\n`);

  // 3. Domain Library erstellen (falls nicht übersprungen)
  if (!schema.skipDomain) {
    console.log('Creating domain library...');

    const domainPath = `libs/domains/${names_.fileName}/domain/src`;

    generateFiles(
      tree,
      path.join(__dirname, 'files', 'domain'),
      domainPath,
      {
        ...names_,
        // Überschreibe mit Singular-Namen für Types/Schemas
        className: singularClassName,       // Product (nicht Products)
        propertyName: singularPropertyName, // product (nicht products)
        displayName,
        useBaseSchema: schema.useBaseSchema ?? true,
        tmpl: '',
      }
    );

    // Index file für Domain
    tree.write(
      `libs/domains/${names_.fileName}/domain/src/index.ts`,
      `export * from './lib/${names_.fileName}.schema'\n`
    );

    console.log(`Domain library created at ${domainPath}`);

    // tsconfig.base.json aktualisieren
    updateTsConfig(tree, names_.fileName);
  }

  // 4. Service Dateien erstellen
  console.log('\nCreating service files...');

  const servicePath = `apps/${projectName}/src/services/${names_.fileName}`;

  generateFiles(
    tree,
    path.join(__dirname, 'files', 'service'),
    servicePath,
    {
      ...names_,
      // Überschreibe mit Singular-Namen für Types/Schemas
      className: singularClassName,       // Product (nicht Products)
      propertyName: singularPropertyName, // product (nicht products)
      displayName,
      useBaseSchema: schema.useBaseSchema ?? true,
      tmpl: '',
    }
  );

  console.log(`Service files created at ${servicePath}`);

  // 5. Service in index.ts registrieren
  console.log('\nRegistering service...');
  updateServiceIndex(tree, names_.fileName, projectName);

  // 6. Service in declarations.ts registrieren
  updateDeclarations(tree, names_.fileName, projectName);

  // 7. Formatierung
  await formatFiles(tree);

  console.log('\n✨ Service generation completed!\n');
  console.log('Next steps:');
  console.log(`   1. Edit libs/domains/${names_.fileName}/domain/src/lib/${names_.fileName}.schema.ts`);
  console.log(`      → Add your custom fields to the schema`);
  console.log(`   2. Edit apps/${projectName}/src/services/${names_.fileName}/${names_.fileName}.schema.ts`);
  console.log(`      → Implement custom resolvers (validation, business logic)`);
  console.log(`   3. Run: nx serve ${projectName}`);
  console.log(`   4. Test your service at: http://localhost:3030/${names_.fileName}\n`);
}
