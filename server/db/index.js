// MongoDB persistence layer for the website backend.
//
// Uses Mongoose for database operations. All access goes through this module
// and the Mongoose models defined in server/models/.
const config = require('../config');
const mongodb = require('./mongodb');

let connected = false;

async function ensureConnected() {
    if (!connected) {
        await mongodb.connect();
        connected = true;
    }
}

function nowIso() {
    return new Date().toISOString();
}

// Legacy compatibility layer - these functions are no longer used
// after migration to MongoDB. They are kept for reference during
// the transition period.
function run() {
    throw new Error('SQLite run() is deprecated. Use Mongoose models instead.');
}

function get() {
    throw new Error('SQLite get() is deprecated. Use Mongoose models instead.');
}

function all() {
    throw new Error('SQLite all() is deprecated. Use Mongoose models instead.');
}

function transaction(fn) {
    // Mongoose handles transactions via session
    return fn();
}

module.exports = {
    ensureConnected,
    nowIso,
    // Export MongoDB connection for direct access if needed
    mongodb,
    mongoose: mongodb.mongoose
};
