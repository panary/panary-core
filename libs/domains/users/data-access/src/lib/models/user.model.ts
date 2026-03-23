// Runtime values (const objects & enums)
export { UserStatus, UserSystemRole, DiscountType } from '@panary-core/users/domain'

// Pure TypeScript types
export type { User, UserData, UserPatch } from '@panary-core/users/domain'

// Legacy-Kompatibilitäts-Map für Migration
export const UserRole = {
  superAdmin: 'platform:owner',
  admin: 'tenant:manager',
  user: 'tenant:staff',
  manager: 'tenant:manager',
} as const
