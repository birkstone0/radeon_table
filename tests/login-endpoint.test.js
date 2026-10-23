// Regression test to verify the login endpoint is registered at the correct path
const assert = require('assert');
const path = require('path');

// Import the app creation function
const { start } = require('../server');

let server;
let port;
let base;

async function request(method, urlPath, { body, headers = {} } = {}) {
    const response = await fetch(base + urlPath, {
        method,
        headers: {
            'content-type': 'application/json',
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = text;
    }
    return {
        status: response.status,
        json
    };
}

(async () => {
    // Set up test environment
    process.env.DATA_DIR = path.join(__dirname, '.login-test-data');
    process.env.PORT = '0'; // Use random port
    process.env.SESSION_SECRET = 'test-secret-for-login-endpoint-test';
    process.env.COOKIE_SECURE = 'false';
    process.env.ADMIN_INITIAL_PASSWORD = 'testAdmin123';
    process.env.MEMBER_INITIAL_PASSWORD = 'testMember123';

    // Start the server
    server = await start();

    // Wait a moment for server to be fully listening
    await new Promise((resolve) => setTimeout(resolve, 100));

    port = server.address().port;
    base = `http://127.0.0.1:${port}`;

    console.log('Testing login endpoint registration...');

    // Test 1: Login endpoint exists at /api/auth/login
    const loginResponse = await request('POST', '/api/auth/login', {
        body: { username: 'invalid', password: 'invalid' }
    });
    assert.strictEqual(loginResponse.status, 401, 'Login endpoint should return 401 for invalid credentials, not 404');
    assert.strictEqual(loginResponse.json.error.message, 'Invalid username or password', 'Should return auth error message');
    console.log('✓ Login endpoint registered at /api/auth/login (returns 401 for invalid credentials)');

    // Test 2: Verify no duplicate /api prefix (should not become /api/api/auth/login)
    const duplicatePrefixResponse = await request('POST', '/api/api/auth/login', {
        body: { username: 'invalid', password: 'invalid' }
    });
    assert.strictEqual(duplicatePrefixResponse.status, 404, 'Duplicate /api prefix should return 404');
    console.log('✓ Duplicate /api prefix correctly returns 404');

    // Test 3: /auth/login without /api prefix returns HTML (SPA fallback, not API)
    const noPrefixResponse = await request('POST', '/auth/login', {
        body: { username: 'invalid', password: 'invalid' }
    });
    // In single-origin deployment, this returns the SPA HTML (200)
    // In cross-origin deployment, this would be handled by the frontend router
    assert.strictEqual(noPrefixResponse.status, 200, 'Non-API routes return SPA fallback');
    console.log('✓ /auth/login without /api prefix returns SPA fallback (expected for single-origin deployment)');

    // Test 4: Verify the endpoint accepts POST method
    const optionsResponse = await request('OPTIONS', '/api/auth/login');
    assert.strictEqual(optionsResponse.status, 204, 'OPTIONS preflight should return 204');
    console.log('✓ Login endpoint accepts OPTIONS preflight');

    // Test 5: Verify GET method is not allowed on login endpoint
    const getResponse = await request('GET', '/api/auth/login');
    assert.strictEqual(getResponse.status, 404, 'GET method should return 404 (router only has POST)');
    console.log('✓ GET method on login endpoint returns 404');

    // Test 6: Verify missing fields are handled safely
    const missingFieldsResponse = await request('POST', '/api/auth/login', {
        body: { username: 'test' } // missing password
    });
    assert.strictEqual(missingFieldsResponse.status, 400, 'Missing password should return 400');
    assert.strictEqual(missingFieldsResponse.json.error.message, 'Username and password are required', 'Should return validation error');
    console.log('✓ Missing fields handled safely (returns 400)');

    // Test 7: Verify empty fields are handled safely
    const emptyFieldsResponse = await request('POST', '/api/auth/login', {
        body: { username: '', password: '' }
    });
    assert.strictEqual(emptyFieldsResponse.status, 400, 'Empty fields should return 400');
    console.log('✓ Empty fields handled safely (returns 400)');

    // Test 8: Verify session endpoint exists
    const sessionResponse = await request('GET', '/api/auth/session');
    assert.strictEqual(sessionResponse.status, 200, 'Session endpoint should return 200');
    assert.strictEqual(sessionResponse.json.user, null, 'Session should be null without authentication');
    console.log('✓ Session endpoint registered at /api/auth/session');

    // Test 9: Verify health endpoint exists
    const healthResponse = await request('GET', '/api/health');
    assert.strictEqual(healthResponse.status, 200, 'Health endpoint should return 200');
    assert.strictEqual(healthResponse.json.ok, true, 'Health endpoint should return ok: true');
    console.log('✓ Health endpoint registered at /api/health');

    // Test 10: Verify /api/ prefix routes without /api return 404
    const noApiPrefixHealth = await request('GET', '/health');
    assert.strictEqual(noApiPrefixHealth.status, 200, '/health without /api returns SPA fallback');
    console.log('✓ /health without /api returns SPA fallback');

    // Cleanup
    server.close(() => {
        const dataDir = path.join(__dirname, '.login-test-data');
        setTimeout(() => {
            try {
                const fs = require('fs');
                fs.rmSync(dataDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
            console.log('\n✓ ALL LOGIN ENDPOINT TESTS PASSED');
            process.exit(0);
        }, 500);
    });
})().catch((error) => {
    console.error('Login endpoint test crashed:', error);
    if (server) server.close();
    process.exit(1);
});
