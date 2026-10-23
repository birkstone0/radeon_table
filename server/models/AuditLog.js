// AuditLog model for MongoDB
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    actorName: {
        type: String
    },
    action: {
        type: String,
        required: true
    },
    targetType: {
        type: String
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    },
    ip: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes for common queries
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
