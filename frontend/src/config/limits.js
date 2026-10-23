// Centralized configuration for system limits (frontend)
// These must match the backend limits in server/config/limits.js

// Maximum number of records that can be imported in a single import operation
export const MAX_IMPORT_RECORDS = 1500;

// Maximum number of records that can be processed in a single bulk operation
export const MAX_RECORDS_PER_OPERATION = 1500;

// Maximum per-user configurable batch limit (admin can set up to this value)
export const MAX_CONFIGURABLE_BATCH_LIMIT = 10000;

// Default per-user batch limit for new users
export const DEFAULT_MAX_ACCOUNTS_PER_BATCH = 1500;
