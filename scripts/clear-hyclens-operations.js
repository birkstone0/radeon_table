// Clear hyclens's operations
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

async function clearOperations() {
    console.log('[CLEAR] Clearing hyclens operations...\n');

    let cookies = '';

    // Login as hyclens
    console.log('[CLEAR 1] Logging in as hyclens...');
    try {
        const loginResponse = await makeRequest('/api/auth/login', 'POST', {
            username: 'hyclens',
            password: 'hyclens12'
        });

        if (loginResponse.status === 200 && loginResponse.data.user && loginResponse.data.user.username === 'hyclens') {
            console.log('[CLEAR 1] ✓ Login successful');
            cookies = loginResponse.cookies.map(c => c.split(';')[0]).join('; ');
        } else {
            console.log('[CLEAR 1] ✗ Login failed');
            process.exit(1);
        }
    } catch (error) {
        console.log('[CLEAR 1] ✗ Login error:', error.message);
        process.exit(1);
    }

    // Clear operations
    console.log('\n[CLEAR 2] Clearing operations...');
    try {
        const clearResponse = await makeRequest('/api/operations/clear', 'DELETE', {
            confirm: true
        }, cookies);

        if (clearResponse.status === 200) {
            console.log('[CLEAR 2] ✓ Operations cleared');
            console.log(`[CLEAR 2] ${clearResponse.data.message}`);
        } else {
            console.log('[CLEAR 2] ✗ Failed to clear operations');
            console.log('[CLEAR 2] Response:', clearResponse);
            process.exit(1);
        }
    } catch (error) {
        console.log('[CLEAR 2] ✗ Clear error:', error.message);
        process.exit(1);
    }

    console.log('\n[CLEAR] Completed');
}

clearOperations()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error('[CLEAR] Failed:', error);
        process.exit(1);
    });
