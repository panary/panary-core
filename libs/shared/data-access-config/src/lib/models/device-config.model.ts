/**
 * Unterstützte Gerätetypen
 */
export type DeviceType = 'pos-counter' | 'kds' | 'tablet' | 'other'

/**
 * Device Metadata
 */
export interface DeviceMetadata {
  userAgent?: string
  ipAddress?: string
  version?: string
}

/**
 * Device Model
 * Repräsentiert ein registriertes Gerät im System
 */
export interface Device {
  _id: string
  createdAt?: string // ISO 8601 date-time
  updatedAt?: string // ISO 8601 date-time
  locationId: string
  tenantId: string

  deviceId: string // UUID - Eindeutige Geräte-ID
  name: string // z.B. "POS Counter 1"
  type: DeviceType
  apiKeyId?: string // Referenz zum API-Key
  lastSeen?: string // ISO 8601 - Letzte Verbindung
  active: boolean // Default: true
  metadata?: DeviceMetadata
  createdBy: string
}

/**
 * Data Schema für POST (create)
 */
export interface DeviceData {
  name: string
  type: DeviceType
  locationId: string
  tenantId: string
}

/**
 * Device Registration Response from Backend
 * Wird bei POST /devices zurückgegeben
 */
export interface DeviceRegistrationResponse extends Device {
  apiKey: string // Der generierte API-Key (nur bei create!)
}

/**
 * Device Configuration stored locally
 * Wird nach erfolgreicher Registrierung im localStorage gespeichert
 */
export interface DeviceConfig {
  // Server Connection
  serverUrl: string

  // Device Credentials (from registration)
  deviceId: string // UUID v4 - unveränderlich
  apiKey: string // UUID v4 - für WebSocket-Auth

  // Device Info
  deviceName: string
  deviceType: DeviceType

  // Tenant Assignment
  tenantId: string
  locationId: string

  // Local Settings
  language: string

  // Timestamps
  registeredAt: Date
  lastSync?: Date
}

/**
 * Setup Credentials - Admin-Login für initiale Registrierung
 * Der Admin muss sich zuerst mit JWT authentifizieren
 */
export interface SetupCredentials {
  serverUrl: string
  loginname: string
  password: string
}

/**
 * Device Registration Request
 * Wird nach Admin-Auth an POST /devices gesendet
 */
export interface DeviceRegistrationRequest {
  name: string
  type: DeviceType
  tenantId: string
  locationId: string
}
