export enum SystemMode {
  STANDALONE = 'standalone', // Edge, offline-fähig, kein Sync-Zwang
  CONNECTED = 'connected', // Edge, versucht aktiv zu syncen
  CLOUD = 'cloud', // Zentrale Instanz (MongoDB)
}

export enum DatabaseType {
  SQLITE = 'sqlite',
  MONGODB = 'mongodb',
}
