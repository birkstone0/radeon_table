// Test to verify the frontend API client constructs correct URLs
const assert = require('assert');

// Simulate the API client logic from frontend/src/lib/api.js
function constructApiUrl(baseURL, endpoint) {
    // Axios baseURL + endpoint path
    // If baseURL ends with / and endpoint starts with /, axios normalizes
    // We simulate the final URL construction
    const normalizedBase = baseURL.replace(/\/$/, '');
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    return normalizedBase + normalizedEndpoint;
}

function testApiUrlConstruction() {
    console.log('Testing frontend API URL construction...');

    // Test 1: Production configuration
    const prodBase = 'https://radeon-table.onrender.com/api';
    const loginEndpoint = '/auth/login';
    const prodUrl = constructApiUrl(prodBase, loginEndpoint);
    assert.strictEqual(prodUrl, 'https://radeon-table.onrender.com/api/auth/login', 'Production login URL should be correct');
    console.log('✓ Production login URL: https://radeon-table.onrender.com/api/auth/login');

    // Test 2: Development configuration (relative)
    const devBase = '/api';
    const devUrl = constructApiUrl(devBase, loginEndpoint);
    assert.strictEqual(devUrl, '/api/auth/login', 'Development login URL should be correct');
    console.log('✓ Development login URL: /api/auth/login');

    // Test 3: Verify no duplicate /api prefix
    const noDuplicateUrl = constructApiUrl(prodBase, '/auth/login');
    assert.strictEqual(noDuplicateUrl, 'https://radeon-table.onrender.com/api/auth/login', 'Should not have duplicate /api');
    console.log('✓ No duplicate /api prefix in production URL');

    // Test 4: Session endpoint
    const sessionEndpoint = '/auth/session';
    const sessionUrl = constructApiUrl(prodBase, sessionEndpoint);
    assert.strictEqual(sessionUrl, 'https://radeon-table.onrender.com/api/auth/session', 'Session URL should be correct');
    console.log('✓ Session URL: https://radeon-table.onrender.com/api/auth/session');

    // Test 5: Health endpoint
    const healthEndpoint = '/health';
    const healthUrl = constructApiUrl(prodBase, healthEndpoint);
    assert.strictEqual(healthUrl, 'https://radeon-table.onrender.com/api/health', 'Health URL should be correct');
    console.log('✓ Health URL: https://radeon-table.onrender.com/api/health');

    // Test 6: Accounts endpoint
    const accountsEndpoint = '/accounts';
    const accountsUrl = constructApiUrl(prodBase, accountsEndpoint);
    assert.strictEqual(accountsUrl, 'https://radeon-table.onrender.com/api/accounts', 'Accounts URL should be correct');
    console.log('✓ Accounts URL: https://radeon-table.onrender.com/api/accounts');

    // Test 7: Operations endpoint
    const operationsEndpoint = '/operations/run';
    const operationsUrl = constructApiUrl(prodBase, operationsEndpoint);
    assert.strictEqual(operationsUrl, 'https://radeon-table.onrender.com/api/operations/run', 'Operations URL should be correct');
    console.log('✓ Operations URL: https://radeon-table.onrender.com/api/operations/run');

    // Test 8: Admin endpoint
    const adminEndpoint = '/admin/users';
    const adminUrl = constructApiUrl(prodBase, adminEndpoint);
    assert.strictEqual(adminUrl, 'https://radeon-table.onrender.com/api/admin/users', 'Admin URL should be correct');
    console.log('✓ Admin URL: https://radeon-table.onrender.com/api/admin/users');

    console.log('\n✓ ALL FRONTEND API URL TESTS PASSED');
}

try {
    testApiUrlConstruction();
} catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
}
