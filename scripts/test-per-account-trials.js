// Test per-account trial charging
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

async function testPerAccountTrials() {
    console.log('[TEST] Testing per-account trial charging...\n');

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
            console.log(`[TEST 1] Trials: ${JSON.stringify(loginResponse.data.user.trials)}`);
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

    // Get accounts
    console.log('\n[TEST 2] Fetching hyclens accounts...');
    let accountIds = [];
    try {
        const accountsResponse = await makeRequest('/api/accounts', 'GET', null, cookies);

        if (accountsResponse.status === 200 && accountsResponse.data.items) {
            console.log(`[TEST 2] ✓ Fetched ${accountsResponse.data.items.length} accounts`);
            accountIds = accountsResponse.data.items.map(a => a.id);
        } else {
            console.log('[TEST 2] ✗ Failed to fetch accounts');
            return false;
        }
    } catch (error) {
        console.log('[TEST 2] ✗ Accounts fetch error:', error.message);
        return false;
    }

    // Test 3: Submit 10 accounts with 3 trials (should accept 3, reject 7)
    console.log('\n[TEST 3] Submitting 10 accounts with 3 trials (should accept 3, reject 7)...');
    try {
        const runResponse = await makeRequest('/api/operations/run', 'POST', {
            operationType: 'claim_daily_reward',
            accountIds: accountIds
        }, cookies);

        if (runResponse.status === 200) {
            console.log('[TEST 3] ✓ Request accepted');
            console.log(`[TEST 3] Queued: ${runResponse.data.queued} operations (expected 3)`);
            console.log(`[TEST 3] Rejected: ${runResponse.data.rejected?.length || 0} (expected 7)`);
            if (runResponse.data.queued === 3) {
                console.log('[TEST 3] ✓ Exactly 3 accounts queued (trials exhausted)');
            } else {
                console.log('[TEST 3] ✗ Wrong number of accounts queued');
                return false;
            }
        } else {
            console.log('[TEST 3] ✗ Request rejected (unexpected)');
            console.log('[TEST 3] Response:', runResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 3] ✗ Submit error:', error.message);
        return false;
    }

    // Wait for operations to complete
    console.log('\n[TEST 3] Waiting 15 seconds for operations to complete...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Test 4: Try to submit again with 0 trials (should fail)
    console.log('\n[TEST 4] Submitting again with 0 trials (should fail)...');
    try {
        const runResponse = await makeRequest('/api/operations/run', 'POST', {
            operationType: 'claim_daily_reward',
            accountIds: accountIds
        }, cookies);

        if (runResponse.status === 409) {
            console.log('[TEST 4] ✓ Correctly rejected - no trials remaining');
            console.log(`[TEST 4] Error: ${runResponse.data.error?.message}`);
        } else {
            console.log('[TEST 4] ✗ Not rejected (unexpected)');
            console.log('[TEST 4] Response:', runResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 4] ✗ Submit error:', error.message);
        return false;
    }

    console.log('\n[TEST] All tests passed! ✓');
    console.log('[TEST] Per-account trial charging is working correctly');
    return true;
}

testPerAccountTrials()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((error) => {
        console.error('[TEST] Test failed with error:', error);
        process.exit(1);
    });
