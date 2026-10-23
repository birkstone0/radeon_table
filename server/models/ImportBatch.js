// ImportBatch model for MongoDB
const mongoose = require('mongoose');

const importBatchSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    method: {
        type: String,
        required: true
    },
    total: {
        type: Number,
        required: true
    },
    valid: {
        type: Number,
        required: true
    },
    invalid: {
        type: Number,
        required: true
    },
    duplicates: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes for common queries
importBatchSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('ImportBatch', importBatchSchema);
