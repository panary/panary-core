// Server-only Entry Point – nur für Node.js/api-edge (kein Angular)
// Nicht im Browser-Bundle verwenden: enthält mongodb/knex Abhängigkeiten
export * from './lib/services/service.factory'
