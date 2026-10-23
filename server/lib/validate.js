// Small validation helpers shared by every route module.
const { badRequest } = require('./errors');

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function requireString(value, field, { max = 256, min = 1 } = {}) {
    if (!isNonEmptyString(value)) throw badRequest(`${field} is required`);
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max) {
        throw badRequest(`${field} must be between ${min} and ${max} characters`);
    }
    return trimmed;
}

function optionalString(value, field, { max = 512 } = {}) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
    const trimmed = value.trim();
    if (trimmed.length > max) throw badRequest(`${field} is too long`);
    return trimmed;
}

function requireInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed)) throw badRequest(`${field} must be an integer`);
    if (parsed < min || parsed > max) throw badRequest(`${field} must be between ${min} and ${max}`);
    return parsed;
}

function requireEnum(value, field, allowed) {
    if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
    return value;
}

// Pagination bounds for list endpoints.
function parsePagination(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
    const page = query.page === undefined ? 1 : requireInteger(query.page, 'page', { min: 1, max: 100000 });
    const limit = query.limit === undefined ? defaultLimit : requireInteger(query.limit, 'limit', { min: 1, max: maxLimit });
    return { page, limit, offset: (page - 1) * limit };
}

module.exports = {
    isNonEmptyString,
    requireString,
    optionalString,
    requireInteger,
    requireEnum,
    parsePagination
};
