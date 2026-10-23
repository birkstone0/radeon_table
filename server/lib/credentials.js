// In-memory credential store for imported accounts.
//
// Plaintext game-account passwords exist only here, on the backend, for the
// lifetime of the server process (or until the user clears their records).
// They are never persisted to disk, returned in an API response, or written to
// logs. Each entry is keyed by a random credential reference and can only be
// looked up by the owning user id.
const { randomUUID } = require('crypto');

const store = new Map();
const TTL_MS = Number(process.env.CREDENTIAL_TTL_MS || 7 * 24 * 60 * 60 * 1000);

function ownerKey(ownerId) {
    if (ownerId === null || ownerId === undefined) return '';
    return String(ownerId);
}

function create(ownerId, phone, password) {
    const ref = randomUUID();
    store.set(ref, {
        ownerId: ownerKey(ownerId),
        phone,
        password,
        expiresAt: Date.now() + TTL_MS
    });
    return ref;
}

function get(ownerId, ref) {
    const entry = store.get(ref);
    if (!entry) return null;
    if (ownerKey(entry.ownerId) !== ownerKey(ownerId)) return null;
    if (entry.expiresAt < Date.now()) {
        store.delete(ref);
        return null;
    }
    return entry;
}

function remove(ownerId, ref) {
    const entry = store.get(ref);
    if (!entry || ownerKey(entry.ownerId) !== ownerKey(ownerId)) return false;
    store.delete(ref);
    return true;
}

function removeAllForOwner(ownerId) {
    const key = ownerKey(ownerId);
    let removed = 0;
    for (const [ref, entry] of store.entries()) {
        if (ownerKey(entry.ownerId) === key) {
            store.delete(ref);
            removed += 1;
        }
    }
    return removed;
}

function sweepExpired() {
    const now = Date.now();
    for (const [ref, entry] of store.entries()) {
        if (entry.expiresAt < now) store.delete(ref);
    }
}

setInterval(sweepExpired, 60 * 1000).unref();

module.exports = { create, get, remove, removeAllForOwner };
