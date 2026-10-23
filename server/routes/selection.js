// Selection routes: server-side global selection across paginated lists.
// Uses SelectionToken to store query criteria instead of loading all records.
const express = require('express');
const { randomUUID } = require('crypto');
const SelectionToken = require('../models/SelectionToken');
const Operation = require('../models/Operation');
const Account = require('../models/Account');
const { badRequest, notFound } = require('../lib/errors');
const { parsePagination } = require('../lib/validate');

const router = express.Router();

// Create a selection token for operations matching the given filters
router.post('/operations', async (req, res, next) => {
    try {
        const filters = {
            operationType: typeof req.body.operationType === 'string' ? req.body.operationType : null,
            status: typeof req.body.status === 'string' ? req.body.status : null,
            phone: typeof req.body.phone === 'string' ? req.body.phone.replace(/[^0-9*]/g, '') : null,
            accountId: req.body.accountId || null,
            from: typeof req.body.from === 'string' ? req.body.from : null,
            to: typeof req.body.to === 'string' ? req.body.to : null
        };

        // Build the MongoDB query
        const query = { ownerId: req.user.id, hiddenFromOwner: { $ne: true } };
        if (filters.operationType) query.operationType = filters.operationType;
        if (filters.status) query.status = filters.status;
        if (filters.phone) query.phoneMasked = { $regex: filters.phone.replace(/\*/g, '.*') };
        if (filters.accountId) query.accountId = filters.accountId;
        if (filters.from || filters.to) {
            query.createdAt = {};
            if (filters.from) query.createdAt.$gte = new Date(filters.from);
            if (filters.to) query.createdAt.$lte = new Date(filters.to);
        }

        // Count matching records
        const count = await Operation.countDocuments(query);

        // Create selection token
        const token = await SelectionToken.create({
            ownerId: req.user.id,
            resourceType: 'operations',
            filters,
            estimatedCount: count
        });

        return res.json({
            token: token._id,
            count
        });
    } catch (error) {
        next(error);
    }
});

// Get the actual list of operation IDs matching a selection token
// Supports pagination for large selections
router.get('/operations/:token/ids', async (req, res, next) => {
    try {
        const tokenId = req.params.token;
        const { page, limit, offset } = parsePagination(req.query);

        const token = await SelectionToken.findOne({ _id: tokenId, ownerId: req.user.id, resourceType: 'operations' });
        if (!token) throw notFound('Selection token not found or expired');

        // Build query from stored filters
        const query = { ownerId: req.user.id, hiddenFromOwner: { $ne: true } };
        const filters = token.filters;
        if (filters.operationType) query.operationType = filters.operationType;
        if (filters.status) query.status = filters.status;
        if (filters.phone) query.phoneMasked = { $regex: filters.phone.replace(/\*/g, '.*') };
        if (filters.accountId) query.accountId = filters.accountId;
        if (filters.from || filters.to) {
            query.createdAt = {};
            if (filters.from) query.createdAt.$gte = new Date(filters.from);
            if (filters.to) query.createdAt.$lte = new Date(filters.to);
        }

        // Exclude manually deselected IDs
        if (token.excludedIds && token.excludedIds.length > 0) {
            query._id = { $nin: token.excludedIds };
        }

        const total = await Operation.countDocuments(query);
        const items = await Operation.find(query)
            .select('_id')
            .skip(offset)
            .limit(limit);

        return res.json({
            page,
            limit,
            total,
            items: items.map(op => op._id)
        });
    } catch (error) {
        next(error);
    }
});

// Exclude specific IDs from a selection token (individual deselection)
router.post('/operations/:token/exclude', async (req, res, next) => {
    try {
        const tokenId = req.params.token;
        const idsToExclude = Array.isArray(req.body.ids) ? req.body.ids : [];

        if (idsToExclude.length === 0) throw badRequest('No IDs provided');

        const token = await SelectionToken.findOne({ _id: tokenId, ownerId: req.user.id, resourceType: 'operations' });
        if (!token) throw notFound('Selection token not found or expired');

        // Add to excluded IDs (avoid duplicates)
        const updatedExcluded = [...new Set([...token.excludedIds, ...idsToExclude])];
        token.excludedIds = updatedExcluded;
        await token.save();

        return res.json({
            excludedCount: updatedExcluded.length,
            remainingCount: token.estimatedCount - updatedExcluded.length
        });
    } catch (error) {
        next(error);
    }
});

// Clear a selection token
router.delete('/operations/:token', async (req, res, next) => {
    try {
        const tokenId = req.params.token;
        const result = await SelectionToken.deleteOne({ _id: tokenId, ownerId: req.user.id });
        if (result.deletedCount === 0) throw notFound('Selection token not found');
        return res.json({ message: 'Selection cleared' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
