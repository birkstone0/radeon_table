// ConcurrencySlot model for MongoDB-based global concurrency control.
// This enables the concurrency limit to work across multiple backend instances.
const mongoose = require('mongoose');

const concurrencySlotSchema = new mongoose.Schema({
    instanceId: {
        type: String,
        required: true,
        index: true
    },
    operationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Operation',
        required: true,
        index: true
    },
    acquiredAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    }
}, {
    timestamps: true
});

// Index for cleanup of stale slots (older than 10 minutes)
concurrencySlotSchema.index({ acquiredAt: 1 }, { expireAfterSeconds: 600 });

// Compound index for instance queries
concurrencySlotSchema.index({ instanceId: 1, acquiredAt: 1 });

module.exports = mongoose.model('ConcurrencySlot', concurrencySlotSchema);
