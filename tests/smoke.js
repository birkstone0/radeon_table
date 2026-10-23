// Quick API smoke test: provisioning, login, isolation, and import preview.
// Run with the API server stopped (uses its own ephemeral data dir).
process.env.DATA_DIR = process.env.DATA_DIR || require('path').join(__dirname, '.smoke-data');
process.env.PORT = '0'; // Use random port for testing
process.env.ADMIN_INITIAL_PASSWORD = 'AdminTest12345';
process.env.MEMBER_INITIAL_PASSWORD = 'MemberTest12345';
process.env.SESSION_SECRET = 'smoke-test-secret';
process.env.COOKIE_SECURE = 'false';

const fs = require('fs');
const path = require('path');
const { start } = require('../server');

let server;
let port;
let base;
let failures = 0;

function check(name, condition, detail) {
    if (condition) {
        console.log(`PASS ${name}`);
    } else {
        failures += 1;
        console.log(`FAIL ${name}${detail ? ' :: ' + detail : ''}`);
    }
}

async function request(method, urlPath, { body, cookie, headers = {} } = {}) {
    const response = await fetch(base + urlPath, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
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
    const setCookie = response.headers.get('set-cookie');
    return {
        status: response.status,
        json,
        cookie: setCookie ? setCookie.split(';')[0] : null,
        allCookies: typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie().map((value) => value.split(';')[0])
            : (setCookie ? [setCookie.split(';')[0]] : [])
    };
}

async function login(username, password) {
    const response = await request('POST', '/api/auth/login', { body: { username, password } });
    // Collect every Set-Cookie header so later requests can send them all.
    const cookies = response.allCookies;
    return { response, cookie: cookies.length ? cookies.join('; ') : response.cookie };
}

(async () => {
    // Start the server
    server = await start();
    
    // Wait a moment for server to be fully listening
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;

    // 1. Provisioned accounts
    const admin = await login('hoshex', 'AdminTest12345');
    check('admin login', admin.response.status === 200, JSON.stringify(admin.response.json));
    const member = await login('stewie', 'MemberTest12345');
    check('user login', member.response.status === 200, JSON.stringify(member.response.json));
    check('no password hash exposed', !JSON.stringify(admin.response.json).includes('$2a$'));

    // 2. Auth enforcement
    const noAuth = await request('GET', '/api/accounts');
    check('unauthenticated accounts -> 401', noAuth.status === 401);
    const memberHitsAdmin = await request('GET', '/api/admin/users', { cookie: member.cookie });
    check('user cannot read admin API', memberHitsAdmin.status === 403, String(memberHitsAdmin.status));

    // 3. Shared-password import preview (validation, duplicates, masking)
    const preview = await request('POST', '/api/accounts/imports/preview', {
        cookie: member.cookie,
        body: {
            method: 'shared_password',
            sharedPassword: 'sharedPass123',
            text: '09171234567\n09998887777\nbadline\n09171234567'
        }
    });
    check('preview ok', preview.status === 200, JSON.stringify(preview.json));
    check('preview counts', preview.json && preview.json.summary.valid === 2
        && preview.json.summary.invalid === 1 && preview.json.summary.duplicates === 1, JSON.stringify(preview.json && preview.json.summary));
    check('preview masks phones', JSON.stringify(preview.json).includes('0917****4567')
        && !JSON.stringify(preview.json).includes('09171234567'));

    // 4. Confirm import
    const committed = await request('POST', '/api/accounts/imports', {
        cookie: member.cookie,
        body: {
            method: 'shared_password',
            records: preview.json.valid.map((record) => ({ phone: record.phone, password: 'sharedPass123' }))
        }
    });
    check('import commits 2 records', committed.status === 200 && committed.json.imported === 2, JSON.stringify(committed.json));

    // 5. Ownership isolation
    const memberAccounts = await request('GET', '/api/accounts', { cookie: member.cookie });
    check('member sees own records', memberAccounts.json.total === 2, JSON.stringify(memberAccounts.json));
    const adminSeesNothingOfMember = await request('GET', '/api/accounts', { cookie: admin.cookie });
    check('admin personal workspace is separate', adminSeesNothingOfMember.json.total === 0);
    const adminViewOfMember = await request('GET', '/api/admin/users/2/accounts', { cookie: admin.cookie });
    check('admin can read member records', adminViewOfMember.status === 200 && adminViewOfMember.json.total === 2);

    // 6. Queueing an operation runs against the real login.js logic (no fabrication)
    const queued = await request('POST', '/api/operations/run', {
        cookie: member.cookie,
        body: { operationType: 'check_balance', accountIds: [1] }
    });
    check('operation queued', queued.status === 200, JSON.stringify(queued.json));

    // 7. Second operation type should queue without conflict (per-account locking)
    const queuedClaim = await request('POST', '/api/operations/run', {
        cookie: member.cookie,
        body: { operationType: 'claim_daily_reward', accountIds: [2] }
    });
    check('different operation type queued', queuedClaim.status === 200, JSON.stringify(queuedClaim.json));

    // 8. Same operation type on same account should be rejected (duplicate prevention)
    const queuedDuplicate = await request('POST', '/api/operations/run', {
        cookie: member.cookie,
        body: { operationType: 'check_balance', accountIds: [1] }
    });
    check('duplicate operation rejected', queuedDuplicate.status === 409, String(queuedDuplicate.status));

    // Wait for operations to complete
    await new Promise((resolve) => setTimeout(resolve, 12000));

    // 9. Admin can deactivate a user and kill their session

    const deactivated = await request('POST', '/api/admin/users/2/deactivate', { cookie: admin.cookie, body: {} });
    check('admin deactivates user', deactivated.status === 200 && deactivated.json.user.status === 'deactivated', JSON.stringify(deactivated.json));
    const memberAfter = await request('GET', '/api/accounts', { cookie: member.cookie });
    check('deactivated session rejected', memberAfter.status === 401, String(memberAfter.status));
    const memberLoginBlocked = await login('stewie', 'MemberTest12345');
    check('deactivated user cannot log in', memberLoginBlocked.response.status === 403, String(memberLoginBlocked.response.status));

    const reactivated = await request('POST', '/api/admin/users/2/activate', { cookie: admin.cookie, body: {} });
    check('admin reactivates user', reactivated.status === 200 && reactivated.json.user.status === 'active');

    server.close(() => {
        // WAL sidecar files can still be open briefly on Windows; retry once.
        const dataDir = path.join(__dirname, '.smoke-data');
        setTimeout(() => {
            try {
                fs.rmSync(dataDir, { recursive: true, force: true });
            } catch {
                // Leftover scratch data is harmless; ignore on Windows.
            }
            console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILURES`);
            process.exit(failures === 0 ? 0 : 1);
        }, 500);
    });
})().catch((error) => {
    console.error('smoke test crashed', error);
    process.exit(1);
});
