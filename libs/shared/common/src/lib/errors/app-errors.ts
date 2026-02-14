// Wir gruppieren Fehler nach Domäne, damit wir den Überblick behalten.

export const AppError = {
  // --- AUTHENTICATION (1000-1999) ---
  AUTH_INVALID_CREDENTIALS: 'AUTH_001',
  AUTH_TOKEN_EXPIRED: 'AUTH_002',
  AUTH_ACCOUNT_LOCKED: 'AUTH_003',
  AUTH_NO_PERMISSION: 'AUTH_403', // Besser als generisches Forbidden

  // --- USERS (2000-2999) ---
  USER_NOT_FOUND: 'USER_2001',
  USER_EMAIL_EXISTS: 'USER_2002',
  USER_PASSWORD_WEAK: 'USER_2003',

  // --- TENANT / MULTI-TENANCY (3000-3999) ---
  TENANT_NOT_FOUND: 'TENANT_3001',
  TENANT_INACTIVE: 'TENANT_3002',
  TENANT_MISMATCH: 'TENANT_3003', // Unser Security Hook Fehler!

  // --- VALIDATION (4000-4999) ---
  VALIDATION_FAILED: 'VAL_4000',
  INVALID_INPUT: 'VAL_4001',

  // --- SYSTEM (9000+) ---
  INTERNAL_ERROR: 'SYS_9000',
  DB_CONNECTION_ERROR: 'SYS_9001',
} as const

export type AppError = (typeof AppError)[keyof typeof AppError]

// Optional: Eine Default-Message Map (als Fallback für Logs)
export const AppErrorMessages: Record<AppError, string> = {
  [AppError.AUTH_INVALID_CREDENTIALS]: 'Invalid email or password.',
  [AppError.AUTH_TOKEN_EXPIRED]: 'Your session has expired.',
  [AppError.AUTH_ACCOUNT_LOCKED]: 'Account is locked due to too many failed attempts.',
  [AppError.AUTH_NO_PERMISSION]: 'You do not have permission to perform this action.',

  [AppError.USER_NOT_FOUND]: 'User not found.',
  [AppError.USER_EMAIL_EXISTS]: 'This email is already registered.',
  [AppError.USER_PASSWORD_WEAK]: 'Password is too weak.',

  [AppError.TENANT_NOT_FOUND]: 'Tenant context missing or invalid.',
  [AppError.TENANT_INACTIVE]: 'This tenant account is suspended.',
  [AppError.TENANT_MISMATCH]: 'Security Alert: Cross-Tenant access detected.',

  [AppError.VALIDATION_FAILED]: 'Validation failed.',
  [AppError.INVALID_INPUT]: 'Invalid input provided.',

  [AppError.INTERNAL_ERROR]: 'An unexpected error occurred.',
  [AppError.DB_CONNECTION_ERROR]: 'Database connection failed.',
}
