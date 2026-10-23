// Central configuration for the website backend. All sensitive values come from
// environment variables; nothing secret is stored in the frontend bundle.
const path = require('path');
const fs = require('fs');

const isProduction = process.env.NODE_ENV === 'production';

function readEnvFile(envPath) {
    // Minimal .env loader so the project keeps working without dotenv.
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

readEnvFile(path.join(__dirname, '.env'));

const config = {
    port: Number(process.env.PORT || 8787),
    isProduction,
    nodeEnv: process.env.NODE_ENV || 'development',
    // MongoDB connection
    mongodbUri: process.env.MONGODB_URI,
    // Session secret: random per start in dev when unset, required in production.
    sessionSecret: process.env.SESSION_SECRET,
    sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_MS || 12 * 60 * 60 * 1000),
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
    cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
    // Single-origin deployment: the Express server also serves the built React app.
    // CLIENT_ORIGIN is the accepted spelling for the frontend origin (CORS_ORIGIN is
    // kept as an alias for backwards compatibility).
    corsOrigin: process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN || '',
    // Only used when the API and frontend are served from different origins.
    loginWindowMs: Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000),
    loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 10),
    paths: {
        dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
        legacyAccountsFile: process.env.ACCOUNTS_FILE || path.join(__dirname, '..', 'accounts.txt'),
        tokensFile: path.join(__dirname, '..', 'tokens.json'),
        publicDir: process.env.PUBLIC_DIR || path.join(__dirname, '..', 'frontend', 'dist')
    },
    credentials: {
        // Website accounts are provisioned from environment/admin only.
        // Initial accounts below are provisioned ONCE (idempotent) and never
        // re-hashed on later boots. They must be changed at first use in
        // production and are not documented publicly.
        adminUsername: process.env.ADMIN_USERNAME || 'hoshex',
        adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD || '',
        userUsername: process.env.MEMBER_USERNAME || 'stewie',
        userInitialPassword: process.env.MEMBER_INITIAL_PASSWORD || ''
    }
};

module.exports = config;
