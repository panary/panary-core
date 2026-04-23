// Re-exports aus @panary-core/customers/domain
export type { Customer, CustomerData, CustomerPatch, CustomerQuery } from '@panary-core/customers/domain'

// Re-exports aus @panary-core/corporate-customers/domain
export type {
  CorporateCustomer,
  CorporateCustomerData,
  CorporateCustomerPatch,
  CorporateCustomerQuery,
  DiscountType,
} from '@panary-core/corporate-customers/domain'

// Services
export * from './lib/services/corporate-customer.service'
export * from './lib/services/private-customer.service'
