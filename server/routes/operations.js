// Operation routes: run the existing login.js logic against the authenticated
// user's own accounts. Nothing runs until the user explicitly confirms.
const express = require('express');
const operations = require('../services/operations');
const accounts = require('../services/accounts');
const { badRequest } = require('../lib/errors');
const { parsePagination } = require('../lib/validate');
const { MAX_BATCH_STATUS_OPERATIONS, SELECTION_BATCH_SIZE } = require('../config/limits');

const router = express.Router();

// Clear the authenticated user's own activity history. Ownership is enforced
// server-side (scoped by req.user.id); the client never supplies an owner id.
router.delete('/clear', async (req, res, next) => {
    try {
        if (req.body && req.body.confirm !== true) throw badRequest('Confirmation required to clear activity');
        const result = await operations.clearForOwner(req.user.id);
        return res.json({
            hidden: result.hidden,
            message: `Cleared ${result.hidden} history record${result.hidden === 1 ? '' : 's'} from your activity.`
        });
    } catch (error) {
        next(error);
    }
});

router.post('/run', async (req, res, next) => {
    try {
        const operationType = req.body.operationType;
        if (!['claim_daily_reward', 'check_balance'].includes(operationType)) {
            throw badRequest('Unsupported operation type');
        }

        // Support both direct account IDs and selection tokens
        const accountIds = Array.isArray(req.body.accountIds) ? req.body.accountIds : [];
        const selectionToken = req.body.selectionToken || null;

        if (accountIds.length === 0 && !selectionToken) throw badRequest('Select at least one account');

        // Enforce global limit on direct account IDs
        if (accountIds.length > MAX_RECORDS_PER_OPERATION) {
            throw badRequest(`Maximum ${MAX_RECORDS_PER_OPERATION} records per operation. Selected: ${accountIds.length}. Please process in smaller batches.`);
        }

        let result;
        if (selectionToken) {
            // Use selection token to get all matching account IDs
            const SelectionToken = require('../models/SelectionToken');
            const Account = require('../models/Account');
            const Operation = require('../models/Operation');

            const token = await SelectionToken.findOne({ _id: selectionToken, ownerId: req.user.id, resourceType: 'accounts' });
            if (!token) throw badRequest('Invalid or expired selection token');

            // Build query from stored filters
            const query = { ownerId: req.user.id };
            const filters = token.filters;
            if (filters.search) query.phone = { $regex: filters.search, $options: 'i' };
            if (filters.status) query.status = filters.status;

            // Exclude manually deselected IDs
            if (token.excludedIds && token.excludedIds.length > 0) {
                query._id = { $nin: token.excludedIds };
            }

            // Batch retrieval for large selections to avoid memory issues
            const selectedAccountIds = [];
            let skip = 0;
            let hasMore = true;

            while (hasMore && selectedAccountIds.length < MAX_RECORDS_PER_OPERATION) {
                const remaining = MAX_RECORDS_PER_OPERATION - selectedAccountIds.length;
                const batchSize = Math.min(SELECTION_BATCH_SIZE, remaining);
                
                const accounts = await Account.find(query)
                    .select('_id')
                    .skip(skip)
                    .limit(batchSize);
                
                if (accounts.length === 0) {
                    hasMore = false;
                } else {
                    selectedAccountIds.push(...accounts.map(a => a._id.toString()));
                    skip += batchSize;
                    hasMore = accounts.length === batchSize && selectedAccountIds.length < MAX_RECORDS_PER_OPERATION;
                }
            }

            if (selectedAccountIds.length === 0) throw badRequest('No accounts match the selection criteria');

            result = await operations.queueAccounts({
                ownerId: req.user.id,
                operationType,
                accountIds: selectedAccountIds
            });
        } else {
            result = await operations.queueAccounts({
                ownerId: req.user.id,
                operationType,
                accountIds
            });
        }

        return res.json({
            message: `Queued ${result.queued.length} account${result.queued.length === 1 ? '' : 's'}. Processing is running in the background.`,
            queued: result.queued.length,
            operationIds: result.queued.map((item) => item.id)
        });
    } catch (error) {
        next(error);
    }
});

router.get('/', async (req, res, next) => {
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const filters = {
            operationType: typeof req.query.operationType === 'string' ? req.query.operationType : null,
            status: typeof req.query.status === 'string' ? req.query.status : null,
            phone: typeof req.query.phone === 'string' ? req.query.phone.replace(/[^0-9*]/g, '') : null,
            accountId: req.query.accountId || null,
            from: typeof req.query.from === 'string' ? req.query.from : null,
            to: typeof req.query.to === 'string' ? req.query.to : null
        };
        const result = await operations.listForOwner(req.user.id, filters, { page, limit, offset });
        return res.json({
            page,
            limit,
            total: result.total,
            items: result.items.map((operation) => ({
                id: operation._id,
                phoneMasked: operation.phoneMasked,
                operationType: operation.operationType,
                status: operation.status,
                currentStep: operation.currentStep || null,
                attemptCount: operation.attemptCount,
                retryCount: operation.retryCount,
                resultSummary: operation.resultSummary,
                error: operation.error,
                detail: operation.detail,
                durationMs: operation.durationMs,
                createdAt: operation.createdAt,
                startedAt: operation.startedAt,
                finishedAt: operation.finishedAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Cancel an eligible queued/processing operation owned by the caller. Registered
// before the `/:operationId` catch-all so "cancel" is never treated as an id.
router.post('/:operationId/cancel', async (req, res, next) => {
    try {
        const operationId = req.params.operationId;
        if (!operationId) throw badRequest('Invalid operation id');
        const operation = await operations.cancelForOwner(req.user.id, operationId);
        return res.json({
            id: operation._id,
            status: operation.status,
            message: 'Operation cancelled.'
        });
    } catch (error) {
        next(error);
    }
});

router.get('/:operationId', async (req, res, next) => {
    try {
        const operationId = req.params.operationId;
        if (!operationId) throw badRequest('Invalid operation id');
        const operation = await operations.getForOwner(req.user.id, operationId);
        return res.json({
            id: operation._id,
            phoneMasked: operation.phoneMasked,
            operationType: operation.operationType,
            status: operation.status,
            resultSummary: operation.resultSummary,
            error: operation.error,
            createdAt: operation.createdAt
        });
    } catch (error) {
        next(error);
    }
});

router.post('/batch-status', async (req, res, next) => {
    try {
        const operationIds = Array.isArray(req.body.operationIds) ? req.body.operationIds : [];
        if (operationIds.length === 0) throw badRequest('No operation ids provided');
        if (operationIds.length > MAX_BATCH_STATUS_OPERATIONS) throw badRequest(`At most ${MAX_BATCH_STATUS_OPERATIONS} operations per request`);

        const operationsList = await operations.getBatchForOwner(req.user.id, operationIds);
        return res.json({
            items: operationsList.map((operation) => ({
                id: operation._id,
                phoneMasked: operation.phoneMasked,
                operationType: operation.operationType,
                status: operation.status,
                currentStep: operation.currentStep || null,
                attemptCount: operation.attemptCount,
                retryCount: operation.retryCount,
                resultSummary: operation.resultSummary,
                error: operation.error,
                detail: operation.detail,
                durationMs: operation.durationMs,
                createdAt: operation.createdAt,
                startedAt: operation.startedAt,
                finishedAt: operation.finishedAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
