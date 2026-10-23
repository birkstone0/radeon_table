// Operation model for MongoDB
const mongoose = require('mongoose');

const operationSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        index: true
    },
    phoneMasked: {
        type: String,
        required: true
    },
    operationType: {
        type: String,
        required: true,
        enum: ['claim_daily_reward', 'check_balance']
    },
    requestKey: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        required: true,
        enum: ['queued', 'processing', 'retrying', 'success', 'failed', 'cancelled', 'already_claimed'],
        default: 'queued'
    },
    attemptCount: {
        type: Number,
        default: 1
    },
    retryCount: {
        type: Number,
        default: 0
    },
    maxRetries: {
        type: Number,
        default: 2
    },
    currentStep: {
        type: String
    },
    resultSummary: {
        type: String
    },
    detail: {
        type: String
    },
    error: {
        type: String
    },
    durationMs: {
        type: Number
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    startedAt: {
        type: Date
    },
    finishedAt: {
        type: Date
    },
    // Soft-delete flag: "Clear activity" hides finished records from the owner's
    // history without destroying audit/operation data or touching running jobs.
    hiddenFromOwner: {
        type: Boolean,
        default: false
    },
    hiddenAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes for common queries
operationSchema.index({ ownerId: 1, createdAt: -1 });
operationSchema.index({ ownerId: 1, operationType: 1 });

module.exports = mongoose.model('Operation', operationSchema);
