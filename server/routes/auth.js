// Authentication routes: login, logout, session bootstrap, password change.
//
// Rate limiting is in-memory (per IP + username) which is sufficient for this
// single-process deployment; it prevents brute force on the console accounts.
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { badRequest, unauthorized, HttpError } = require('../lib/errors');
const users = require('../lib/users');
const audit = require('../lib/audit');
const { destroyUserSessions } = require('../middleware/auth');

const router = express.Router();

const attempts = new Map();

function attemptKey(ip, username) {
    return `${ip || 'unknown'}|${String(username || '').toLowerCase()}`;
}

function checkRateLimit(ip, username) {
    const key = attemptKey(ip, username);
    const entry = attempts.get(key);
    const now = Date.now();
    if (!entry) return;
    if (entry.blockedUntil && entry.blockedUntil > now) {
        throw new HttpError(429, 'Too many login attempts. Try again later.');
    }
    if (entry.blockedUntil && entry.blockedUntil <= now) {
        attempts.delete(key);
    }
}

function registerFailure(ip, username) {
    const key = attemptKey(ip, username);
    const now = Date.now();
    const entry = attempts.get(key) || { count: 0, firstAt: now, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= config.loginMaxAttempts) {
        entry.blockedUntil = now + config.loginWindowMs;
    }
    attempts.set(key, entry);
}

function clearFailures(ip, username) {
    attempts.delete(attemptKey(ip, username));
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts.entries()) {
        if (entry.blockedUntil < now) attempts.delete(key);
    }
}, config.loginWindowMs).unref();

router.post('/login', async (req, res, next) => {
    try {
        const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        if (!username || !password) throw badRequest('Username and password are required');
        if (password.length > 128) throw badRequest('Invalid credentials');

        const ip = req.ip || req.connection?.remoteAddress;
        checkRateLimit(ip, username);

        const user = await users.findByUsername(username);
        if (!user) {
            // Same error for unknown users and wrong passwords.
            registerFailure(ip, username);
            throw unauthorized('Invalid username or password');
        }
        if (user.status !== 'active') {
            throw new HttpError(403, 'This account is not active. Contact an administrator.');
        }

        const valid = await users.verifyPassword(password, user.passwordHash);
        if (!valid) {
            registerFailure(ip, username);
            throw unauthorized('Invalid username or password');
        }

        clearFailures(ip, username);
        await users.touchLogin(user._id, ip);
        await audit.record({
            actor: user,
            action: 'auth.login',
            targetType: 'user',
            targetId: user._id,
            ip
        });
        // Regenerate the session id on login to prevent fixation.
        req.session.regenerate((error) => {
            if (error) return next(error);
            req.session.userId = user._id;
            req.session.ip = ip;
            req.session.save(async (saveError) => {
                if (saveError) return next(saveError);
                const refreshedUser = await users.findById(user._id);
                return res.json({
                    user: users.publicUser(refreshedUser),
                    mustChangePassword: Boolean(refreshedUser.mustChangePassword)
                });
            });
        });
    } catch (error) {
        next(error);
    }
});

router.post('/logout', async (req, res) => {
    const userId = req.session && req.session.userId;
    req.session.destroy(async () => {
        res.clearCookie('tablephvip.sid', { path: '/' });
        if (userId) {
            const user = await users.findById(userId);
            await audit.record({ actor: user, action: 'auth.logout', targetType: 'user', targetId: userId });
        }
        res.json({ ok: true });
    });
});

router.get('/session', (req, res) => {
    if (!req.user) return res.json({ user: null });
    return res.json({ user: req.user });
});

router.post('/change-password', async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
        const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
        const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';
        if (!currentPassword || !newPassword) throw badRequest('Current and new password are required');
        if (newPassword !== confirmPassword) throw badRequest('New password confirmation does not match');
        if (newPassword.length < 8) throw badRequest('New password must be at least 8 characters');
        if (newPassword.length > 128) throw badRequest('New password is too long');

        const user = await users.findById(req.user.id);
        if (!user) throw unauthorized();
        if (!user.mustChangePassword) {
            // Changing a non-temporary password always requires the old one.
            const valid = await users.verifyPassword(currentPassword, user.passwordHash);
            if (!valid) throw unauthorized('Current password is incorrect');
        } else {
            const valid = await users.verifyPassword(currentPassword, user.passwordHash);
            if (!valid) throw unauthorized('Current password is incorrect');
        }
        if (newPassword === currentPassword) throw badRequest('New password must be different');

        await users.updatePassword(user._id, newPassword, { temporary: false });
        await audit.record({
            actor: req.user,
            action: 'auth.password_changed',
            targetType: 'user',
            targetId: req.user.id
        });

        // Invalidate every other session for this account.
        await destroyUserSessions(req.user.id);
        const refreshedUser = await users.findById(req.user.id);
        return res.json({ user: users.publicUser(refreshedUser) });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
