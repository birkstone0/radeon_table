// Account model for MongoDB
const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    phoneMasked: {
        type: String,
        required: true
    },
    credRef: {
        type: String,
        required: true,
        unique: true
    },
    source: {
        type: String,
        required: true
    },
    importBatchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ImportBatch'
    },
    validationStatus: {
        type: String,
        required: true,
        enum: ['valid', 'invalid', 'needs_attention'],
        default: 'valid'
    },
    processingStatus: {
        type: String,
        required: true,
        enum: ['pending', 'queued', 'processing', 'claimed', 'balance_checked', 'failed', 'needs_attention'],
        default: 'pending'
    },
    lastOperation: {
        type: String
    },
    lastResult: {
        type: String
    },
    lastBalance: {
        type: String
    },
    lastError: {
        type: String
    },
    operationCount: {
        type: Number,
        default: 0
    },
    lastActivityAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes for common queries
accountSchema.index({ ownerId: 1 });
accountSchema.index({ ownerId: 1, phone: 1 });
accountSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('Account', accountSchema);
