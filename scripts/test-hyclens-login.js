// Test script to verify hyclens login and data isolation
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

async function testHyclensLogin() {
    console.log('[TEST] Testing hyclens login and data isolation...\n');

    let cookies = '';

    // Test 1: Login as hyclens
    console.log('[TEST 1] Attempting login as hyclens...');
    try {
        const loginResponse = await makeRequest('/api/auth/login', 'POST', {
            username: 'hyclens',
            password: 'hyclens12'
        });

        if (loginResponse.status === 200 && loginResponse.data.user && loginResponse.data.user.username === 'hyclens') {
            console.log('[TEST 1] ✓ Login successful');
            console.log(`[TEST 1] User ID: ${loginResponse.data.user.id}`);
            console.log(`[TEST 1] Role: ${loginResponse.data.user.role}`);
            console.log(`[TEST 1] Status: ${loginResponse.data.user.status}`);
            console.log(`[TEST 1] Trials: ${JSON.stringify(loginResponse.data.user.trials)}`);

            // Save cookies for subsequent requests
            cookies = loginResponse.cookies.map(c => c.split(';')[0]).join('; ');
        } else {
            console.log('[TEST 1] ✗ Login failed: unexpected response');
            console.log('[TEST 1] Response:', loginResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 1] ✗ Login failed:', error.message);
        return false;
    }

    // Test 2: Verify session
    console.log('\n[TEST 2] Verifying session...');
    try {
        const sessionResponse = await makeRequest('/api/auth/session', 'GET', null, cookies);

        if (sessionResponse.status === 200 && sessionResponse.data.user && sessionResponse.data.user.username === 'hyclens') {
            console.log('[TEST 2] ✓ Session valid');
        } else {
            console.log('[TEST 2] ✗ Session invalid');
            console.log('[TEST 2] Response:', sessionResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 2] ✗ Session check failed:', error.message);
        return false;
    }

    // Test 3: Check that hyclens cannot access admin endpoints
    console.log('\n[TEST 3] Testing data isolation (admin endpoint access)...');
    try {
        const adminResponse = await makeRequest('/api/admin/users', 'GET', null, cookies);
        if (adminResponse.status === 403 || adminResponse.status === 401) {
            console.log('[TEST 3] ✓ Admin endpoint correctly forbidden (401/403)');
            console.log(`[TEST 3] Status: ${adminResponse.status}, Message: ${adminResponse.data.error?.message}`);
        } else {
            console.log('[TEST 3] ✗ Admin endpoint accessible (should be forbidden)');
            console.log('[TEST 3] Response:', adminResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 3] ✗ Admin endpoint test error:', error.message);
        return false;
    }

    // Test 4: Verify hyclens cannot login with wrong password
    console.log('\n[TEST 4] Testing password security (wrong password)...');
    try {
        const wrongPasswordResponse = await makeRequest('/api/auth/login', 'POST', {
            username: 'hyclens',
            password: 'wrongpassword'
        });

        if (wrongPasswordResponse.status === 401) {
            console.log('[TEST 4] ✓ Wrong password correctly rejected (401)');
        } else {
            console.log('[TEST 4] ✗ Wrong password not rejected properly');
            console.log('[TEST 4] Response:', wrongPasswordResponse);
            return false;
        }
    } catch (error) {
        console.log('[TEST 4] ? Wrong password test error:', error.message);
    }

    console.log('\n[TEST] All tests passed! ✓');
    return true;
}

testHyclensLogin()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((error) => {
        console.error('[TEST] Test failed with error:', error);
        process.exit(1);
    });
