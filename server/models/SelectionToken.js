// SelectionToken model for MongoDB - used for server-side global selection
// across paginated lists. Stores the query criteria that defines which records
// are selected, avoiding the need to load all records into the browser.
const mongoose = require('mongoose');

const selectionTokenSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // The resource type being selected (e.g., 'operations', 'accounts')
    resourceType: {
        type: String,
        required: true,
        enum: ['operations', 'accounts']
    },
    // The query filters that define the selection
    filters: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    // Estimated count of matching records (cached at creation time)
    estimatedCount: {
        type: Number,
        required: true
    },
    // When the token was created (for cleanup)
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 3600  // Auto-delete after 1 hour
    },
    // Manually excluded IDs (for individual deselection)
    excludedIds: {
        type: [mongoose.Schema.Types.ObjectId],
        default: []
    }
}, {
    timestamps: true
});

// Indexes for common queries
selectionTokenSchema.index({ ownerId: 1, resourceType: 1, createdAt: -1 });

module.exports = mongoose.model('SelectionToken', selectionTokenSchema);
