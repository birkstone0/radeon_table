// Application entry point.
//
// Serves the JSON API under /api and, in production, the built React app from
// frontend/dist (single-origin deployment, so HTTP-only session cookies work
// without CORS).
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
const mongodb = require('./db/mongodb');
const users = require('./lib/users');
const logger = require('./lib/logger');
const { sessionMiddleware, attachUser } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errors');
const { ensureInitialUsers } = users;

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const operationRoutes = require('./routes/operations');
const adminRoutes = require('./routes/admin');

async function createApp() {
    // Connect to MongoDB
    await mongodb.connect();

    // Ensure initial users are provisioned
    await ensureInitialUsers();

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    // CORS for cross-origin deployments (e.g., Netlify frontend + Render backend)
    // Only configure CORS if CLIENT_ORIGIN is set
    if (config.corsOrigin) {
        app.use((req, res, next) => {
            const origin = req.headers.origin;
            if (origin === config.corsOrigin) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Access-Control-Allow-Credentials', 'true');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            }
            if (req.method === 'OPTIONS') {
                return res.sendStatus(204);
            }
            next();
        });
    }

    // Simple request logger (no sensitive data)
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            const status = res.statusCode;
            // Skip logging successful GET requests to reduce noise (e.g., polling)
            if (req.method === 'GET' && status >= 200 && status < 300) {
                logger.debug('API', `${req.method} ${req.path} - ${status} (${duration}ms)`);
            } else {
                logger.info('API', `${req.method} ${req.path} - ${status} (${duration}ms)`);
            }
        });
        next();
    });

    app.use(sessionMiddleware());
    app.use(express.json({ limit: '512kb' }));
    app.use(attachUser);

    // API
    app.use('/api/auth', authRoutes);
    app.use('/api/accounts', require('./middleware/auth').requireAuth, accountRoutes);
    app.use('/api/operations', require('./middleware/auth').requireAuth, operationRoutes);
    app.use('/api/admin', require('./middleware/auth').requireAuth, require('./middleware/auth').requireAdmin, adminRoutes);

    app.get('/api/health', (req, res) => res.json({ ok: true, env: config.nodeEnv }));

    // Static frontend (production build)
    const publicDir = config.paths.publicDir;
    if (fs.existsSync(publicDir)) {
        app.use(express.static(publicDir));
        app.use((req, res, next) => {
            if (req.path.startsWith('/api/')) return next();
            return res.sendFile(path.join(publicDir, 'index.html'));
        });
    }

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

async function start() {
    const app = await createApp();
    const server = app.listen(config.port, () => {
        logger.info('SERVER', `Backend started on port ${config.port}`);
        logger.info('SERVER', `Environment: ${config.nodeEnv}`);
        logger.info('SERVER', `Log level: ${process.env.LOG_LEVEL || (config.nodeEnv === 'production' ? 'warn' : 'info')}`);
    });
    return server;
}

if (require.main === module) {
    start().catch(error => {
        logger.error('SERVER', `Failed to start: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { createApp, start, mongodb };
