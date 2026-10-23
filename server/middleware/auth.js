// Authentication middleware and Express session store.
//
// Sessions are stored server-side in MongoDB (opaque cookie id, HTTP-only),
// never in browser local storage. Deactivation/revocation invalidates sessions
// because every request re-reads the user row.
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const { unauthorized, HttpError, forbidden } = require('../lib/errors');
const config = require('../config');
const mongodb = require('../db/mongodb');
const User = require('../models/User');
const logger = require('../lib/logger');

function sessionMiddleware() {
    if (!config.sessionSecret) {
        if (config.isProduction) {
            throw new Error('SESSION_SECRET must be set in production');
        }
        // Development fallback: random per boot, sessions do not survive restarts.
        config.sessionSecret = require('crypto').randomBytes(32).toString('hex');
    }

    const middleware = session({
        name: 'tablephvip.sid',
        secret: config.sessionSecret,
        store: new MongoStore({
            mongoUrl: config.mongodbUri,
            collectionName: 'sessions',
            ttl: config.sessionMaxAgeMs / 1000
        }),
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            secure: config.cookieSecure,
            sameSite: config.cookieSameSite,
            maxAge: config.sessionMaxAgeMs,
            path: '/'
        }
    });

    return (req, res, next) => {
        middleware(req, res, () => {
            next();
        });
    };
}

async function destroyUserSessions(userId) {
    await mongodb.getConnection();
    const sessionStore = MongoStore.create({
        clientPromise: mongodb.getConnection(),
        collectionName: 'sessions'
    });
    await sessionStore.deleteMany({ userId });
}

async function destroyAllSessions() {
    await mongodb.getConnection();
    const sessionStore = MongoStore.create({
        clientPromise: mongodb.getConnection(),
        collectionName: 'sessions'
    });
    await sessionStore.deleteMany({});
}

async function attachUser(req, res, next) {
    if (req.session && req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user && user.status === 'active') {
            const { publicUser } = require('../lib/users');
            req.user = publicUser(user);
            logger.debug('AUTH', 'User attached');
            return next();
        }
        // Deactivated / revoked / deleted: drop the session immediately.
        req.session.destroy(() => {});
        logger.warn('AUTH', 'Session destroyed for inactive user');
        return next();
    }
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) return next(unauthorized());
    return next();
}

function requireAdmin(req, res, next) {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== 'admin') return next(forbidden('Administrator access required'));
    return next();
}

// Session diagnostics helper used by the smoke tests and /api/health.
function currentSessionSid(req) {
    return req.sessionID || null;
}

module.exports = {
    sessionMiddleware,
    attachUser,
    requireAuth,
    requireAdmin,
    destroyUserSessions,
    destroyAllSessions,
    currentSessionSid,
    HttpError
};
