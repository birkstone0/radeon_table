// Centralized configuration for system limits
// These constants are used across frontend and backend to ensure consistency

// Maximum number of records that can be imported in a single import operation
const MAX_IMPORT_RECORDS = 1500;

// Maximum number of records that can be processed in a single bulk operation
const MAX_RECORDS_PER_OPERATION = 2000;

// Batch size for database insertions during import (for performance)
const IMPORT_BATCH_SIZE = 100;

// Batch size for retrieving account IDs from selection tokens (for memory safety)
const SELECTION_BATCH_SIZE = 1000;

// Maximum number of operation IDs that can be queried in a single batch-status request
const MAX_BATCH_STATUS_OPERATIONS = 500;

// Maximum per-user configurable batch limit (admin can set up to this value)
const MAX_CONFIGURABLE_BATCH_LIMIT = 10000;

// Default per-user batch limit for new users
const DEFAULT_MAX_ACCOUNTS_PER_BATCH = 2000;

module.exports = {
    MAX_IMPORT_RECORDS,
    MAX_RECORDS_PER_OPERATION,
    IMPORT_BATCH_SIZE,
    SELECTION_BATCH_SIZE,
    MAX_BATCH_STATUS_OPERATIONS,
    MAX_CONFIGURABLE_BATCH_LIMIT,
    DEFAULT_MAX_ACCOUNTS_PER_BATCH
};
