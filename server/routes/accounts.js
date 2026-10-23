// Account import + record management routes.
//
// Two import methods:
//   A) TXT file with "phone:password" lines
//   B) phone numbers only, one per line (or TXT), plus one shared password
//
// Both prepare a preview that the user must explicitly confirm before any
// record is persisted. Importing never triggers login attempts.
const express = require('express');
const { parseAccountLine, normalizePhone } = require('../../login');
const accountsService = require('../services/accounts');
const { badRequest } = require('../lib/errors');
const { requireString, requireEnum, optionalString, parsePagination } = require('../lib/validate');
const audit = require('../lib/audit');
const { maskPhone } = require('../lib/mask');
const logger = require('../lib/logger');

const router = express.Router();

const MAX_IMPORT_BYTES = 256 * 1024;

function parseSharedPhoneLines(rawText) {
    const lines = String(rawText).split(/\r?\n/);
    const records = [];
    let lineNumber = 0;
    for (const rawLine of lines) {
        lineNumber += 1;
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#')) continue;
        const phone = normalizePhone(line);
        if (!phone) {
            records.push({ line: lineNumber, error: 'Invalid phone number' });
            continue;
        }
        records.push({ line: lineNumber, phone, password: null });
    }
    return records;
}

function parsePairLines(rawText) {
    const lines = String(rawText).split(/\r?\n/);
    const records = [];
    let lineNumber = 0;
    let invalid = 0;
    for (const rawLine of lines) {
        lineNumber += 1;
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const parsed = parseAccountLine(line);
        if (!parsed.ok) {
            invalid += 1;
            records.push({ line: lineNumber, error: parsed.error });
            continue;
        }
        records.push({ line: lineNumber, phone: parsed.phone, password: parsed.password });
    }
    return { records, invalid };
}

// Preview: validate + duplicate detection, nothing persisted.
router.post('/imports/preview', async (req, res, next) => {
    try {
        const method = requireEnum(req.body.method, 'method', ['txt', 'shared_password']);

        let records;
        if (method === 'txt') {
            const text = optionalString(req.body.text, 'text', { max: MAX_IMPORT_BYTES });
            if (!text) throw badRequest('Provide the TXT file contents');
            records = parsePairLines(text).records;
        } else {
            const sharedPassword = requireString(req.body.sharedPassword, 'Shared password', { min: 4, max: 128 });
            const text = optionalString(req.body.text, 'text', { max: MAX_IMPORT_BYTES });
            if (!text) throw badRequest('Provide the phone numbers');
            records = parseSharedPhoneLines(text).map((record) => (
                record.phone ? { ...record, password: sharedPassword } : record
            ));
        }

        if (records.length === 0) throw badRequest('No records found in the submitted data');
        const preview = await accountsService.prepareImport({ ownerId: req.user.id, method, records });
        return res.json(preview);
    } catch (error) {
        logger.error('ACCOUNTS', `Import preview error: ${error.message}`);
        next(error);
    }
});

// Confirm + persist the preview the user accepted.
router.post('/imports', async (req, res, next) => {
    try {
        const method = requireEnum(req.body.method, 'method', ['txt', 'shared_password']);
        const rawRecords = req.body.records;
        if (!Array.isArray(rawRecords) || rawRecords.length === 0) throw badRequest('Nothing to import');
        if (rawRecords.length > 500) throw badRequest('At most 500 records per import');

        const records = rawRecords.map((record) => {
            const phone = normalizePhone(record && record.phone);
            if (!phone) throw badRequest('Invalid phone number in confirmation payload');
            const password = typeof record.password === 'string' ? record.password : '';
            if (!password) throw badRequest('Missing shared password in confirmation payload');
            return { phone, password };
        });

        const result = await accountsService.commitImport({ ownerId: req.user.id, method, records });
        return res.json(result);
    } catch (error) {
        next(error);
    }
});

router.get('/', async (req, res, next) => {
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const filters = {
            status: optionalString(req.query.status, 'status', { max: 32 }),
            validationStatus: optionalString(req.query.validationStatus, 'validationStatus', { max: 32 }),
            search: optionalString(req.query.search, 'search', { max: 32 }),
            sort: optionalString(req.query.sort, 'sort', { max: 32 }),
            order: optionalString(req.query.order, 'order', { max: 8 })
        };
        const result = await accountsService.listForOwner(req.user.id, filters, { page, limit, offset });
        return res.json({
            page,
            limit,
            total: result.total,
            items: result.items.map(accountsService.toPublic)
        });
    } catch (error) {
        next(error);
    }
});

router.get('/summary', async (req, res) => {
    res.json(await accountsService.summaryForOwner(req.user.id));
});

router.delete('/clear', async (req, res, next) => {
    try {
        if (req.body && req.body.confirm !== true) throw badRequest('Confirmation required to clear records');
        const result = await accountsService.clearForOwner(req.user.id);
        return res.json({ deleted: result.deleted, message: `Cleared ${result.deleted} record(s).` });
    } catch (error) {
        next(error);
    }
});

router.delete('/:accountId', async (req, res, next) => {
    try {
        const accountId = req.params.accountId;
        if (!accountId) throw badRequest('Invalid account id');
        await accountsService.deleteForOwner(req.user.id, accountId);
        return res.json({ ok: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
