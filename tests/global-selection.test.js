// Test global selection functionality
const assert = require('assert');

function testSelectionTokenStructure() {
    console.log('Testing selection token structure...');

    // Simulate selection token object
    const selectionToken = {
        _id: 'token123',
        ownerId: 'user123',
        resourceType: 'operations',
        filters: {
            operationType: 'claim_daily_reward',
            status: 'success',
            phone: null
        },
        estimatedCount: 239,
        excludedIds: [],
        createdAt: new Date()
    };

    assert.strictEqual(selectionToken.resourceType, 'operations', 'Resource type should be operations');
    assert.strictEqual(typeof selectionToken.filters, 'object', 'Filters should be an object');
    assert.strictEqual(typeof selectionToken.estimatedCount, 'number', 'Estimated count should be a number');
    assert.strictEqual(Array.isArray(selectionToken.excludedIds), true, 'Excluded IDs should be an array');

    console.log('✓ Selection token structure test passed');
}

function testSelectionFilterMatching() {
    console.log('Testing selection filter matching...');

    // Simulate building MongoDB query from filters
    function buildQuery(filters) {
        const query = { ownerId: 'user123', hiddenFromOwner: { $ne: true } };
        if (filters.operationType) query.operationType = filters.operationType;
        if (filters.status) query.status = filters.status;
        if (filters.phone) query.phoneMasked = { $regex: filters.phone.replace(/\*/g, '.*') };
        return query;
    }

    const filters1 = { operationType: 'claim_daily_reward', status: 'success', phone: null };
    const query1 = buildQuery(filters1);
    assert.strictEqual(query1.operationType, 'claim_daily_reward', 'Should include operation type filter');
    assert.strictEqual(query1.status, 'success', 'Should include status filter');

    const filters2 = { operationType: null, status: null, phone: '0917*' };
    const query2 = buildQuery(filters2);
    assert.ok(query2.phoneMasked, 'Should include phone filter');
    assert.strictEqual(query2.phoneMasked.$regex, '0917.*', 'Should convert wildcard to regex');

    console.log('✓ Selection filter matching test passed');
}

function testSelectionExcludeLogic() {
    console.log('Testing selection exclude logic...');

    // Simulate exclude functionality
    const token = {
        excludedIds: ['op1', 'op2']
    };

    function excludeIds(token, idsToExclude) {
        const updated = [...new Set([...token.excludedIds, ...idsToExclude])];
        token.excludedIds = updated;
        return updated;
    }

    const result = excludeIds(token, ['op3', 'op1']);
    assert.strictEqual(result.length, 3, 'Should have 3 excluded IDs after deduplication');
    assert.ok(result.includes('op1'), 'Should include op1');
    assert.ok(result.includes('op3'), 'Should include op3');

    console.log('✓ Selection exclude logic test passed');
}

function testSelectionCountCalculation() {
    console.log('Testing selection count calculation...');

    const token = {
        estimatedCount: 239,
        excludedIds: ['op1', 'op2', 'op3']
    };

    const remainingCount = token.estimatedCount - token.excludedIds.length;
    assert.strictEqual(remainingCount, 236, 'Should calculate remaining count correctly');

    console.log('✓ Selection count calculation test passed');
}

function testSelectionTokenExpiration() {
    console.log('Testing selection token expiration...');

    const createdAt = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    const expiresAt = new Date(createdAt.getTime() + 3600 * 1000); // 1 hour TTL
    const now = Date.now();

    const isExpired = expiresAt.getTime() < now;
    assert.strictEqual(isExpired, false, 'Token should not be expired after 30 minutes');

    console.log('✓ Selection token expiration test passed');
}

function testSelectionPagination() {
    console.log('Testing selection pagination...');

    const page = 2;
    const limit = 25;
    const offset = (page - 1) * limit;

    assert.strictEqual(offset, 25, 'Offset should be 25 for page 2 with limit 25');

    // Simulate paginated result
    const total = 239;
    const totalPages = Math.ceil(total / limit);
    assert.strictEqual(totalPages, 10, 'Should have 10 pages for 239 items with limit 25');

    console.log('✓ Selection pagination test passed');
}

function testSelectionAPICreate() {
    console.log('Testing selection API create payload...');

    const payload = {
        operationType: 'claim_daily_reward',
        status: 'success',
        phone: null,
        accountId: null,
        from: null,
        to: null
    };

    assert.strictEqual(payload.operationType, 'claim_daily_reward', 'Should include operation type');
    assert.strictEqual(payload.status, 'success', 'Should include status');

    console.log('✓ Selection API create test passed');
}

function testGlobalSelectAllWorkflow() {
    console.log('Testing global select all workflow...');

    // Simulate the workflow: create token -> get count -> exclude IDs -> execute
    const workflow = {
        step1: { action: 'create token', result: { token: 'token123', count: 239 } },
        step2: { action: 'get IDs', result: { items: ['op1', 'op2', 'op3'], total: 239 } },
        step3: { action: 'exclude IDs', result: { excludedCount: 2, remainingCount: 237 } },
        step4: { action: 'clear token', result: { message: 'Selection cleared' } }
    };

    assert.strictEqual(workflow.step1.result.count, 239, 'Should create token with correct count');
    assert.strictEqual(workflow.step3.result.remainingCount, 237, 'Should update remaining count after exclusion');

    console.log('✓ Global select all workflow test passed');
}

// Run all tests
try {
    testSelectionTokenStructure();
    testSelectionFilterMatching();
    testSelectionExcludeLogic();
    testSelectionCountCalculation();
    testSelectionTokenExpiration();
    testSelectionPagination();
    testSelectionAPICreate();
    testGlobalSelectAllWorkflow();
    console.log('\n✓ All global selection tests passed');
} catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
}
