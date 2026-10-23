// Check hyclens's current maxAccountsPerBatch setting in MongoDB
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');

async function main() {
    console.log('[CHECK] Fetching hyclens user data from MongoDB...\n');

    // Connect to MongoDB
    await getConnection();
    console.log('[CHECK] Connected to MongoDB\n');

    const username = 'hyclens';

    // Find user
    const user = await User.findOne({ usernameKey: username.toLowerCase() });
    if (!user) {
        console.log(`[CHECK] User '${username}' not found`);
        process.exit(1);
    }

    console.log(`[CHECK] User: ${user.username}`);
    console.log(`[CHECK] Role: ${user.role}`);
    console.log(`[CHECK] Status: ${user.status}`);
    console.log(`[CHECK] maxAccountsPerBatch: ${user.maxAccountsPerBatch}`);
    console.log(`[CHECK] Trials: ${JSON.stringify(user.trials)}`);
    console.log(`[CHECK] Access expires at: ${user.accessExpiresAt || 'None'}`);
    console.log('\n');

    if (user.maxAccountsPerBatch === 2) {
        console.log('[CHECK] ✓ Limit is correctly set to 2');
    } else if (user.maxAccountsPerBatch === undefined || user.maxAccountsPerBatch === null) {
        console.log('[CHECK] ✗ Limit is undefined/null (will use default 50)');
    } else {
        console.log(`[CHECK] ⚠ Limit is ${user.maxAccountsPerBatch} (expected 2)`);
    }
}

main()
    .then(() => {
        console.log('\n[CHECK] Check completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[CHECK] Check failed:', error);
        process.exit(1);
    });
