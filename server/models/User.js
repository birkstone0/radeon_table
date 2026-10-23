// User model for MongoDB
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 32,
        match: /^[A-Za-z0-9_.-]+$/
    },
    usernameKey: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: true,
        enum: ['admin', 'user']
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'deactivated', 'revoked'],
        default: 'active'
    },
    temporaryPassword: {
        type: Boolean,
        default: false
    },
    mustChangePassword: {
        type: Boolean,
        default: false
    },
    lastLoginAt: {
        type: Date
    },
    lastLoginIp: {
        type: String
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // Timed access: when a regular user's subscription expires, protected
    // operations are blocked server-side. Admin/console users are unaffected.
    accessActivatedAt: {
        type: Date
    },
    accessExpiresAt: {
        type: Date
    },
    // Access type: 'limited' uses trial quotas and accessExpiresAt; 'unlimited'
    // bypasses trial deductions but still respects unlimitedAccessExpiresAt.
    accessType: {
        type: String,
        enum: ['limited', 'unlimited'],
        default: 'limited'
    },
    // For unlimited access users: when their unlimited usage expires.
    // Null means no automatic expiration (until an admin changes it).
    unlimitedAccessExpiresAt: {
        type: Date
    },
    // Trial operation quotas, one counter per operation type. A trial use is
    // counted when the backend accepts the request (not on modal open). Only
    // users with unlimited (null) quotas are exempt from the trial checks.
    trials: {
        claim_daily_reward: {
            type: Number,
            default: 0
        },
        check_balance: {
            type: Number,
            default: 0
        }
    },
    // Maximum number of distinct accounts a user can process in a single batch.
    // Admin users are exempt from this limit (treated as unlimited).
    maxAccountsPerBatch: {
        type: Number,
        default: 50
    }
}, {
    timestamps: true
});

// Indexes for common queries
userSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model('User', userSchema);
