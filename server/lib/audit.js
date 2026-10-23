// Audit trail for administrative actions. Never records passwords or tokens.
const AuditLog = require('../models/AuditLog');

async function record({ actor, action, targetType = null, targetId = null, metadata = null, ip = null }) {
    await AuditLog.create({
        actorId: actor ? actor.id : null,
        actorName: actor ? actor.username : null,
        action,
        targetType,
        targetId,
        metadata,
        ip
    });
}

async function listForUser(userId, { limit = 50, offset = 0 }) {
    return await AuditLog.find({ actorId: userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset);
}

async function listRecent({ limit = 50, offset = 0 }) {
    return await AuditLog.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset);
}

module.exports = { record, listForUser, listRecent };
