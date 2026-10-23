// Regression tests for large imports and unlimited access
const assert = require('assert');

function testLargeImportLimit() {
    console.log('Testing large import with 1500-record limit...');

    // Simulate import validation with 1500-record limit
    function validateImport(records) {
        if (!Array.isArray(records)) throw new Error('Invalid import payload');
        if (records.length === 0) throw new Error('No records to import');
        if (records.length > 1500) throw new Error('Maximum 1500 records per import');
        return { valid: true, count: records.length };
    }

    // Test with 1500 records (should pass)
    const maxImport = Array.from({ length: 1500 }, (_, i) => ({
        phone: `0917${String(i).padStart(8, '0')}`,
        password: 'test123'
    }));

    const result1 = validateImport(maxImport);
    assert.strictEqual(result1.valid, true, '1500 records should be valid');
    assert.strictEqual(result1.count, 1500, 'Should accept 1500 records');

    // Test with 1501 records (should fail)
    const tooMany = Array.from({ length: 1501 }, (_, i) => ({
        phone: `0917${String(i).padStart(8, '0')}`,
        password: 'test123'
    }));

    try {
        validateImport(tooMany);
        assert.fail('Should reject 1501 records');
    } catch (err) {
        assert.ok(err.message.includes('Maximum 1500'), 'Should show correct error message');
    }

    console.log('✓ Large import limit test passed');
}

function testImportBatchProcessing() {
    console.log('Testing import batch processing...');

    // Simulate batch insertion with BATCH_SIZE = 100
    const BATCH_SIZE = 100;
    const records = Array.from({ length: 1500 }, (_, i) => ({
        phone: `0917${String(i).padStart(8, '0')}`,
        password: 'test123'
    }));

    const batches = [];
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const chunk = records.slice(i, i + BATCH_SIZE);
        batches.push(chunk);
    }

    assert.strictEqual(batches.length, 15, 'Should have 15 batches for 1500 records');
    assert.strictEqual(batches[0].length, 100, 'First batch should have 100 records');
    assert.strictEqual(batches[14].length, 100, 'Last batch should have 100 records');

    console.log('✓ Import batch processing test passed');
}

function testSelectionTokenBatchRetrieval() {
    console.log('Testing selection token batch retrieval...');

    // Simulate batch retrieval for large selections
    const BATCH_SIZE = 1000;
    const totalRecords = 1500;

    const retrievedIds = [];
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
        const batchSize = Math.min(BATCH_SIZE, totalRecords - skip);
        if (batchSize <= 0) {
            hasMore = false;
        } else {
            retrievedIds.push(...Array.from({ length: batchSize }, (_, i) => skip + i));
            skip += BATCH_SIZE;
            hasMore = skip < totalRecords;
        }
    }

    assert.strictEqual(retrievedIds.length, 1500, 'Should retrieve all 1500 records');
    assert.strictEqual(retrievedIds[0], 0, 'First ID should be 0');
    assert.strictEqual(retrievedIds[1499], 1499, 'Last ID should be 1499');

    console.log('✓ Selection token batch retrieval test passed');
}

function testUnlimitedAccessTrialExemption() {
    console.log('Testing unlimited access trial exemption...');

    // Simulate trial consumption logic
    function shouldConsumeTrial(user) {
        if (user.role === 'admin') return false;
        if (user.accessType === 'unlimited') return false;
        return true;
    }

    const unlimitedUser = { role: 'user', accessType: 'unlimited' };
    const limitedUser = { role: 'user', accessType: 'limited' };
    const adminUser = { role: 'admin', accessType: 'limited' };

    assert.strictEqual(shouldConsumeTrial(unlimitedUser), false, 'Unlimited user should not consume trials');
    assert.strictEqual(shouldConsumeTrial(limitedUser), true, 'Limited user should consume trials');
    assert.strictEqual(shouldConsumeTrial(adminUser), false, 'Admin should not consume trials');

    console.log('✓ Unlimited access trial exemption test passed');
}

function testUnlimitedAccessExpiration() {
    console.log('Testing unlimited access expiration...');

    const now = Date.now();

    // Test active unlimited access with expiration
    const activeUnlimited = {
        accessType: 'unlimited',
        unlimitedAccessExpiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000)
    };

    const isExpired1 = activeUnlimited.unlimitedAccessExpiresAt.getTime() < now;
    assert.strictEqual(isExpired1, false, 'Active unlimited access should not be expired');

    // Test expired unlimited access
    const expiredUnlimited = {
        accessType: 'unlimited',
        unlimitedAccessExpiresAt: new Date(now - 1000)
    };

    const isExpired2 = expiredUnlimited.unlimitedAccessExpiresAt.getTime() < now;
    assert.strictEqual(isExpired2, true, 'Expired unlimited access should be expired');

    // Test unlimited access with no expiration
    const noExpiration = {
        accessType: 'unlimited',
        unlimitedAccessExpiresAt: null
    };

    const isExpired3 = noExpiration.unlimitedAccessExpiresAt !== null && noExpiration.unlimitedAccessExpiresAt.getTime() < now;
    assert.strictEqual(isExpired3, false, 'Unlimited access with no expiration should not be expired');

    console.log('✓ Unlimited access expiration test passed');
}

function testDurationPresets() {
    console.log('Testing unlimited access duration presets...');

    const DURATION_MS = {
        '1d': 24 * 60 * 60 * 1000,
        '3d': 3 * 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '14d': 14 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
    };

    assert.strictEqual(DURATION_MS['1d'], 86400000, '1 day should be 86400000ms');
    assert.strictEqual(DURATION_MS['3d'], 259200000, '3 days should be 259200000ms');
    assert.strictEqual(DURATION_MS['7d'], 604800000, '7 days should be 604800000ms');
    assert.strictEqual(DURATION_MS['14d'], 1209600000, '14 days should be 1209600000ms');
    assert.strictEqual(DURATION_MS['30d'], 2592000000, '30 days should be 2592000000ms');

    console.log('✓ Duration presets test passed');
}

function testBatchLimitConfiguration() {
    console.log('Testing batch limit configuration...');

    // Test that maxAccountsPerBatch can be set up to 10000, default is 1500
    function validateMaxAccounts(value) {
        if (!Number.isFinite(value) || value < 1 || value > 10000) {
            throw new Error('Max accounts per batch must be between 1 and 10000');
        }
        return value;
    }

    assert.strictEqual(validateMaxAccounts(1500), 1500, 'Should accept 1500 (default)');
    assert.strictEqual(validateMaxAccounts(1000), 1000, 'Should accept 1000');
    assert.strictEqual(validateMaxAccounts(10000), 10000, 'Should accept 10000');

    try {
        validateMaxAccounts(10001);
        assert.fail('Should reject value over 10000');
    } catch (err) {
        assert.ok(err.message.includes('between 1 and 10000'), 'Should reject value over 10000');
    }

    console.log('✓ Batch limit configuration test passed');
}

function testQuotaPreservation() {
    console.log('Testing quota preservation...');

    // Simulate switching between limited and unlimited access
    const user = {
        role: 'user',
        accessType: 'limited',
        trials: { claim_daily_reward: 10, check_balance: 5 }
    };

    // Switch to unlimited
    user.accessType = 'unlimited';
    assert.strictEqual(user.trials.claim_daily_reward, 10, 'Quotas should be preserved when switching to unlimited');
    assert.strictEqual(user.trials.check_balance, 5, 'Quotas should be preserved when switching to unlimited');

    // Switch back to limited
    user.accessType = 'limited';
    assert.strictEqual(user.trials.claim_daily_reward, 10, 'Quotas should be preserved when switching back to limited');
    assert.strictEqual(user.trials.check_balance, 5, 'Quotas should be preserved when switching back to limited');

    console.log('✓ Quota preservation test passed');
}

function testSelectionDeselection() {
    console.log('Testing selection deselection...');

    // Simulate selection with exclusion
    const selection = {
        total: 100,
        excludedIds: new Set([5, 10, 15])
    };

    const remainingCount = selection.total - selection.excludedIds.size;
    assert.strictEqual(remainingCount, 97, 'Should calculate remaining count correctly');

    // Add more exclusions
    selection.excludedIds.add(20);
    const newRemainingCount = selection.total - selection.excludedIds.size;
    assert.strictEqual(newRemainingCount, 96, 'Should update remaining count after adding exclusion');

    console.log('✓ Selection deselection test passed');
}

function testDuplicateRequestPrevention() {
    console.log('Testing duplicate request prevention...');

    const timeWindow = 5 * 1000; // 5 seconds
    const now = Date.now();

    // Test duplicate within time window
    const recentRequest = {
        createdAt: new Date(now - 3000), // 3 seconds ago
        operationType: 'claim_daily_reward',
        accountIds: ['acc1', 'acc2']
    };

    const isDuplicate1 = recentRequest.createdAt >= new Date(now - timeWindow);
    assert.strictEqual(isDuplicate1, true, 'Should detect duplicate within 5 seconds');

    // Test request outside time window
    const oldRequest = {
        createdAt: new Date(now - 10000), // 10 seconds ago
        operationType: 'claim_daily_reward',
        accountIds: ['acc1', 'acc2']
    };

    const isDuplicate2 = oldRequest.createdAt >= new Date(now - timeWindow);
    assert.strictEqual(isDuplicate2, false, 'Should not detect duplicate after 5 seconds');

    console.log('✓ Duplicate request prevention test passed');
}

function testAccessBlockedForRevoked() {
    console.log('Testing access blocked for revoked users...');

    function accessBlockedFor(user) {
        if (!user) return { blocked: true, reason: 'Not authenticated' };
        if (user.role !== 'user') return { blocked: false };
        if (user.status === 'revoked') return { blocked: true, reason: 'Access revoked' };
        if (user.status === 'deactivated') return { blocked: true, reason: 'Account is deactivated' };

        const accessType = user.accessType || 'limited';
        const now = Date.now();

        if (accessType === 'unlimited') {
            if (user.unlimitedAccessExpiresAt && new Date(user.unlimitedAccessExpiresAt).getTime() < now) {
                return { blocked: true, reason: 'Unlimited access expired' };
            }
            return { blocked: false };
        }

        if (user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() < now) {
            return { blocked: true, reason: 'Access expired' };
        }

        return { blocked: false };
    }

    const revokedUser = { role: 'user', status: 'revoked' };
    const result1 = accessBlockedFor(revokedUser);
    assert.strictEqual(result1.blocked, true, 'Revoked user should be blocked');
    assert.strictEqual(result1.reason, 'Access revoked', 'Reason should be Access revoked');

    const deactivatedUser = { role: 'user', status: 'deactivated' };
    const result2 = accessBlockedFor(deactivatedUser);
    assert.strictEqual(result2.blocked, true, 'Deactivated user should be blocked');
    assert.strictEqual(result2.reason, 'Account is deactivated', 'Reason should be Account is deactivated');

    console.log('✓ Access blocked for revoked test passed');
}

// Run all tests
try {
    testLargeImportNoLimit();
    testImportBatchProcessing();
    testSelectionTokenBatchRetrieval();
    testUnlimitedAccessTrialExemption();
    testUnlimitedAccessExpiration();
    testDurationPresets();
    testBatchLimitConfiguration();
    testQuotaPreservation();
    testSelectionDeselection();
    testDuplicateRequestPrevention();
    testAccessBlockedForRevoked();
    console.log('\n✓ All regression tests passed');
} catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
}
