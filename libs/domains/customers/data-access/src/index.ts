// Re-exports aus @panary/customers/domain
export type { Customer, CustomerData, CustomerPatch, CustomerQuery } from '@panary/customers/domain'

// Re-exports aus @panary/corporate-customers/domain
export type {
  CorporateCustomer,
  CorporateCustomerData,
  CorporateCustomerPatch,
  CorporateCustomerQuery,
  DiscountType,
} from '@panary/corporate-customers/domain'

// Services
export * from './lib/services/corporate-customer.service'
export * from './lib/services/private-customer.service'
