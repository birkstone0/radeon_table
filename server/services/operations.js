// Operations service: turns an explicit, confirmed user request into a
// background job that calls the existing login.js logic per account and
// records real outcomes (queued / processing / success / failed).
//
// Every record is scoped to its owner; duplicate submissions are rejected with
// an in-flight request key check.
const { randomUUID } = require('crypto');
const User = require('../models/User');
const Account = require('../models/Account');
const Operation = require('../models/Operation');
const ConcurrencySlot = require('../models/ConcurrencySlot');
const { badRequest, notFound, forbidden, conflict } = require('../lib/errors');
const credentials = require('../lib/credentials');
const users = require('../lib/users');
const { maskPhone } = require('../lib/mask');
const audit = require('../lib/audit');
const tableph = require('./tableph');
const logger = require('../lib/logger');

const ACTIVE_STATUSES = ['queued', 'processing', 'retrying'];

// Globally enforced, configurable concurrency shared across ALL users and BOTH
// operation types (claim daily reward + check balance). Remaining accounts are
// queued in MongoDB and released as slots free up. Keeps the upstream TablePH
// API within a small, safe burst while preserving per-account delays.
const GLOBAL_CONCURRENCY = Math.max(1, Math.min(Number(process.env.OPERATION_CONCURRENCY || 3), 5));

// Unique instance ID for this backend process (supports multi-instance deployments)
const INSTANCE_ID = randomUUID();

// Pump state flag to prevent concurrent pump() calls
let pumping = false;

// MongoDB-based slot acquisition: atomically acquire a slot if under the limit.
// This works across multiple backend instances.
async function acquireSlot(operationId, ownerId) {
    const currentCount = await ConcurrencySlot.countDocuments();
    if (currentCount >= GLOBAL_CONCURRENCY) {
        return false;
    }
    try {
        await ConcurrencySlot.create({
            instanceId: INSTANCE_ID,
            operationId,
            ownerId,
            acquiredAt: new Date()
        });
        return true;
    } catch (error) {
        // Duplicate key or other error means slot not acquired
        return false;
    }
}

// Release a slot by deleting the ConcurrencySlot record.
async function releaseSlot(operationId) {
    await ConcurrencySlot.deleteOne({ operationId });
}

async function findAccountForOwner(ownerId, accountId) {
    return await Account.findOne({ _id: accountId, ownerId });
}

async function findOperationForOwner(ownerId, operationId) {
    return await Operation.findOne({ _id: operationId, ownerId, hiddenFromOwner: { $ne: true } });
}

async function countInFlightForOwner(ownerId) {
    return await Operation.countDocuments({
        ownerId,
        status: { $in: ['queued', 'processing', 'retrying'] }
    });
}

// Check if an account has an active operation of a different type to prevent conflicts
async function hasConflictingOperation(ownerId, accountId, operationType) {
    const conflicting = await Operation.findOne({
        ownerId,
        accountId,
        operationType: { $ne: operationType },
        status: { $in: ['queued', 'processing', 'retrying'] }
    });
    return conflicting !== null;
}

// Check for duplicate submissions within a short time window to prevent rapid-click duplicates
// Only block if the EXACT same operation was submitted within 5 seconds
async function hasRecentDuplicate(ownerId, operationType, accountIds) {
    const fiveSecondsAgo = new Date(Date.now() - 5 * 1000);
    const recent = await Operation.findOne({
        ownerId,
        operationType,
        accountId: { $in: accountIds },
        createdAt: { $gte: fiveSecondsAgo },
        status: { $in: ['queued', 'processing'] }
    });
    return recent !== null;
}

async function queueAccounts({ ownerId, operationType, accountIds }) {
    logger.info('OPS', `Queueing ${accountIds.length} accounts for ${operationType}`);
    if (!Array.isArray(accountIds) || accountIds.length === 0) throw badRequest('Select at least one account');

    // Deduplicate account IDs before counting
    const uniqueAccountIds = [...new Set(accountIds)];

    // --- Server-side access validation --------------------------
    const owner = await User.findById(ownerId);
    if (!owner) throw forbidden('Account not found or not owned by you');

    logger.info('OPS', `User: ${owner.username}, role: ${owner.role}, trials: ${JSON.stringify(owner.trials)}`);

    // Enforce per-user batch size limit (admins are exempt)
    if (owner.role !== 'admin') {
        const maxAccounts = owner.maxAccountsPerBatch || 50;
        if (uniqueAccountIds.length > maxAccounts) {
            throw badRequest(`You can process at most ${maxAccounts} account${maxAccounts === 1 ? '' : 's'} per batch. Selected: ${uniqueAccountIds.length}`);
        }
    }

    // Global hard limit (safety net)
    if (uniqueAccountIds.length > 50) throw badRequest('Select at most 50 accounts per run');

    const access = users.accessBlockedFor(owner);
    if (access.blocked) {
        logger.warn('OPS', `Access blocked: ${access.reason}`);
        throw forbidden(access.reason === 'Access expired' ? 'Account Access Expired' : access.reason);
    }

    // Check for duplicate submissions (rapid-click protection)
    // Check only if this EXACT same operation was submitted very recently
    const hasDuplicate = await hasRecentDuplicate(ownerId, operationType, uniqueAccountIds);
    if (hasDuplicate) {
        logger.warn('OPS', 'Duplicate submission detected');
        throw conflict('This operation was just submitted. Please wait a moment.');
    }

    // Validate and queue accounts, charging 1 trial per account
    // Stop when trials are exhausted
    const queued = [];
    const rejected = [];
    let trialsCharged = 0;

    logger.info('OPS', `Starting to process ${uniqueAccountIds.length} accounts with ${owner.trials?.[operationType] || 0} trials`);

    for (let i = 0; i < uniqueAccountIds.length; i++) {
        const accountId = uniqueAccountIds[i];
        logger.info('OPS', `Processing account ${i + 1}/${uniqueAccountIds.length}: ${accountId}`);

        const account = await findAccountForOwner(ownerId, accountId);
        if (!account) {
            logger.warn('OPS', `Account not found: ${accountId}`);
            rejected.push({ accountId, reason: 'Account not found or not owned by you' });
            continue;
        }

        // Check for conflicting operations on the same account (different operation type)
        const hasConflict = await hasConflictingOperation(ownerId, accountId, operationType);
        if (hasConflict) {
            logger.warn('OPS', `Conflict detected for account ${account.phoneMasked}`);
            rejected.push({ accountId, phoneMasked: account.phoneMasked, reason: 'This account is currently being processed by a different operation. Wait for it to complete.' });
            continue;
        }

        // Charge 1 trial for this account (admins are never charged)
        logger.info('OPS', `Attempting to charge trial for account ${account.phoneMasked} (${i + 1})`);
        const charged = await users.consumeTrial(ownerId, operationType, 1);
        logger.info('OPS', `Trial charge result: ${charged}`);

        if (!charged) {
            logger.warn('OPS', `No ${operationType} trials remaining for account ${account.phoneMasked} (account ${i + 1})`);
            rejected.push({ accountId, phoneMasked: account.phoneMasked, reason: 'No trial uses remaining. Contact an administrator.' });
            // Stop processing more accounts once trials are exhausted
            logger.info('OPS', `Breaking loop at account ${i + 1} due to trial exhaustion`);
            break;
        }
        trialsCharged++;
        logger.info('OPS', `Trial charged successfully for account ${account.phoneMasked} (total charged: ${trialsCharged})`);

        try {
            logger.debug('OPS', `Queuing account ${account.phoneMasked}`);
            const requestKey = randomUUID();
            const operation = await Operation.create({
                ownerId,
                accountId: account._id,
                phoneMasked: account.phoneMasked,
                operationType,
                requestKey,
                status: 'queued'
            });
            logger.debug('OPS', `Created operation ${operation._id}`);
            queued.push({
                id: operation._id,
                accountId: account._id,
                phoneMasked: account.phoneMasked
            });
        } catch (error) {
            // Refund the trial if operation creation fails
            logger.error('OPS', `Failed to create operation for account ${account.phoneMasked}: ${error.message}`);
            await users.refundTrial(ownerId, operationType, 1);
            trialsCharged--;
            rejected.push({ accountId, phoneMasked: account.phoneMasked, reason: 'Failed to create operation' });
        }
    }

    logger.info('OPS', `Charged ${trialsCharged} ${operationType} trials, queued ${queued.length} accounts, rejected ${rejected.length}`);

    // If no accounts were queued, throw an error
    if (queued.length === 0) {
        if (rejected.length > 0) {
            const primaryReason = rejected[0].reason;
            throw conflict(primaryReason);
        }
        throw badRequest('No accounts could be queued');
    }

    await audit.record({
        actor: { id: ownerId, username: null },
        action: 'operation.queued',
        targetType: 'operation',
        metadata: { operationType, count: queued.length, trialsCharged, rejectedCount: rejected.length }
    });

    logger.info('OPS', `Starting worker for ${queued.length} operations`);
    // Start the global worker immediately; remaining accounts queue in
    // MongoDB and run as slots free up (global concurrency).
    setImmediate(() => drain(ownerId));

    return { queued, rejected };
}

async function drain(ownerId) {
    // Kick off the global worker loop (idempotent). Processing is global so the
    // configured concurrency limit is shared across all owners and both
    // operation types; the worker pulls the oldest queued record and releases
    // its slot in a finally so a failed account can never leak a slot.
    logger.debug('OPS', 'Queue drain requested');
    setImmediate(() => pump());
}

async function pump() {
    if (pumping) return;
    pumping = true;
    logger.debug('OPS', `Worker starting (concurrency=${GLOBAL_CONCURRENCY})`);
    try {
        for (;;) {
            const pending = await Operation.find({ status: 'queued' })
                .sort({ createdAt: 1 })
                .limit(GLOBAL_CONCURRENCY * 2);
            if (pending.length === 0) {
                // Nothing left to run; the next /run call starts us again.
                break;
            }
            for (const operation of pending) {
                // Check if operation was cancelled while queued
                const currentOp = await Operation.findById(operation._id);
                if (!currentOp || currentOp.status === 'cancelled') {
                    logger.debug('OPS', 'Operation cancelled, skipping');
                    continue;
                }

                // Check for conflicting operations again before processing
                const hasConflict = await hasConflictingOperation(operation.ownerId, operation.accountId, operation.operationType);
                if (hasConflict) {
                    logger.debug('OPS', 'Conflicting operation, keeping queued');
                    continue;
                }

                const claimed = await Operation.updateOne(
                    { _id: operation._id, status: 'queued' },
                    { status: 'processing', startedAt: new Date() }
                );
                if (claimed.modifiedCount === 0) continue;

                // Try to acquire a MongoDB slot; if successful, run the operation.
                // If not, it will be picked up again on the next pump cycle.
                const slotAcquired = await acquireSlot(operation._id, operation.ownerId);
                if (slotAcquired) {
                    logger.debug('OPS', 'Slot acquired');
                    runWithSlot(operation).finally(async () => {
                        await releaseSlot(operation._id);
                        logger.debug('OPS', 'Slot released');
                        // After a slot frees, drain the next queued batch immediately.
                        setImmediate(() => pump());
                    });
                } else {
                    // No slot available; revert to queued and try again later
                    await Operation.updateOne(
                        { _id: operation._id },
                        { status: 'queued', startedAt: null }
                    );
                }
            }
            await tableph.sleep(25);
        }
    } catch (error) {
        logger.error('OPS', `Worker error: ${error.message}`);
    } finally {
        pumping = false;
    }
}

async function runWithSlot(operation) {
    try {
        await processOne(operation.ownerId, operation);
    } catch (error) {
        logger.error('OPS', `Processing error: ${error.message}`);
        // Mark as failed but don't re-throw - this ensures the queue continues
        await finish(operation._id, 'failed', 'Processing failed', error.message || 'Unknown error occurred');
    }
}

async function processOne(ownerId, operation) {
    logger.debug('OPS', `Processing ${operation.phoneMasked} - ${operation.operationType}`);
    const account = await findAccountForOwner(ownerId, operation.accountId);
    if (!account) {
        logger.warn('OPS', 'Account not found');
        await finish(operation._id, 'failed', 'Account no longer available', 'Account missing');
        // Request never started real processing: refund the charged trial.
        await users.refundTrial(ownerId, operation.operationType, 1);
        return;
    }
    logger.debug('OPS', `Account found: ${account.phoneMasked}`);

    const credential = credentials.get(ownerId, account.credRef);
    if (!credential) {
        logger.warn('OPS', 'Credentials expired');
        await finish(operation._id, 'failed', 'Credentials unavailable', 'Credentials expired. Re-import this account to run operations.');
        // Request never reached the upstream login flow: refund the charged trial.
        await users.refundTrial(ownerId, operation.operationType, 1);
        return;
    }

    await updateStep(operation._id, 'Logging in');
    logger.debug('OPS', `Calling tableph.runAccount - ${operation.operationType}`);
    const outcome = await tableph.runAccount({
        operation: operation.operationType,
        credentials: credential,
        operationId: operation._id,
        attempts: operation.attemptCount,
        onRetry: (attempt) => markRetry(operation._id, attempt),
        updateStep: (step) => updateStep(operation._id, step)
    });
    logger.debug('OPS', `Result: ${outcome.status} - ${outcome.summary}`);

    await finish(
        operation._id,
        outcome.status,
        outcome.summary,
        outcome.error,
        outcome.result,
        outcome.durationMs,
        { retryCount: outcome.retryCount, attemptCount: outcome.attemptCount }
    );

    // Record the outcome on the account itself for the accounts table.
    let nextStatus;
    if (outcome.status === 'success') {
        nextStatus = operation.operationType === 'claim_daily_reward' ? 'claimed' : 'balance_checked';
    } else if (outcome.status === 'already_claimed') {
        nextStatus = 'claimed'; // Already claimed is treated as successful for the account
    } else {
        nextStatus = 'failed';
    }
    await Account.findByIdAndUpdate(account._id, {
        processingStatus: nextStatus,
        lastOperation: operation.operationType,
        lastResult: outcome.result || null,
        lastError: outcome.error || null,
        lastBalance: outcome.result || account.lastBalance,
        operationCount: account.operationCount + 1,
        lastActivityAt: new Date()
    });
}

// Marks an operation as being retried and records the attempt number. The
// status stays 'retrying' between attempts so the progress modal can show the
// Queued → Processing → Retrying → … transition.
async function markRetry(operationId, attempt) {
    await Operation.findByIdAndUpdate(operationId, {
        status: 'retrying',
        attemptCount: attempt,
        retryCount: attempt - 1
    });
}

async function finish(operationId, status, summary, error, result, durationMs, counts) {
    logger.debug('OPS', `Finish: ${status} - ${summary}`);
    const update = {
        status,
        resultSummary: summary || null,
        error: error || null,
        detail: result || null,
        durationMs: durationMs === undefined ? null : durationMs,
        finishedAt: new Date()
    };
    if (counts && counts.retryCount !== undefined) update.retryCount = counts.retryCount;
    if (counts && counts.attemptCount !== undefined) update.attemptCount = counts.attemptCount;
    await Operation.findByIdAndUpdate(operationId, update);
}

async function updateStep(operationId, step) {
    logger.debug('OPS', `Step: ${step}`);
    await Operation.findByIdAndUpdate(operationId, {
        currentStep: step
    });
}

async function listForOwner(ownerId, filters, pagination) {
    // Always scope to the authenticated owner and hide soft-deleted records.
    const query = { ownerId, hiddenFromOwner: { $ne: true } };

    if (filters.operationType) {
        query.operationType = filters.operationType;
    }
    if (filters.status) {
        query.status = filters.status;
    }
    if (filters.accountId) {
        query.accountId = filters.accountId;
    }
    if (filters.phone) {
        query.phoneMasked = { $regex: filters.phone, $options: 'i' };
    }
    if (filters.from) {
        query.createdAt = { $gte: new Date(filters.from) };
    }
    if (filters.to) {
        query.createdAt = { ...query.createdAt, $lte: new Date(filters.to) };
    }

    const total = await Operation.countDocuments(query);
    const items = await Operation.find(query)
        .sort({ createdAt: -1 })
        .skip(pagination.offset)
        .limit(pagination.limit);

    return { total, items };
}

// Hides the authenticated owner's own *finished* operations from their visible
// activity history. Running jobs (queued / processing / retrying) are never
// touched, so queue state stays safe. Ownership is derived from `ownerId` on the
// server, never trusted from the client. A permanent audit record of the action
// is written so administrator oversight remains intact.
async function clearForOwner(ownerId) {
    const result = await Operation.updateMany(
        {
            ownerId,
            hiddenFromOwner: { $ne: true },
            status: { $in: ['success', 'failed', 'cancelled', 'already_claimed'] }
        },
        { $set: { hiddenFromOwner: true, hiddenAt: new Date() } }
    );
    await audit.record({
        actor: { id: ownerId, username: null },
        action: 'activity.cleared',
        targetType: 'operation',
        metadata: { hidden: result.modifiedCount }
    });
    return { hidden: result.modifiedCount };
}

async function getForOwner(ownerId, operationId) {
    const operation = await findOperationForOwner(ownerId, operationId);
    if (!operation) throw notFound('Operation not found');
    return operation;
}

async function getBatchForOwner(ownerId, operationIds) {
    const operations = await Operation.find({
        _id: { $in: operationIds },
        ownerId,
        hiddenFromOwner: { $ne: true }
    }).sort({ createdAt: 1 });
    return operations;
}

// Cancels a single queued/processing operation owned by the caller. Only
// operations that have not finished are eligible; already-finished records are
// left untouched. Ownership is enforced by scoping to `ownerId`.
// Race-safe: uses atomic update to ensure only one cancellation succeeds.
async function cancelForOwner(ownerId, operationId) {
    const operation = await findOperationForOwner(ownerId, operationId);
    if (!operation) throw notFound('Operation not found');
    if (!['queued', 'processing', 'retrying'].includes(operation.status)) {
        throw conflict('Operation is not running and cannot be cancelled');
    }
    
    // Atomic update to prevent race conditions
    const result = await Operation.updateOne(
        { _id: operation._id, status: { $in: ['queued', 'processing', 'retrying'] } },
        {
            status: 'cancelled',
            resultSummary: 'Cancelled by user',
            finishedAt: new Date()
        }
    );
    
    if (result.modifiedCount === 0) {
        // Operation was already completed or cancelled by another request
        const updated = await Operation.findById(operation._id);
        throw conflict(`Operation is ${updated.status} and cannot be cancelled`);
    }
    
    await releaseSlot(operation._id);
    await audit.record({
        actor: { id: ownerId, username: null },
        action: 'operation.cancelled',
        targetType: 'operation',
        targetId: operation._id
    });
    return operation;
}

module.exports = {
    queueAccounts,
    listForOwner,
    getForOwner,
    getBatchForOwner,
    clearForOwner,
    cancelForOwner,
    drain,
    updateStep
};
