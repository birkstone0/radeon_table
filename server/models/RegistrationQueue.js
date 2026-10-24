// RegistrationQueue model for MongoDB.
//
// Persists the sequential registration workflow so a page refresh never erases
// the real outcome of an in-flight or finished registration. Each document is
// one queued phone number owned by a console user. Statuses track the account
// through the register.js workflow:
//   queued -> journey_started -> awaiting_otp -> verifying_otp
//           -> success | failed | cancelled | unknown
//
// Sensitive values are never stored here: the password and OTP only live in
// memory on the backend (see services/register.js).
const mongoose = require('mongoose');

const registrationQueueSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Normalized local phone number (e.g. "09171234567"). Kept in full on the
    // backend document but only ever returned masked to the API client.
    phone: {
        type: String,
        required: true
    },
    phoneMasked: {
        type: String,
        required: true
    },
    // Registration status within the register.js workflow.
    status: {
        type: String,
        required: true,
        enum: [
            'queued',
            'journey_started',
            'awaiting_otp',
            'verifying_otp',
            'success',
            'failed',
            'cancelled',
            'unknown'
        ],
        default: 'queued'
    },
    // Sub-state for the OTP step (delivered / invalid / expired / too_many_attempts).
    otpStatus: {
        type: String,
        enum: ['pending', 'delivered', 'invalid', 'expired', 'too_many_attempts', 'not_required'],
        default: 'pending'
    },
    otpAttemptCount: {
        type: Number,
        default: 0
    },
    // Human-readable result / error from the upstream register response. Never
    // contains the password or OTP.
    result: {
        type: String
    },
    error: {
        type: String
    },
    // Ordering within the queue. Registration runs strictly sequentially by
    // this index, oldest first, so the first account's outcome is fully known
    // before the next begins.
    sequence: {
        type: Number,
        default: 0
    },
    // Controls whether the sequential worker may advance this row. When false,
    // the queue is paused.
    enabled: {
        type: Boolean,
        default: true
    },
    startedAt: {
        type: Date
    },
    completedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// A unique request key per owner+phone prevents duplicate enqueueing.
registrationQueueSchema.index({ ownerId: 1, phone: 1 }, { unique: true });
// Worker picks the oldest enabled, not-finished row.
registrationQueueSchema.index({ ownerId: 1, enabled: 1, status: 1, sequence: 1 });

module.exports = mongoose.model('RegistrationQueue', registrationQueueSchema);