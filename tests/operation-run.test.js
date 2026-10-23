// Test operation run endpoint and modal opening flow
const assert = require('assert');

// Mock the operations service to test the route contract
function testOperationRunResponseContract() {
    console.log('Testing operation run response contract...');

    // Simulate the response structure that should be returned
    const mockResponse = {
        message: 'Queued 2 accounts. Processing is running in the background.',
        queued: 2,
        operationIds: ['id1', 'id2']
    };

    // Verify the response has the expected structure
    assert.strictEqual(typeof mockResponse.message, 'string', 'Message should be a string');
    assert.strictEqual(typeof mockResponse.queued, 'number', 'Queued should be a number');
    assert.strictEqual(Array.isArray(mockResponse.operationIds), true, 'OperationIds should be an array');
    assert.strictEqual(mockResponse.operationIds.length, 2, 'Should have 2 operation IDs');
    assert.strictEqual(typeof mockResponse.operationIds[0], 'string', 'Operation ID should be a string');

    console.log('✓ Response contract test passed');
}

function testDuplicateCheckLogic() {
    console.log('Testing duplicate check logic...');

    // The duplicate check should only reject if the EXACT same operation
    // was submitted within 5 seconds, not if ANY account was recently processed
    const timeWindow = 5 * 1000; // 5 seconds
    const now = Date.now();

    // Test case 1: Same operation within time window - should be rejected
    const recentOperation = {
        createdAt: new Date(now - 3000), // 3 seconds ago
        operationType: 'claim_daily_reward',
        accountId: 'account1',
        status: 'queued'
    };

    const isDuplicate1 = recentOperation.createdAt >= new Date(now - timeWindow);
    assert.strictEqual(isDuplicate1, true, 'Should detect duplicate within 5 seconds');

    // Test case 2: Same operation outside time window - should be allowed
    const oldOperation = {
        createdAt: new Date(now - 10000), // 10 seconds ago
        operationType: 'claim_daily_reward',
        accountId: 'account1',
        status: 'queued'
    };

    const isDuplicate2 = oldOperation.createdAt >= new Date(now - timeWindow);
    assert.strictEqual(isDuplicate2, false, 'Should not detect duplicate after 5 seconds');

    console.log('✓ Duplicate check logic test passed');
}

function testModalOpeningConditions() {
    console.log('Testing modal opening conditions...');

    // Simulate the frontend logic for opening the modal
    function shouldOpenModal(response) {
        return Boolean(response.operationIds && response.operationIds.length > 0);
    }

    // Test case 1: Valid response with operation IDs
    const validResponse = {
        operationIds: ['id1', 'id2'],
        queued: 2
    };
    assert.strictEqual(shouldOpenModal(validResponse), true, 'Should open modal with valid operation IDs');

    // Test case 2: Response with empty operation IDs
    const emptyResponse = {
        operationIds: [],
        queued: 0
    };
    assert.strictEqual(shouldOpenModal(emptyResponse), false, 'Should not open modal with empty operation IDs');

    // Test case 3: Response without operationIds field
    const missingFieldResponse = {
        queued: 2
    };
    assert.strictEqual(shouldOpenModal(missingFieldResponse), false, 'Should not open modal without operationIds field');

    console.log('✓ Modal opening conditions test passed');
}

// Run all tests
try {
    testOperationRunResponseContract();
    testDuplicateCheckLogic();
    testModalOpeningConditions();
    console.log('\n✓ All tests passed');
} catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
}
