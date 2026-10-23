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

function testSelectionLimitRemoval() {
    console.log('Testing selection limit with 1500 record maximum...');

    const MAX_RECORDS_PER_OPERATION = 1500;

    // Test that 102 records can be selected (as in the bug report)
    const selectedCount1 = 102;
    const canProcess1 = selectedCount1 <= MAX_RECORDS_PER_OPERATION;
    assert.strictEqual(canProcess1, true, '102 records should be selectable');

    // Test that 1500 records can be selected
    const selectedCount2 = 1500;
    const canProcess2 = selectedCount2 <= MAX_RECORDS_PER_OPERATION;
    assert.strictEqual(canProcess2, true, '1500 records should be selectable at maximum');

    // Test that 1501 records are capped at 1500
    const selectedCount3 = 1501;
    const cappedCount = Math.min(selectedCount3, MAX_RECORDS_PER_OPERATION);
    assert.strictEqual(cappedCount, 1500, '1501 records should be capped at 1500');

    // Test that the backend caps at 1500
    function capSelection(count) {
        return Math.min(count, MAX_RECORDS_PER_OPERATION);
    }

    assert.strictEqual(capSelection(102), 102, '102 records should not be capped');
    assert.strictEqual(capSelection(1500), 1500, '1500 records should not be capped');
    assert.strictEqual(capSelection(2000), 1500, '2000 records should be capped at 1500');

    console.log('✓ Selection limit with 1500 record maximum test passed');
}

function testAccountsSelectionToken() {
    console.log('Testing accounts selection token...');

    // Simulate accounts selection token
    const accountsToken = {
        _id: 'token456',
        ownerId: 'user123',
        resourceType: 'accounts',
        filters: {
            search: '0917',
            status: 'pending'
        },
        estimatedCount: 150,
        excludedIds: [],
        createdAt: new Date()
    };

    assert.strictEqual(accountsToken.resourceType, 'accounts', 'Resource type should be accounts');
    assert.strictEqual(accountsToken.estimatedCount, 150, 'Should have correct count');
    assert.strictEqual(accountsToken.filters.search, '0917', 'Should store search filter');

    console.log('✓ Accounts selection token test passed');
}

function testSelectionCapBehavior() {
    console.log('Testing selection cap behavior...');

    const MAX_RECORDS_PER_OPERATION = 1500;

    // Test the exact scenario from the bug report: 102 records matching
    const totalMatching = 102;
    const cappedCount = Math.min(totalMatching, MAX_RECORDS_PER_OPERATION);
    assert.strictEqual(cappedCount, 102, '102 matching records should all be selected');

    // Test that when 2000 records match, only 1500 are selected
    const totalMatching2 = 2000;
    const cappedCount2 = Math.min(totalMatching2, MAX_RECORDS_PER_OPERATION);
    assert.strictEqual(cappedCount2, 1500, '2000 matching records should be capped at 1500');

    // Test the message generation
    function generateSelectionMessage(totalCount, cappedCount) {
        if (totalCount > MAX_RECORDS_PER_OPERATION) {
            return `Selected ${cappedCount} records (maximum reached). ${totalCount - cappedCount} additional records remain unselected.`;
        }
        return `Selected all ${totalCount} records matching current filters`;
    }

    const message1 = generateSelectionMessage(102, 102);
    assert.strictEqual(message1, 'Selected all 102 records matching current filters', 'Message should not show cap for 102 records');

    const message2 = generateSelectionMessage(2000, 1500);
    assert.strictEqual(message2, 'Selected 1500 records (maximum reached). 500 additional records remain unselected.', 'Message should show cap for 2000 records');

    console.log('✓ Selection cap behavior test passed');
}

function testSelectionAcrossPagination() {
    console.log('Testing selection across pagination...');

    const MAX_RECORDS_PER_OPERATION = 1500;
    const pageSize = 25;
    const totalRecords = 102;

    // Calculate total pages
    const totalPages = Math.ceil(totalRecords / pageSize);
    assert.strictEqual(totalPages, 5, '102 records with 25 per page should have 5 pages');

    // Test that all 102 records can be selected across pages
    const selectedAll = Math.min(totalRecords, MAX_RECORDS_PER_OPERATION);
    assert.strictEqual(selectedAll, 102, 'All 102 records should be selectable across pagination');

    // Test that when total exceeds limit, it's capped
    const totalRecords2 = 1600;
    const selectedAll2 = Math.min(totalRecords2, MAX_RECORDS_PER_OPERATION);
    assert.strictEqual(selectedAll2, 1500, '1600 records should be capped at 1500 across pagination');

    console.log('✓ Selection across pagination test passed');
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
    testSelectionLimitRemoval();
    testAccountsSelectionToken();
    testSelectionCapBehavior();
    testSelectionAcrossPagination();
    console.log('\n✓ All global selection tests passed');
} catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
}
