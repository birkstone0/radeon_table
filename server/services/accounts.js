// Account records service. Every query is scoped to the authenticated owner;
// no client-supplied owner id is trusted.
const Account = require('../models/Account');
const ImportBatch = require('../models/ImportBatch');
const { badRequest, forbidden, notFound } = require('../lib/errors');
const { maskPhone } = require('../lib/mask');
const credentials = require('../lib/credentials');
const audit = require('../lib/audit');
const tableph = require('./tableph');
const logger = require('../lib/logger');

async function findForOwner(ownerId, accountId) {
    return await Account.findOne({ _id: accountId, ownerId });
}

// --- Import preparation -------------------------------------------------
// Both import methods funnel through here: the caller has already parsed the
// raw input (reusing login.js parseAccountLine) and this function validates,
// detects duplicates against the owner's existing records, and returns a
// preview. Nothing is persisted until the user confirms.
async function prepareImport({ ownerId, method, records }) {
    logger.info('ACCOUNTS', `Preparing import: ${records.length} records`);
    if (!Array.isArray(records)) throw badRequest('Invalid import payload');
    if (records.length === 0) throw badRequest('No records to import');
    if (records.length > 500) throw badRequest('At most 500 records per import');

    const existing = new Set(
        (await Account.find({ ownerId }, { phone: 1 })).map((row) => row.phone)
    );
    const seen = new Set();
    const valid = [];
    const invalid = [];
    const duplicates = [];

    for (const record of records) {
        const phone = record.phone;
        if (!phone) {
            invalid.push({ line: record.line, reason: record.error || 'Invalid phone number' });
            continue;
        }
        if (existing.has(phone) || seen.has(phone)) {
            duplicates.push({ phone: maskPhone(phone) });
            continue;
        }
        seen.add(phone);
        // The preview only ever carries the masked number: the client sends the
        // password back with the confirmation it explicitly accepts.
        valid.push({ phone, phoneMasked: maskPhone(phone), line: record.line });
    }

    logger.info('ACCOUNTS', `Import result: ${valid.length} valid, ${invalid.length} invalid, ${duplicates.length} duplicates`);
    return {
        method,
        summary: {
            total: records.length,
            valid: valid.length,
            invalid: invalid.length,
            duplicates: duplicates.length
        },
        valid,
        invalid: invalid.slice(0, 100),
        duplicates: duplicates.slice(0, 100)
    };
}

// --- Commit -------------------------------------------------------------
// Persists the preview the user explicitly confirmed. Credentials are kept
// only in the in-memory store and referenced by cred_ref.
async function commitImport({ ownerId, method, records }) {
    if (!Array.isArray(records) || records.length === 0) throw badRequest('Nothing to import');

    const batch = await ImportBatch.create({
        ownerId,
        method,
        total: records.length,
        valid: records.length,
        invalid: 0,
        duplicates: 0
    });

    const inserted = [];
    for (const record of records) {
        const credRef = credentials.create(ownerId, record.phone, record.password);
        const account = await Account.create({
            ownerId,
            phone: record.phone,
            phoneMasked: maskPhone(record.phone),
            credRef,
            source: method,
            importBatchId: batch._id,
            validationStatus: 'valid',
            processingStatus: 'pending'
        });
        inserted.push({ id: account._id, phoneMasked: maskPhone(record.phone) });
    }

    await audit.record({
        actor: { id: ownerId, username: null },
        action: 'accounts.imported',
        targetType: 'import_batch',
        targetId: batch._id,
        metadata: { method, count: inserted.length }
    });

    return { batchId: batch._id, inserted };
}

// --- Listing ------------------------------------------------------------
async function listForOwner(ownerId, filters, pagination) {
    const query = { ownerId };
    const sort = {};

    if (filters.status) {
        query.processingStatus = filters.status;
    }
    if (filters.validationStatus) {
        query.validationStatus = filters.validationStatus;
    }
    if (filters.search) {
        query.phone = { $regex: filters.search.replace(/[^0-9+*]/g, ''), $options: 'i' };
    }

    const sortField = filters.sort && ['createdAt', 'updatedAt', 'lastActivityAt', 'phone'].includes(filters.sort)
        ? filters.sort
        : 'createdAt';
    const sortOrder = filters.order === 'asc' ? 1 : -1;
    sort[sortField] = sortOrder;

    const total = await Account.countDocuments(query);
    const items = await Account.find(query)
        .sort(sort)
        .skip(pagination.offset)
        .limit(pagination.limit);

    return { total, items };
}

async function summaryForOwner(ownerId) {
    const Operation = require('../models/Operation');
    const total = await Account.countDocuments({ ownerId });
    // Only count accounts that truly need attention: failed operations or explicitly flagged
    const needsAttention = await Account.countDocuments({
        ownerId,
        processingStatus: { $in: ['failed', 'needs_attention'] }
    });
    // Count all successful operations (including already-claimed as success).
    const completed = await Operation.countDocuments({ ownerId, status: { $in: ['success', 'already_claimed'] } });
    const lastImport = await ImportBatch.findOne({ ownerId }).sort({ createdAt: -1 }).select('createdAt');
    return {
        total,
        needsAttention,
        completed,
        lastImport: lastImport ? lastImport.createdAt : null
    };
}

// --- Record management --------------------------------------------------
async function clearForOwner(ownerId) {
    const removedCredentials = credentials.removeAllForOwner(ownerId);
    const result = await Account.deleteMany({ ownerId });
    await audit.record({
        actor: { id: ownerId, username: null },
        action: 'accounts.cleared',
        metadata: { deleted: result.deletedCount, credentialsDropped: removedCredentials }
    });
    return { deleted: result.deletedCount };
}

async function deleteForOwner(ownerId, accountId) {
    const account = await findForOwner(ownerId, accountId);
    if (!account) throw notFound('Account not found');
    credentials.remove(ownerId, account.credRef);
    await Account.deleteOne({ _id: accountId, ownerId });
    await audit.record({
        actor: { id: ownerId, username: null },
        action: 'account.deleted',
        targetType: 'account',
        targetId: accountId
    });
    return { deleted: true };
}

async function getForOwner(ownerId, accountId) {
    const account = await findForOwner(ownerId, accountId);
    if (!account) throw notFound('Account not found');
    return account;
}

async function markNeedsAttention(ownerId, accountId, reason) {
    const account = await findForOwner(ownerId, accountId);
    if (!account) throw notFound('Account not found');
    await Account.findByIdAndUpdate(accountId, {
        processingStatus: 'needs_attention',
        lastError: reason
    });
}

// Never expose credentials to any API response.
function toPublic(account) {
    return {
        id: account._id,
        phoneMasked: account.phoneMasked,
        validationStatus: account.validationStatus,
        processingStatus: account.processingStatus,
        source: account.source,
        lastOperation: account.lastOperation,
        lastResult: account.lastResult,
        lastError: account.lastError,
        lastBalance: account.lastBalance,
        operationCount: account.operationCount,
        lastActivityAt: account.lastActivityAt,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt
    };
}

module.exports = {
    prepareImport,
    commitImport,
    listForOwner,
    summaryForOwner,
    clearForOwner,
    deleteForOwner,
    getForOwner,
    markNeedsAttention,
    toPublic,
    findForOwner
};
