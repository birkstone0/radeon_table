// Test that admin users are exempt from account limit
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

async function testAdminExempt() {
    console.log('[TEST] Testing admin exemption from account limit...\n');

    let cookies = '';

    // Login as admin (hoshex)
    console.log('[TEST 1] Logging in as admin (hoshex)...');
    try {
        const loginResponse = await makeRequest('/api/auth/login', 'POST', {
            username: 'hoshex',
            password: 'holyshit12'
        });

        if (loginResponse.status === 200 && loginResponse.data.user && loginResponse.data.user.username === 'hoshex') {
            console.log('[TEST 1] ✓ Admin login successful');
            console.log(`[TEST 1] Role: ${loginResponse.data.user.role}`);
            cookies = loginResponse.cookies.map(c => c.split(';')[0]).join('; ');
        } else {
            console.log('[TEST 1] ✗ Admin login failed');
            console.log('[TEST 1] Response:', loginResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 1] ✗ Login error:', error.message);
        return false;
    }

    // Get admin's accounts
    console.log('\n[TEST 2] Fetching admin accounts...');
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

    if (accountIds.length === 0) {
        console.log('[TEST] ⚠ Admin has no accounts to test');
        return false;
    }

    // Test 3: Submit all accounts (should succeed regardless of count for admin)
    console.log('\n[TEST 3] Submitting all accounts as admin (should succeed)...');
    try {
        const runResponse = await makeRequest('/api/operations/run', 'POST', {
            operationType: 'claim_daily_reward',
            accountIds: accountIds
        }, cookies);

        if (runResponse.status === 200) {
            console.log('[TEST 3] ✓ Admin can submit any number of accounts');
            console.log(`[TEST 3] Queued: ${runResponse.data.queued} operations`);
        } else {
            console.log('[TEST 3] ✗ Admin request rejected (unexpected)');
            console.log('[TEST 3] Response:', runResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 3] ✗ Submit error:', error.message);
        return false;
    }

    console.log('\n[TEST] All tests passed! ✓');
    console.log('[TEST] Admin users are correctly exempt from account limit');
    return true;
}

testAdminExempt()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((error) => {
        console.error('[TEST] Test failed with error:', error);
        process.exit(1);
    });
