// Test CORS origin normalization logic
const assert = require('assert');

function normalizeOrigin(o) {
    return o ? o.replace(/\/$/, '') : '';
}

// Test cases for origin normalization
function testOriginNormalization() {
    console.log('Testing CORS origin normalization...');

    // Test case 1: No trailing slash
    assert.strictEqual(normalizeOrigin('https://claim-tab.netlify.app'), 'https://claim-tab.netlify.app');
    console.log('  ✓ No trailing slash - preserved');

    // Test case 2: With trailing slash
    assert.strictEqual(normalizeOrigin('https://claim-tab.netlify.app/'), 'https://claim-tab.netlify.app');
    console.log('  ✓ With trailing slash - removed');

    // Test case 3: Empty string
    assert.strictEqual(normalizeOrigin(''), '');
    console.log('  ✓ Empty string - preserved');

    // Test case 4: Null
    assert.strictEqual(normalizeOrigin(null), '');
    console.log('  ✓ Null - converted to empty');

    // Test case 5: Multiple trailing slashes
    assert.strictEqual(normalizeOrigin('https://claim-tab.netlify.app///'), 'https://claim-tab.netlify.app//');
    console.log('  ✓ Multiple trailing slashes - only one removed');

    // Test case 6: Origin with path
    assert.strictEqual(normalizeOrigin('https://claim-tab.netlify.app/path'), 'https://claim-tab.netlify.app/path');
    console.log('  ✓ Origin with path - preserved');

    // Test case 7: Origin with path and trailing slash
    assert.strictEqual(normalizeOrigin('https://claim-tab.netlify.app/path/'), 'https://claim-tab.netlify.app/path');
    console.log('  ✓ Origin with path and trailing slash - removed');

    console.log('✓ All CORS normalization tests passed');
}

// Test that the normalization allows matching
function testOriginMatching() {
    console.log('Testing origin matching with normalization...');

    const configuredOrigin = 'https://claim-tab.netlify.app';
    const normalizedConfigured = normalizeOrigin(configuredOrigin);

    // Should match without trailing slash
    const requestOrigin1 = 'https://claim-tab.netlify.app';
    assert.strictEqual(normalizeOrigin(requestOrigin1), normalizedConfigured);
    console.log('  ✓ Origin without trailing slash matches');

    // Should match with trailing slash
    const requestOrigin2 = 'https://claim-tab.netlify.app/';
    assert.strictEqual(normalizeOrigin(requestOrigin2), normalizedConfigured);
    console.log('  ✓ Origin with trailing slash matches');

    // Should not match different origin
    const requestOrigin3 = 'https://evil.com';
    assert.notStrictEqual(normalizeOrigin(requestOrigin3), normalizedConfigured);
    console.log('  ✓ Different origin does not match');

    console.log('✓ All origin matching tests passed');
}

try {
    testOriginNormalization();
    testOriginMatching();
    console.log('\n✓ ALL CORS TESTS PASSED');
} catch (error) {
    console.error('\n✗ Test failed:', error.message);
    process.exit(1);
}
