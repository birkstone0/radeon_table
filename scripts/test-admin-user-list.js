// Test script to verify hyclens appears in admin User Management
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

async function testAdminUserList() {
    console.log('[TEST] Verifying hyclens appears in admin User Management...\n');

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
            cookies = loginResponse.cookies.map(c => c.split(';')[0]).join('; ');
        } else {
            console.log('[TEST 1] ✗ Admin login failed');
            console.log('[TEST 1] Response:', loginResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 1] ✗ Admin login error:', error.message);
        return false;
    }

    // Get user list
    console.log('\n[TEST 2] Fetching user list from admin endpoint...');
    try {
        const usersResponse = await makeRequest('/api/admin/users', 'GET', null, cookies);

        if (usersResponse.status === 200 && usersResponse.data.items) {
            console.log('[TEST 2] ✓ User list fetched successfully');
            console.log(`[TEST 2] Total users: ${usersResponse.data.total}`);

            // Check if hyclens is in the list
            const hyclensUser = usersResponse.data.items.find(u => u.username === 'hyclens');
            if (hyclensUser) {
                console.log('[TEST 2] ✓ hyclens found in user list');
                console.log(`[TEST 2] hyclens ID: ${hyclensUser.id}`);
                console.log(`[TEST 2] hyclens Role: ${hyclensUser.role}`);
                console.log(`[TEST 2] hyclens Status: ${hyclensUser.status}`);
                console.log(`[TEST 2] hyclens Account count: ${hyclensUser.accountCount}`);
                console.log(`[TEST 2] hyclens Operation count: ${hyclensUser.operationCount}`);
                console.log(`[TEST 2] hyclens Trials: ${JSON.stringify(hyclensUser.trials)}`);
            } else {
                console.log('[TEST 2] ✗ hyclens not found in user list');
                console.log('[TEST 2] Users in list:', usersResponse.data.items.map(u => u.username));
                return false;
            }
        } else {
            console.log('[TEST 2] ✗ Failed to fetch user list');
            console.log('[TEST 2] Response:', usersResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 2] ✗ User list fetch error:', error.message);
        return false;
    }

    console.log('\n[TEST] All tests passed! ✓');
    return true;
}

testAdminUserList()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((error) => {
        console.error('[TEST] Test failed with error:', error);
        process.exit(1);
    });
