// Server-side user repository. Password hashing uses bcryptjs; no plaintext
// password is ever returned to the frontend or written to logs.
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { badRequest, notFound, conflict } = require('./errors');
const logger = require('./logger');

const BCRYPT_ROUNDS = 10;

function normalizeUsername(username) {
    if (typeof username !== 'string') return '';
    return username.trim();
}

function usernameKey(username) {
    return normalizeUsername(username).toLowerCase();
}

async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
    if (typeof hash !== 'string' || !hash) return false;
    try {
        return await bcrypt.compare(password, hash);
    } catch {
        return false;
    }
}

async function createUser({ username, password, role, createdBy = null, mustChangePassword = false, trials = undefined }) {
    const name = normalizeUsername(username);
    if (name.length < 3 || name.length > 32) throw badRequest('Username must be 3-32 characters');
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw badRequest('Username may only contain letters, numbers, dot, dash and underscore');
    if (typeof password !== 'string' || password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (password.length > 128) throw badRequest('Password is too long');
    if (role !== 'admin' && role !== 'user') throw badRequest('Invalid role');

    const existing = await findByUsername(name);
    if (existing) throw conflict('Username already exists');

    const hash = await hashPassword(password);
    const user = await User.create({
        username: name,
        usernameKey: usernameKey(name),
        passwordHash: hash,
        role,
        status: 'active',
        temporaryPassword: mustChangePassword,
        mustChangePassword,
        createdBy,
        trials: trials || { claim_daily_reward: 0, check_balance: 0 }
    });
    return user;
}

async function findById(id) {
    return await User.findById(id);
}

async function findByUsername(username) {
    return await User.findOne({ usernameKey: usernameKey(username) });
}

async function updatePassword(id, password, { temporary = false } = {}) {
    if (typeof password !== 'string' || password.length < 8) throw badRequest('Password must be at least 8 characters');
    const hash = await hashPassword(password);
    await User.findByIdAndUpdate(id, {
        passwordHash: hash,
        temporaryPassword: temporary,
        mustChangePassword: false
    });
}

async function setStatus(id, status) {
    if (!['active', 'deactivated', 'revoked'].includes(status)) throw badRequest('Invalid status');
    await User.findByIdAndUpdate(id, { status });
}

async function touchLogin(id, ip) {
    await User.findByIdAndUpdate(id, {
        lastLoginAt: new Date(),
        lastLoginIp: ip || null
    });
}

async function countUsers() {
    return await User.countDocuments();
}

async function countActiveAdmins(excludeId = null) {
    if (excludeId === null) {
        return await User.countDocuments({ role: 'admin', status: 'active' });
    }
    return await User.countDocuments({ role: 'admin', status: 'active', _id: { $ne: excludeId } });
}

// Safe projection: never include password_hash.
function publicUser(user) {
    if (!user) return null;
    const now = Date.now();
    const accessExpiresAt = user.accessExpiresAt ? new Date(user.accessExpiresAt).getTime() : null;
    const accessExpired = user.role === 'user' && accessExpiresAt !== null && accessExpiresAt < now;
    const accessType = user.accessType || 'limited';
    const unlimitedAccessExpiresAt = user.unlimitedAccessExpiresAt ? new Date(user.unlimitedAccessExpiresAt).getTime() : null;
    const unlimitedAccessExpired = accessType === 'unlimited' && unlimitedAccessExpiresAt !== null && unlimitedAccessExpiresAt < now;
    return {
        id: user._id,
        username: user.username,
        role: user.role,
        status: user.status,
        mustChangePassword: Boolean(user.mustChangePassword),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
        accessActivatedAt: user.accessActivatedAt || null,
        accessExpiresAt: user.accessExpiresAt || null,
        accessExpired,
        accessType,
        unlimitedAccessExpiresAt: user.unlimitedAccessExpiresAt || null,
        unlimitedAccessExpired,
        // Admins are never charged or blocked by quotas; surface that so the UI
        // can render "Unlimited" instead of the stored zero counters.
        trialsUnlimited: user.role === 'admin' || accessType === 'unlimited',
        trials: user.trials || { claim_daily_reward: 0, check_balance: 0 }
    };
}

// The trial budget for a user. Regular users get a fixed allowance; admins and
// unlimited access users are never charged and are exempt from access-expiry blocks.
function trialQuotaFor(user, operationType) {
    const unlimited = user.role === 'admin' || user.status === 'revoked' || (user.accessType === 'unlimited');
    if (unlimited) return { remaining: null, limit: null, unlimited: true };
    const trials = user.trials || {};
    const remaining = typeof trials[operationType] === 'number' ? Math.max(trials[operationType], 0) : 0;
    return { remaining, limit: remaining, unlimited: false };
}

function accessBlockedFor(user) {
    if (!user) return { blocked: true, reason: 'Not authenticated' };
    if (user.role !== 'user') return { blocked: false };
    if (user.status === 'revoked') return { blocked: true, reason: 'Access revoked' };
    if (user.status === 'deactivated') return { blocked: true, reason: 'Account is deactivated' };

    const accessType = user.accessType || 'limited';
    const now = Date.now();

    // For unlimited access users, check unlimitedAccessExpiresAt
    if (accessType === 'unlimited') {
        if (user.unlimitedAccessExpiresAt && new Date(user.unlimitedAccessExpiresAt).getTime() < now) {
            return { blocked: true, reason: 'Unlimited access expired' };
        }
        // Unlimited access with no expiration is valid
        return { blocked: false };
    }

    // For limited access users, check accessExpiresAt
    if (user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() < now) {
        return { blocked: true, reason: 'Access expired' };
    }

    return { blocked: false };
}

// Decrement a trial counter atomically. Returns true when the operation was
// charged, false when the user has no trials left. Admins and unlimited access
// users are never charged.
async function consumeTrial(userId, operationType, amount = 1) {
    const user = await User.findById(userId);
    if (!user) return false;
    // Admins and unlimited access users are never charged
    if (user.role === 'admin' || (user.accessType === 'unlimited')) return true;

    const res = await User.updateOne(
        {
            _id: userId,
            [`trials.${operationType}`]: { $gte: amount }
        },
        { $inc: { [`trials.${operationType}`]: -amount } }
    );
    return res.modifiedCount > 0;
}

// Refund previously-charged trials (used when a queued request fails before
// any real processing starts, e.g. credential expiry or account-missing).
async function refundTrial(userId, operationType, amount = 1) {
    await User.updateOne(
        { _id: userId, role: { $ne: 'admin' } },
        { $inc: { [`trials.${operationType}`]: amount } }
    );
}

async function ensureInitialUsers() {
    // Idempotent provisioning: only creates accounts that do not exist yet and
    // never resets an existing password on boot.
    const config = require('../config');
    const targets = [];
    if (config.credentials.adminUsername && config.credentials.adminInitialPassword) {
        targets.push({
            username: config.credentials.adminUsername,
            password: config.credentials.adminInitialPassword,
            role: 'admin',
            mustChangePassword: true
        });
    }
    if (config.credentials.userUsername && config.credentials.userInitialPassword) {
        targets.push({
            username: config.credentials.userUsername,
            password: config.credentials.userInitialPassword,
            role: 'user',
            mustChangePassword: true
        });
    }

    for (const target of targets) {
        const existing = await findByUsername(target.username);
        if (existing) {
            if (existing.role !== target.role) {
                // Preserve existing accounts: only correct the role so the
                // provisioned account keeps working after a config change.
                await User.findByIdAndUpdate(existing._id, { role: target.role });
            }
            // Special case: Stewie's trials must remain at 0 and never be restored
            // by the provisioning logic. This prevents automatic trial restoration.
            if (target.username.toLowerCase() === 'stewie' && existing.role === 'user') {
                const currentTrials = existing.trials || {};
                if (currentTrials.claim_daily_reward !== 0 || currentTrials.check_balance !== 0) {
                    logger.warn('USERS', 'Resetting Stewie trials to 0 (enforcement)');
                    await User.findByIdAndUpdate(existing._id, {
                        'trials.claim_daily_reward': 0,
                        'trials.check_balance': 0
                    });
                }
            }
            continue;
        }
        // For new users, set Stewie's trials to 0 explicitly
        const trials = target.username.toLowerCase() === 'stewie' && target.role === 'user'
            ? { claim_daily_reward: 0, check_balance: 0 }
            : undefined;
        await createUser({ ...target, createdBy: null, trials });
    }

    const userCount = await countUsers();
    if (userCount === 0) {
        // No credentials configured at all: create a first admin so the console
        // is never left without an owner. Password comes from env only.
        if (process.env.ADMIN_FALLBACK_PASSWORD) {
            await createUser({
                username: process.env.ADMIN_USERNAME || 'hoshex',
                password: process.env.ADMIN_FALLBACK_PASSWORD,
                role: 'admin',
                mustChangePassword: true
            });
        }
    }
}

module.exports = {
    hashPassword,
    verifyPassword,
    createUser,
    findById,
    findByUsername,
    updatePassword,
    setStatus,
    touchLogin,
    countUsers,
    countActiveAdmins,
    publicUser,
    ensureInitialUsers,
    normalizeUsername,
    usernameKey,
    trialQuotaFor,
    accessBlockedFor,
    consumeTrial,
    refundTrial
};
