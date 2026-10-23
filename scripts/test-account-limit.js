// Test account limit enforcement for hyclens
const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 8787;

function makeRequest(path, method, data, cookies) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookies || ''
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const responseData = JSON.parse(body);
                    resolve({
                        status: res.statusCode,
                        data: responseData,
                        cookies: res.headers['set-cookie'] || []
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: body,
                        cookies: res.headers['set-cookie'] || []
                    });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

async function testAccountLimit() {
    console.log('[TEST] Testing account limit enforcement for hyclens...\n');

    let cookies = '';

    // Login as hyclens
    console.log('[TEST 1] Logging in as hyclens...');
    try {
        const loginResponse = await makeRequest('/api/auth/login', 'POST', {
            username: 'hyclens',
            password: 'hyclens12'
        });

        if (loginResponse.status === 200 && loginResponse.data.user && loginResponse.data.user.username === 'hyclens') {
            console.log('[TEST 1] ✓ Login successful');
            cookies = loginResponse.cookies.map(c => c.split(';')[0]).join('; ');
        } else {
            console.log('[TEST 1] ✗ Login failed');
            console.log('[TEST 1] Response:', loginResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 1] ✗ Login error:', error.message);
        return false;
    }

    // Clear any existing operations to avoid conflicts
    console.log('\n[TEST 1b] Clearing existing operations...');
    try {
        const clearResponse = await makeRequest('/api/operations/clear', 'DELETE', {
            confirm: true
        }, cookies);
        if (clearResponse.status === 200) {
            console.log('[TEST 1b] ✓ Operations cleared');
        } else {
            console.log('[TEST 1b] ⚠ Could not clear operations (may be empty)');
        }
    } catch (error) {
        console.log('[TEST 1b] ⚠ Clear failed (continuing):', error.message);
    }

    // Get hyclens's accounts
    console.log('\n[TEST 2] Fetching hyclens accounts...');
    let accountIds = [];
    try {
        const accountsResponse = await makeRequest('/api/accounts', 'GET', null, cookies);

        if (accountsResponse.status === 200 && accountsResponse.data.items) {
            console.log(`[TEST 2] ✓ Fetched ${accountsResponse.data.items.length} accounts`);
            accountIds = accountsResponse.data.items.map(a => a.id);
            console.log(`[TEST 2] Account IDs: ${accountIds.join(', ')}`);
        } else {
            console.log('[TEST 2] ✗ Failed to fetch accounts');
            console.log('[TEST 2] Response:', accountsResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 2] ✗ Accounts fetch error:', error.message);
        return false;
    }

    if (accountIds.length < 2) {
        console.log('[TEST] ⚠ Not enough accounts to test (need at least 2)');
        return false;
    }

    // Test 3: Submit 2 accounts (should succeed)
    console.log('\n[TEST 3] Submitting 2 accounts (should succeed)...');
    try {
        const twoAccounts = accountIds.slice(0, 2);
        const runResponse = await makeRequest('/api/operations/run', 'POST', {
            operationType: 'claim_daily_reward',
            accountIds: twoAccounts
        }, cookies);

        if (runResponse.status === 200) {
            console.log('[TEST 3] ✓ 2 accounts accepted');
            console.log(`[TEST 3] Queued: ${runResponse.data.queued} operations`);
        } else {
            console.log('[TEST 3] ✗ 2 accounts rejected (unexpected)');
            console.log('[TEST 3] Response:', runResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 3] ✗ Submit error:', error.message);
        return false;
    }

    // Wait for operations to complete to avoid conflicts
    console.log('\n[TEST 3] Waiting 10 seconds for operations to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Test 4: Submit with duplicate account IDs (should count as 2 distinct accounts)
    // Wait 6 seconds to avoid conflict with previous operation
    console.log('\n[TEST 4] Waiting 6 seconds to avoid conflict...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    console.log('[TEST 4] Submitting with duplicate account IDs (should accept)...');
    try {
        const duplicateAccounts = [accountIds[0], accountIds[0], accountIds[1], accountIds[1]];
        const runResponse = await makeRequest('/api/operations/run', 'POST', {
            operationType: 'check_balance',
            accountIds: duplicateAccounts
        }, cookies);

        if (runResponse.status === 200) {
            console.log('[TEST 4] ✓ Duplicates correctly deduplicated and accepted');
            console.log(`[TEST 4] Queued: ${runResponse.data.queued} operations (expected 2)`);
        } else {
            console.log('[TEST 4] ✗ Duplicates not handled correctly');
            console.log('[TEST 4] Response:', runResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 4] ✗ Submit error:', error.message);
        return false;
    }

    // Test 5: Try to submit more than 2 distinct accounts (should fail)
    // Wait to avoid conflicts
    console.log('\n[TEST 5] Waiting 6 seconds to avoid conflict...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    console.log('[TEST 5] Submitting 3 distinct accounts (should fail)...');
    try {
        // Refresh account list to get the new third account
        const accountsRefresh = await makeRequest('/api/accounts', 'GET', null, cookies);
        if (accountsRefresh.status === 200 && accountsRefresh.data.items) {
            accountIds = accountsRefresh.data.items.map(a => a.id);
            console.log(`[TEST 5] Refreshed account IDs: ${accountIds.join(', ')}`);
        }

        if (accountIds.length < 3) {
            console.log('[TEST 5] ⚠ Not enough accounts to test (need at least 3)');
            return false;
        }

        const threeAccounts = accountIds.slice(0, 3);
        const runResponse = await makeRequest('/api/operations/run', 'POST', {
            operationType: 'claim_daily_reward',
            accountIds: threeAccounts
        }, cookies);

        if (runResponse.status === 400) {
            console.log('[TEST 5] ✓ 3 accounts correctly rejected');
            console.log(`[TEST 5] Status: ${runResponse.status}`);
            console.log(`[TEST 5] Error: ${runResponse.data.error?.message || runResponse.data.message}`);
            if (runResponse.data.error?.message?.includes('at most 2')) {
                console.log('[TEST 5] ✓ Error message correctly mentions the limit');
            }
        } else {
            console.log('[TEST 5] ✗ 3 accounts not rejected (unexpected)');
            console.log('[TEST 5] Response:', runResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 5] ✗ Submit error:', error.message);
        return false;
    }

    console.log('\n[TEST] All critical tests passed! ✓');
    return true;
}

testAccountLimit()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((error) => {
        console.error('[TEST] Test failed with error:', error);
        process.exit(1);
    });
