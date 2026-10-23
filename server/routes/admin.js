// Administrator routes. All require an authenticated, active admin session.
//
// Includes user management (create, activate, deactivate, revoke, restore),
// authorized administrative views of user-owned records and operation history,
// and the administrative audit trail. Administrative actions are recorded
// without passwords or tokens.
const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Account = require('../models/Account');
const Operation = require('../models/Operation');
const users = require('../lib/users');
const audit = require('../lib/audit');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { requireString, optionalString, requireEnum, requireInteger, parsePagination } = require('../lib/validate');
const { destroyUserSessions } = require('../middleware/auth');
const accountsService = require('../services/accounts');
const operations = require('../services/operations');
const { maskPhone } = require('../lib/mask');

const router = express.Router();

// --- Timed access / trial administration --------------------------------

const ACCESS_DURATIONS = {
    '20m': 20 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
};
const CUSTOM_ACCESS_MAX_MS = 365 * 24 * 60 * 60 * 1000;

function durationMsFor(key) {
    if (typeof key === 'string' && ACCESS_DURATIONS[key]) return ACCESS_DURATIONS[key];
    if (typeof key === 'number' && Number.isFinite(key)) {
        const ms = Math.round(key);
        if (ms < 0) throw badRequest('Custom duration cannot be negative');
        if (ms > CUSTOM_ACCESS_MAX_MS) throw badRequest('Custom duration cannot exceed 365 days');
        return ms;
    }
    throw badRequest('Invalid access duration');
}

// Edit Access: activate/extend/revoke, set trial quotas. A single admin
// action can combine access duration + trial adjustments. All enforcement is
// server-side on the User document.
router.post('/users/:userId/access', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        const user = await loadUserOr404(userId);

        const updates = {};
        const auditMeta = {};

        // --- Access type and unlimited access ---
        const accessType = req.body.accessType;       // 'limited' | 'unlimited'
        if (accessType !== undefined && accessType !== null) {
            if (!['limited', 'unlimited'].includes(accessType)) throw badRequest('Invalid access type');
            updates.accessType = accessType;
            auditMeta.accessType = accessType;
        }

        // --- Unlimited access duration ---
        const unlimitedDuration = req.body.unlimitedDuration;  // number(ms) or null for no expiration
        const unlimitedExtend = req.body.unlimitedExtend !== false;
        if (unlimitedDuration !== undefined && unlimitedDuration !== null) {
            if (user.accessType !== 'unlimited') {
                throw badRequest('Cannot set unlimited duration for non-unlimited access type');
            }
            const ms = durationMsFor(unlimitedDuration);
            const base = unlimitedExtend && user.unlimitedAccessExpiresAt && new Date(user.unlimitedAccessExpiresAt).getTime() > Date.now()
                ? new Date(user.unlimitedAccessExpiresAt).getTime()
                : Date.now();
            // If duration is null or undefined, remove expiration (no auto-expire)
            if (unlimitedDuration === null || unlimitedDuration === undefined) {
                updates.unlimitedAccessExpiresAt = null;
            } else if (ms === 0) {
                updates.unlimitedAccessExpiresAt = new Date(Date.now());
            } else {
                updates.unlimitedAccessExpiresAt = new Date(base + ms);
            }
            auditMeta.unlimitedDuration = typeof unlimitedDuration === 'number' ? unlimitedDuration : unlimitedDuration;
            auditMeta.unlimitedExtend = Boolean(unlimitedExtend);
        }

        // --- Timed access (for limited access type) ---
        const duration = req.body.duration;           // '20m'|'1h'|'1d'|'7d'|'30d'| number(ms)
        const extend = req.body.extend !== false;     // default extends from current expiry
        if (duration !== undefined && duration !== null && duration !== '') {
            if (user.accessType === 'unlimited') {
                throw badRequest('Cannot set limited duration for unlimited access type');
            }
            const ms = durationMsFor(duration);
            const base = extend && user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() > Date.now()
                ? new Date(user.accessExpiresAt).getTime()
                : Date.now();
            updates.accessActivatedAt = user.accessActivatedAt || new Date();
            // If duration is 0, set expiry to now (effectively expires immediately)
            if (ms === 0) {
                updates.accessExpiresAt = new Date(Date.now());
            } else {
                updates.accessExpiresAt = new Date(base + ms);
            }
            auditMeta.duration = typeof duration === 'number' ? duration : duration;
            auditMeta.extend = Boolean(extend);
        }

        // --- Revoke access (immediate expiry, no new quota change) ---
        if (req.body.revokeAccess === true) {
            updates.accessExpiresAt = new Date(Date.now() - 1000);
            auditMeta.revokeAccess = true;
        }

        // --- Trial quotas (only update fields that are explicitly provided) ---
        const trials = req.body.trials;
        if (trials !== undefined && trials !== null) {
            if (typeof trials !== 'object' || Array.isArray(trials)) throw badRequest('Trials must be an object');
            for (const opType of ['claim_daily_reward', 'check_balance']) {
                if (trials[opType] !== undefined) {
                    const value = requireInteger(trials[opType], `trials.${opType}`, { min: 0, max: 1000000 });
                    updates[`trials.${opType}`] = value;
                    auditMeta[`trials.${opType}`] = value;
                }
            }
        }

        // --- Max accounts per batch ---
        const maxAccountsPerBatch = req.body.maxAccountsPerBatch;
        if (maxAccountsPerBatch !== undefined && maxAccountsPerBatch !== null) {
            const value = requireInteger(maxAccountsPerBatch, 'maxAccountsPerBatch', { min: 1, max: 10000 });
            updates.maxAccountsPerBatch = value;
            auditMeta.maxAccountsPerBatch = value;
        }

        // Security: Prevent role modification through this endpoint
        // Role can only be set during user creation by an admin
        if (req.body.role !== undefined) {
            delete req.body.role;
        }

        // --- Activation status ---
        // Allow admins to activate/deactivate the selected user from the Edit
        // Access modal. Revocation stays a separate, explicit action.
        const status = req.body.status;
        if (status !== undefined && status !== null) {
            if (status === 'active' || status === 'deactivated') {
                if (status === 'deactivated' && user.role === 'admin' && await users.countActiveAdmins(user._id) === 0) {
                    throw conflict('Cannot deactivate the last active administrator');
                }
                updates.status = status;
                auditMeta.status = status;
            } else {
                throw badRequest('Invalid status');
            }
        }

        if (Object.keys(updates).length === 0) {
            throw badRequest('Provide at least one access or trial change');
        }

        await User.findByIdAndUpdate(user._id, { $set: updates });

        // Deactivating a user ends their sessions immediately.
        if (updates.status === 'deactivated' || updates.status === 'revoked') {
            await destroyUserSessions(user._id);
        }

        await audit.record({
            actor: req.user,
            action: 'user.access_updated',
            targetType: 'user',
            targetId: user._id,
            metadata: auditMeta
        });

        return res.json({ user: users.publicUser(await users.findById(user._id)) });
    } catch (error) {
        next(error);
    }
});

router.get('/overview', async (req, res) => {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const deactivatedUsers = await User.countDocuments({ status: 'deactivated' });
    const revokedUsers = await User.countDocuments({ status: 'revoked' });
    const totalAccounts = await Account.countDocuments();
    const totalOperations = await Operation.countDocuments();
    const failedOperations = await Operation.countDocuments({ status: 'failed' });
    return res.json({
        users: { total: totalUsers, active: activeUsers, deactivated: deactivatedUsers, revoked: revokedUsers },
        accounts: { total: totalAccounts },
        operations: { total: totalOperations, failed: failedOperations }
    });
});

router.get('/users', async (req, res, next) => {
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const query = {};
        if (typeof req.query.status === 'string' && req.query.status) {
            query.status = req.query.status;
        }
        if (typeof req.query.role === 'string' && req.query.role) {
            query.role = req.query.role;
        }
        if (typeof req.query.search === 'string' && req.query.search.trim()) {
            query.username = { $regex: req.query.search.trim(), $options: 'i' };
        }
        const total = await User.countDocuments(query);
        const items = await User.find(query)
            .sort({ createdAt: 1 })
            .skip(offset)
            .limit(limit);
        const enrichedItems = await Promise.all(items.map(async (user) => ({
            ...users.publicUser(user),
            accountCount: await Account.countDocuments({ ownerId: user._id }),
            operationCount: await Operation.countDocuments({ ownerId: user._id })
        })));
        return res.json({
            page,
            limit,
            total,
            items: enrichedItems
        });
    } catch (error) {
        next(error);
    }
});

router.post('/users', async (req, res, next) => {
    try {
        const username = requireString(req.body.username, 'Username', { min: 3, max: 32 });
        const password = requireString(req.body.password, 'Password', { min: 8, max: 128 });
        const role = requireEnum(req.body.role, 'Role', ['admin', 'user']);
        const temporary = req.body.temporaryPassword !== false;

        const user = await users.createUser({
            username,
            password,
            role,
            createdBy: req.user.id,
            mustChangePassword: temporary
        });

        await audit.record({
            actor: req.user,
            action: 'user.created',
            targetType: 'user',
            targetId: user._id,
            metadata: { role }
        });

        return res.status(201).json({ user: users.publicUser(user) });
    } catch (error) {
        next(error);
    }
});

async function loadUserOr404(userId) {
    const user = await users.findById(userId);
    if (!user) throw notFound('User not found');
    return user;
}

router.post('/users/:userId/activate', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        const user = await loadUserOr404(userId);
        await users.setStatus(user._id, 'active');
        await audit.record({ actor: req.user, action: 'user.activated', targetType: 'user', targetId: user._id });
        return res.json({ user: users.publicUser(await users.findById(user._id)) });
    } catch (error) {
        next(error);
    }
});

router.post('/users/:userId/deactivate', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        const user = await loadUserOr404(userId);

        // Never leave the console without an active administrator.
        if (user.role === 'admin' && await users.countActiveAdmins(user._id) === 0) {
            throw conflict('Cannot deactivate the last active administrator');
        }

        await users.setStatus(user._id, 'deactivated');
        // Invalidate every existing session for this account immediately.
        await destroyUserSessions(user._id);
        await audit.record({ actor: req.user, action: 'user.deactivated', targetType: 'user', targetId: user._id });
        return res.json({ user: users.publicUser(await users.findById(user._id)) });
    } catch (error) {
        next(error);
    }
});

router.post('/users/:userId/revoke', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        const user = await loadUserOr404(userId);

        if (user.role === 'admin' && await users.countActiveAdmins(user._id) === 0) {
            throw conflict('Cannot revoke access of the last active administrator');
        }
        if (user._id === req.user.id) throw badRequest('You cannot revoke your own access');

        await users.setStatus(user._id, 'revoked');
        await destroyUserSessions(user._id);
        await audit.record({ actor: req.user, action: 'user.revoked', targetType: 'user', targetId: user._id });
        return res.json({ user: users.publicUser(await users.findById(user._id)) });
    } catch (error) {
        next(error);
    }
});

router.post('/users/:userId/reset-password', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        const user = await loadUserOr404(userId);
        const supplied = optionalString(req.body.password, 'Password', { max: 128 });
        const temporaryPassword = supplied || crypto.randomBytes(9).toString('base64url');
        if (temporaryPassword.length < 8) throw badRequest('Password must be at least 8 characters');

        await users.updatePassword(user._id, temporaryPassword, { temporary: true });
        await destroyUserSessions(user._id);
        await audit.record({ actor: req.user, action: 'user.password_reset', targetType: 'user', targetId: user._id });
        return res.json({ temporaryPassword, mustChangePassword: true });
    } catch (error) {
        next(error);
    }
});

router.delete('/users/:userId', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        const user = await loadUserOr404(userId);
        if (user._id === req.user.id) throw badRequest('You cannot delete your own account');
        if (user.role === 'admin' && await users.countActiveAdmins(user._id) === 0) {
            throw conflict('Cannot delete the last active administrator');
        }
        await User.deleteOne({ _id: userId });
        await audit.record({
            actor: req.user,
            action: 'user.deleted',
            targetType: 'user',
            targetId: user._id,
            metadata: { username: user.username }
        });
        return res.json({ ok: true });
    } catch (error) {
        next(error);
    }
});

// Authorized administrative view of a specific user's records.
router.get('/users/:userId/accounts', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        await loadUserOr404(userId);
        const { page, limit, offset } = parsePagination(req.query);
        const result = await accountsService.listForOwner(
            userId,
            {
                status: optionalString(req.query.status, 'status', { max: 32 }),
                search: optionalString(req.query.search, 'search', { max: 32 })
            },
            { page, limit, offset }
        );
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

// Authorized administrative view of a specific user's operation history.
router.get('/users/:userId/operations', async (req, res, next) => {
    try {
        const userId = req.params.userId;
        await loadUserOr404(userId);
        const { page, limit, offset } = parsePagination(req.query);
        const result = await operations.listForOwner(
            userId,
            { operationType: optionalString(req.query.operationType, 'operationType', { max: 32 }) },
            { page, limit, offset }
        );
        return res.json({ page, limit, total: result.total, items: result.items });
    } catch (error) {
        next(error);
    }
});

router.get('/operations', async (req, res, next) => {
    try {
        const { page, limit, offset } = parsePagination(req.query);
        const query = {};
        if (typeof req.query.status === 'string' && req.query.status) {
            query.status = req.query.status;
        }
        if (typeof req.query.operationType === 'string' && req.query.operationType) {
            query.operationType = req.query.operationType;
        }
        const total = await Operation.countDocuments(query);
        const items = await Operation.find(query)
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit);
        return res.json({ page, limit, total, items });
    } catch (error) {
        next(error);
    }
});

router.get('/audit', async (req, res, next) => {
    try {
        const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50 });
        const AuditLog = require('../models/AuditLog');
        const total = await AuditLog.countDocuments();
        const items = await audit.listRecent({ limit, offset });
        return res.json({ page, limit, total, items });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
